package api

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"lab-cloud-manager/internal/hypervisor"
	"lab-cloud-manager/internal/store"
)

// Reconciler keeps the store in sync with each server's hypervisor:
//   - live state (status, IPs) of managed instances
//   - adoption of VMs that exist on the hypervisor but not in the store
//     (e.g. VMs created directly in Proxmox before/outside this app)
//   - removal of instances whose VM disappeared out-of-band
//
// The driver is the source of truth for runtime state; the store is the
// source of truth for metadata.
type Reconciler struct {
	store    *store.Store
	registry *hypervisor.Registry
	log      *slog.Logger
	interval time.Duration
	sweeps   int
}

func NewReconciler(st *store.Store, registry *hypervisor.Registry, log *slog.Logger, interval time.Duration) *Reconciler {
	return &Reconciler{store: st, registry: registry, log: log, interval: interval}
}

func (r *Reconciler) Run(ctx context.Context) {
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.sweep(ctx)
		}
	}
}

func (r *Reconciler) sweep(ctx context.Context) {
	r.sweeps++
	servers, err := r.store.ListServers(ctx)
	if err != nil {
		r.log.Error("reconciler: listing servers", "error", err)
		return
	}
	instances, err := r.store.ListInstances(ctx)
	if err != nil {
		r.log.Error("reconciler: listing instances", "error", err)
		return
	}
	// Index managed instances by server + driver ID.
	byDriverID := map[string]*store.Instance{}
	for i := range instances {
		inst := &instances[i]
		if inst.DriverID != "" {
			byDriverID[inst.ServerID+"/"+inst.DriverID] = inst
		}
	}

	for _, server := range servers {
		driver, ok := r.registry.Get(server.ID)
		if !ok {
			continue
		}
		states, err := driver.List(ctx)
		if err != nil {
			r.log.Warn("reconciler: list failed", "server", server.Name, "error", err)
			continue
		}
		seen := map[string]bool{}
		for _, state := range states {
			seen[state.DriverID] = true
			if inst, ok := byDriverID[server.ID+"/"+state.DriverID]; ok {
				r.syncInstance(ctx, driver, inst, state)
			} else {
				r.adoptInstance(ctx, server, state)
			}
		}
		// Instances whose VM vanished from the hypervisor.
		for _, inst := range instances {
			if inst.ServerID == server.ID && inst.DriverID != "" && !seen[inst.DriverID] {
				r.log.Info("reconciler: instance gone from hypervisor, removing", "name", inst.Name)
				_ = r.store.DeleteInstance(ctx, inst.ID)
			}
		}

		if cd, ok := driver.(hypervisor.ContainerDriver); ok {
			r.sweepContainers(ctx, server, cd)
		}
	}
}

// sweepContainers mirrors the instance sweep for LXC containers.
func (r *Reconciler) sweepContainers(ctx context.Context, server store.Server, cd hypervisor.ContainerDriver) {
	containers, err := r.store.ListContainers(ctx)
	if err != nil {
		r.log.Error("reconciler: listing containers", "error", err)
		return
	}
	byDriverID := map[string]*store.Container{}
	for i := range containers {
		ct := &containers[i]
		if ct.ServerID == server.ID && ct.DriverID != "" {
			byDriverID[ct.DriverID] = ct
		}
	}
	states, err := cd.ListContainers(ctx)
	if err != nil {
		r.log.Warn("reconciler: container list failed", "server", server.Name, "error", err)
		return
	}
	seen := map[string]bool{}
	for _, state := range states {
		seen[state.DriverID] = true
		if ct, ok := byDriverID[state.DriverID]; ok {
			r.syncContainer(ctx, cd, ct, state)
		} else {
			r.adoptContainer(ctx, server, state)
		}
	}
	for _, ct := range containers {
		if ct.ServerID == server.ID && ct.DriverID != "" && !seen[ct.DriverID] {
			r.log.Info("reconciler: container gone from hypervisor, removing", "name", ct.Name)
			_ = r.store.DeleteContainer(ctx, ct.ID)
		}
	}
}

