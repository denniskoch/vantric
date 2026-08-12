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
	}
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
