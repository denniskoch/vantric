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
}

func New() *Driver {
	return &Driver{nextID: 100, vms: map[string]*instance{}}
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

func (d *Driver) Delete(ctx context.Context, driverID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.vms[driverID]; !ok {
		return hypervisor.ErrNotFound
	}
	delete(d.vms, driverID)
	return nil
}
