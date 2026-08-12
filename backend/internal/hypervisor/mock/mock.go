// Package mock is an in-memory hypervisor driver for development. It
// simulates realistic async state transitions so the UI behaves like it
// would against a real cluster.
package mock

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"lab-cloud-manager/internal/hypervisor"
)

type instance struct {
	state   hypervisor.InstanceState
	created time.Time
	// pending transition, applied when 'at' passes
	next hypervisor.Status
	at   time.Time
}

type Driver struct {
	mu     sync.Mutex
	nextID int
	vms    map[string]*instance
	cts    map[string]*instance
}

func New() *Driver {
	d := &Driver{nextID: 100, vms: map[string]*instance{}, cts: map[string]*instance{}}
	// Seed a couple of containers so the CT pages have data in dev.
	d.cts["200"] = &instance{
		created: time.Now(),
		state: hypervisor.InstanceState{
			DriverID: "200", Name: "pihole", Zone: "lab-node-a",
			Status: hypervisor.StatusRunning, CPUs: 1, MemoryMB: 512, DiskGB: 4,
			InternalIP: "10.20.0.53",
		},
	}
	d.cts["201"] = &instance{
		created: time.Now(),
		state: hypervisor.InstanceState{
			DriverID: "201", Name: "docker-host", Zone: "lab-node-b",
			Status: hypervisor.StatusTerminated, CPUs: 2, MemoryMB: 2048, DiskGB: 16,
		},
	}
	return d
}

func (d *Driver) Name() string { return "mock" }

func (d *Driver) Zones(ctx context.Context) ([]hypervisor.Zone, error) {
	return []hypervisor.Zone{
		{ID: "lab-node-a", Name: "lab-node-a", Status: "online"},
		{ID: "lab-node-b", Name: "lab-node-b", Status: "online"},
	}, nil
}

func (d *Driver) Images(ctx context.Context) ([]hypervisor.Image, error) {
	return []hypervisor.Image{
		{ID: "9000", Name: "debian-12-cloudinit", Description: "Debian 12 (bookworm) cloud-init template"},
		{ID: "9001", Name: "ubuntu-2404-cloudinit", Description: "Ubuntu 24.04 LTS cloud-init template"},
		{ID: "9002", Name: "alpine-321", Description: "Alpine Linux 3.21 template"},
	}, nil
}

// Disks reports one boot disk per VM, mimicking Proxmox naming.
func (d *Driver) Disks(ctx context.Context) ([]hypervisor.Disk, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	disks := []hypervisor.Disk{}
	for id, vm := range d.vms {
		disks = append(disks, hypervisor.Disk{
			ID:      id + "/scsi0",
			Name:    fmt.Sprintf("vm-%s-disk-0", id),
			InUseBy: vm.state.Name,
			Zone:    vm.state.Zone,
			Storage: "local-lvm",
			SizeGB:  vm.state.DiskGB,
		})
	}
	return disks, nil
}

// Snapshots reports one post-provision snapshot per VM so the UI has
// something realistic to show in development.
func (d *Driver) Snapshots(ctx context.Context) ([]hypervisor.Snapshot, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	snapshots := []hypervisor.Snapshot{}
	for id, vm := range d.vms {
		snapshots = append(snapshots, hypervisor.Snapshot{
			ID:          id + "/clean-install",
			Name:        "clean-install",
			VMName:      vm.state.Name,
			Zone:        vm.state.Zone,
			Description: "Automatic post-provision snapshot (mock)",
			CreatedAt:   vm.created.Unix(),
		})
	}
	return snapshots, nil
}

func (d *Driver) Create(ctx context.Context, spec hypervisor.InstanceSpec) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.nextID++
	id := fmt.Sprintf("%d", d.nextID)
	d.vms[id] = &instance{
		created: time.Now(),
		state: hypervisor.InstanceState{
			DriverID: id,
			Name:     spec.Name,
			Zone:     spec.Zone,
			Status:   hypervisor.StatusProvisioning,
			CPUs:     spec.CPUs,
			MemoryMB: spec.MemoryMB,
			DiskGB:   spec.DiskGB,
		},
		next: hypervisor.StatusStaging,
		at:   time.Now().Add(3 * time.Second),
	}
	return id, nil
}

// tick applies any due transition. Called with lock held.
func (d *Driver) tick(vm *instance) {
	if vm.next == "" || time.Now().Before(vm.at) {
		return
	}
	vm.state.Status = vm.next
	switch vm.next {
	case hypervisor.StatusStaging:
		vm.next = hypervisor.StatusRunning
		vm.at = time.Now().Add(4 * time.Second)
	case hypervisor.StatusRunning:
		if vm.state.InternalIP == "" {
			vm.state.InternalIP = fmt.Sprintf("10.20.0.%d", 10+rand.Intn(240))
		}
		vm.next = ""
	case hypervisor.StatusTerminated:
		vm.next = ""
	default:
		vm.next = ""
	}
}