func (r *Reconciler) syncContainer(ctx context.Context, cd hypervisor.ContainerDriver, ct *store.Container, state hypervisor.InstanceState) {
	internalIP := ct.InternalIP
	switch {
	case state.Status == hypervisor.StatusTerminated:
		internalIP = ""
	case state.InternalIP != "":
		internalIP = state.InternalIP
	case state.Status == hypervisor.StatusRunning && internalIP == "" && r.sweeps%5 == 0:
		if full, err := cd.GetContainer(ctx, ct.DriverID); err == nil {
			internalIP = full.InternalIP
		}
	}
	if string(state.Status) != ct.Status || internalIP != ct.InternalIP {
		if err := r.store.UpdateContainerState(ctx, ct.ID, string(state.Status), internalIP); err != nil {
			r.log.Warn("reconciler: container update failed", "name", ct.Name, "error", err)
		}
	}
	r.syncContainerShape(ctx, ct, state)
}

// syncContainerShape is syncShape for containers.
func (r *Reconciler) syncContainerShape(ctx context.Context, ct *store.Container, state hypervisor.InstanceState) {
	name, zone := ct.Name, ct.Zone
	cpus, memoryMB, diskGB := ct.CPUs, ct.MemoryMB, ct.DiskGB
	if state.Name != "" {
		name = state.Name
	}
	if state.Zone != "" {
		zone = state.Zone
	}
	if state.CPUs > 0 {
		cpus = state.CPUs
	}
	if state.MemoryMB > 0 {
		memoryMB = state.MemoryMB
	}
	if state.DiskGB > 0 {
		diskGB = state.DiskGB
	}
	if name == ct.Name && zone == ct.Zone && cpus == ct.CPUs &&
		memoryMB == ct.MemoryMB && diskGB == ct.DiskGB {
		return
	}
	if err := r.store.UpdateContainerShape(ctx, ct.ID, name, zone, cpus, memoryMB, diskGB); err != nil {
		r.log.Warn("reconciler: container shape update failed", "name", ct.Name, "error", err)
		return
	}
	ct.Name, ct.Zone = name, zone
	ct.CPUs, ct.MemoryMB, ct.DiskGB = cpus, memoryMB, diskGB
}

// adoptContainer records a container found on the hypervisor that this
// app didn't create; protected by default like adopted instances.
func (r *Reconciler) adoptContainer(ctx context.Context, server store.Server, state hypervisor.InstanceState) {
	ct := &store.Container{
		ID:        uuid.NewString(),
		Name:      state.Name,
		ServerID:  server.ID,
		Zone:      state.Zone,
		CPUs:      state.CPUs,
		MemoryMB:  state.MemoryMB,
		DiskGB:    state.DiskGB,
		Status:    string(state.Status),
		DriverID:  state.DriverID,
		Protected: true,
	}
	if ct.Name == "" {
		ct.Name = "ct-" + state.DriverID
	}
	if err := r.store.CreateContainer(ctx, ct); err != nil {
		ct.Name = ct.Name + "-" + state.DriverID
		if err := r.store.CreateContainer(ctx, ct); err != nil {
			r.log.Warn("reconciler: container adopt failed", "name", state.Name, "error", err)
			return
		}
	}
	r.log.Info("reconciler: adopted container", "name", ct.Name, "server", server.Name)
}

// syncInstance applies observed runtime state to a managed instance.
func (r *Reconciler) syncInstance(ctx context.Context, driver hypervisor.Driver, inst *store.Instance, state hypervisor.InstanceState) {
	internalIP := inst.InternalIP
	externalIP := inst.ExternalIP
	switch {
	case state.Status == hypervisor.StatusTerminated:
		internalIP, externalIP = "", ""
	case state.InternalIP != "":
		internalIP = state.InternalIP
	case state.Status == hypervisor.StatusRunning && internalIP == "" && r.sweeps%5 == 0:
		// List omits IPs on some drivers; ask the guest agent via Get,
		// throttled since agentless VMs will never answer.
		if full, err := driver.Get(ctx, inst.DriverID); err == nil {
			internalIP = full.InternalIP
			if full.ExternalIP != "" {
				externalIP = full.ExternalIP
			}
		}
	}
	if string(state.Status) != inst.Status || internalIP != inst.InternalIP || externalIP != inst.ExternalIP {
		if err := r.store.UpdateInstanceState(ctx, inst.ID, string(state.Status), internalIP, externalIP); err != nil {
			r.log.Warn("reconciler: update failed", "name", inst.Name, "error", err)
		}
	}
	r.syncShape(ctx, inst, state)
	r.fillFacts(ctx, driver, inst)
}

// syncShape keeps the name and sizing in step with the hypervisor.
//
// Adoption is a race: a VM picked up while it is still being created
// carries no name and no sizing, and without this the record would
// keep those zeroes for good — which is exactly what happened to VMs
// created in Proxmox after their hypervisor was added. Reconciling it
// on every sweep also means a rename or a resize done in the
// hypervisor shows up here rather than drifting apart silently.
//
// Only meaningful values are taken. A blank name or a zero count is
// the hypervisor not knowing yet, not an instruction to forget.
func (r *Reconciler) syncShape(ctx context.Context, inst *store.Instance, state hypervisor.InstanceState) {
	name, zone := inst.Name, inst.Zone
	cpus, memoryMB, diskGB := inst.CPUs, inst.MemoryMB, inst.DiskGB
	if state.Name != "" {
		name = state.Name
	}
	if state.Zone != "" {
		zone = state.Zone
	}
	if state.CPUs > 0 {
		cpus = state.CPUs
	}
	if state.MemoryMB > 0 {
		memoryMB = state.MemoryMB
	}
	if state.DiskGB > 0 {
		diskGB = state.DiskGB
	}
	if name == inst.Name && zone == inst.Zone && cpus == inst.CPUs &&
		memoryMB == inst.MemoryMB && diskGB == inst.DiskGB {
		return
	}
	if err := r.store.UpdateInstanceShape(ctx, inst.ID, name, zone, cpus, memoryMB, diskGB); err != nil {
		// A rename can collide with another instance's name, which is
		// worth saying once rather than every two seconds.
		r.log.Warn("reconciler: shape update failed", "name", inst.Name, "error", err)
		return
	}
	if name != inst.Name {
		r.log.Info("reconciler: instance renamed on the hypervisor", "from", inst.Name, "to", name)
	}
	inst.Name, inst.Zone = name, zone
	inst.CPUs, inst.MemoryMB, inst.DiskGB = cpus, memoryMB, diskGB
}

// fillFacts asks the hypervisor for the things a guest is born with,
// once. List carries neither of them and neither changes over a VM's
// life: the guest type decides whether "connect" means SSH or RDP, and
// the SMBIOS UUID is what the machine calls itself to anything running
// inside it. So they're read together on a slow beat for instances
// still missing them, and then left alone — one Describe, not two.
func (r *Reconciler) fillFacts(ctx context.Context, driver hypervisor.Driver, inst *store.Instance) {
	// A serial is usually absent rather than unknown, so it can't be
	// part of the "already filled" test: waiting for one would mean
	// re-reading every VM's config forever.
	if (inst.OSType != "" && inst.UUID != "") || r.sweeps%10 != 0 {
		return
	}
	detail, err := driver.Describe(ctx, inst.DriverID)
	if err != nil || (detail.OSType == "" && detail.UUID == "") {
		return
	}
	// Keep what's already known: a hypervisor that reports one and not
	// the other must not blank the one it knows.
	osType, uuid := firstNonEmpty(detail.OSType, inst.OSType), firstNonEmpty(detail.UUID, inst.UUID)
	serial := firstNonEmpty(detail.Serial, inst.Serial)
	if err := r.store.SetInstanceFacts(ctx, inst.ID, osType, uuid, serial); err != nil {
		r.log.Warn("reconciler: fact update failed", "name", inst.Name, "error", err)
		return
	}
	inst.OSType, inst.UUID, inst.Serial = osType, uuid, serial
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// adoptInstance records a VM found on the hypervisor that this app
// didn't create. Adopted instances get deletion protection by default:
// deleting them destroys a real VM someone made outside the app.
func (r *Reconciler) adoptInstance(ctx context.Context, server store.Server, state hypervisor.InstanceState) {
	inst := &store.Instance{
		ID:        uuid.NewString(),
		Name:      state.Name,
		ServerID:  server.ID,
		Zone:      state.Zone,
		CPUs:      state.CPUs,
		MemoryMB:  state.MemoryMB,
		DiskGB:    state.DiskGB,
		Status:    string(state.Status),
		DriverID:  state.DriverID,
		Protected: true,
	}
	if inst.Name == "" {
		inst.Name = "vm-" + state.DriverID
	}
	if err := r.store.CreateInstance(ctx, inst); err != nil {
		// Most likely a name collision with an instance on another
		// server; retry with a disambiguating suffix.
		inst.Name = inst.Name + "-" + state.DriverID
		if err := r.store.CreateInstance(ctx, inst); err != nil {
			r.log.Warn("reconciler: adopt failed", "name", state.Name, "error", err)
			return
		}
	}
	r.log.Info("reconciler: adopted instance", "name", inst.Name, "server", server.Name)
}