func (d *Driver) List(ctx context.Context) ([]hypervisor.InstanceState, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	states := []hypervisor.InstanceState{}
	for _, vm := range d.vms {
		d.tick(vm)
		states = append(states, vm.state)
	}
	return states, nil
}

func (d *Driver) Get(ctx context.Context, driverID string) (*hypervisor.InstanceState, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	vm, ok := d.vms[driverID]
	if !ok {
		return nil, hypervisor.ErrNotFound
	}
	d.tick(vm)
	s := vm.state
	return &s, nil
}

func (d *Driver) Start(ctx context.Context, driverID string) error {
	return d.transition(driverID, hypervisor.StatusStaging, hypervisor.StatusRunning, 3*time.Second)
}

func (d *Driver) Stop(ctx context.Context, driverID string) error {
	return d.transition(driverID, hypervisor.StatusStopping, hypervisor.StatusTerminated, 4*time.Second)
}

func (d *Driver) Reset(ctx context.Context, driverID string) error {
	return d.transition(driverID, hypervisor.StatusStaging, hypervisor.StatusRunning, 3*time.Second)
}

func (d *Driver) transition(driverID string, now, then hypervisor.Status, after time.Duration) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	vm, ok := d.vms[driverID]
	if !ok {
		return hypervisor.ErrNotFound
	}
	vm.state.Status = now
	vm.next = then
	vm.at = time.Now().Add(after)
	return nil
}

func (d *Driver) ISOs(ctx context.Context) ([]hypervisor.ISO, error) {
	return []hypervisor.ISO{
		{ID: "local:iso/debian-12.7.0-amd64-netinst.iso", Name: "debian-12.7.0-amd64-netinst.iso",
			Zone: "lab-node-a", Storage: "local", SizeBytes: 663748608, CreatedAt: time.Now().Add(-90 * 24 * time.Hour).Unix()},
		{ID: "local:iso/ubuntu-24.04.1-live-server-amd64.iso", Name: "ubuntu-24.04.1-live-server-amd64.iso",
			Zone: "lab-node-a", Storage: "local", SizeBytes: 2754981888, CreatedAt: time.Now().Add(-30 * 24 * time.Hour).Unix()},
	}, nil
}

func (d *Driver) Datastores(ctx context.Context) ([]hypervisor.Datastore, error) {
	return []hypervisor.Datastore{
		{ID: "lab-node-a/local", Name: "local", Zone: "lab-node-a", Type: "dir",
			Content: "iso,vztmpl,backup", TotalBytes: 100 << 30, UsedBytes: 38 << 30, Active: true},
		{ID: "lab-node-a/local-lvm", Name: "local-lvm", Zone: "lab-node-a", Type: "lvmthin",
			Content: "images,rootdir", TotalBytes: 500 << 30, UsedBytes: 213 << 30, Active: true},
		{ID: "lab-node-b/ssd-tank", Name: "ssd-tank", Zone: "lab-node-b", Type: "zfspool",
			Content: "images,rootdir", TotalBytes: 2 << 40, UsedBytes: 700 << 30, Active: true, Shared: true},
	}, nil
}

// --- hypervisor.ContainerDriver ---

func (d *Driver) ListContainers(ctx context.Context) ([]hypervisor.InstanceState, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	states := []hypervisor.InstanceState{}
	for _, ct := range d.cts {
		d.tick(ct)
		states = append(states, ct.state)
	}
	return states, nil
}

func (d *Driver) GetContainer(ctx context.Context, driverID string) (*hypervisor.InstanceState, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	ct, ok := d.cts[driverID]
	if !ok {
		return nil, hypervisor.ErrNotFound
	}
	d.tick(ct)
	s := ct.state
	return &s, nil
}

func (d *Driver) ctTransition(driverID string, now, then hypervisor.Status, after time.Duration) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	ct, ok := d.cts[driverID]
	if !ok {
		return hypervisor.ErrNotFound
	}
	ct.state.Status = now
	ct.next = then
	ct.at = time.Now().Add(after)
	return nil
}

func (d *Driver) StartContainer(ctx context.Context, driverID string) error {
	// Containers start much faster than VMs.
	return d.ctTransition(driverID, hypervisor.StatusStaging, hypervisor.StatusRunning, 1*time.Second)
}

func (d *Driver) StopContainer(ctx context.Context, driverID string) error {
	return d.ctTransition(driverID, hypervisor.StatusStopping, hypervisor.StatusTerminated, 2*time.Second)
}

func (d *Driver) RestartContainer(ctx context.Context, driverID string) error {
	return d.ctTransition(driverID, hypervisor.StatusStaging, hypervisor.StatusRunning, 1*time.Second)
}

func (d *Driver) DeleteContainer(ctx context.Context, driverID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.cts[driverID]; !ok {
		return hypervisor.ErrNotFound
	}
	delete(d.cts, driverID)
	return nil
}

func (d *Driver) Delete(ctx context.Context, driverID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.vms[driverID]; !ok {
		return hypervisor.ErrNotFound
	}
	delete(d.vms, driverID)
	return nil
}
