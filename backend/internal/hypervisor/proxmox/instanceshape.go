package proxmox

import (
	"context"
	"fmt"

	sdk "github.com/luthermonson/go-proxmox"

	"vantric/internal/hypervisor"
)

var (
	_ hypervisor.InstanceResizer = (*Driver)(nil)
	_ hypervisor.SnapshotManager = (*Driver)(nil)
)

// ResizeInstance changes a stopped guest's CPU and memory.
func (d *Driver) ResizeInstance(ctx context.Context, driverID string, cpus, memoryMB int) error {
	if cpus < 1 {
		return fmt.Errorf("an instance needs at least one vCPU")
	}
	if memoryMB < 1 {
		return fmt.Errorf("an instance needs memory")
	}
	vm, err := d.vmFor(ctx, driverID)
	if err != nil {
		return err
	}
	// Refused while it's running rather than attempted. Proxmox will
	// accept the config change on a running guest and apply the cores at
	// the next boot, which is the worst outcome available: the console
	// would report success, the API would agree, and the machine would
	// keep running on the old shape until somebody restarted it for an
	// unrelated reason and wondered what had changed.
	if vm.Status == "running" {
		return fmt.Errorf("stop %s before changing its CPU or memory", vm.Name)
	}
	task, err := vm.Config(ctx,
		sdk.VirtualMachineOption{Name: "cores", Value: cpus},
		sdk.VirtualMachineOption{Name: "memory", Value: memoryMB},
	)
	if err != nil {
		return fmt.Errorf("resizing to %d vCPU and %d MB: %w", cpus, memoryMB, err)
	}
	return awaitTask(ctx, task, "the new sizing to apply")
}

// CreateSnapshot captures the guest's current state.
func (d *Driver) CreateSnapshot(ctx context.Context, driverID, name, description string) error {
	vm, err := d.vmFor(ctx, driverID)
	if err != nil {
		return err
	}
	task, err := vm.NewSnapshot(ctx, name)
	if err != nil {
		return fmt.Errorf("taking snapshot %s: %w", name, err)
	}
	if err := awaitTask(ctx, task, "snapshot "+name); err != nil {
		return err
	}
	if description == "" {
		return nil
	}
	// The description is a SECOND call: Proxmox's create takes one, but
	// the library's NewSnapshot doesn't carry it, and a snapshot that
	// exists without its note is worth more than a failed snapshot —
	// so this failing is reported and the snapshot still stands.
	if err := vm.Snapshot(name).UpdateConfig(ctx,
		&sdk.VirtualMachineSnapshotUpdateOptions{Description: description}); err != nil {
		return fmt.Errorf("snapshot %s was taken but its description didn't save: %w", name, err)
	}
	return nil
}

// RollbackSnapshot returns the guest to a snapshot.
func (d *Driver) RollbackSnapshot(ctx context.Context, driverID, name string) error {
	vm, err := d.vmFor(ctx, driverID)
	if err != nil {
		return err
	}
	task, err := vm.Snapshot(name).Rollback(ctx)
	if err != nil {
		return fmt.Errorf("rolling back to %s: %w", name, err)
	}
	return awaitTask(ctx, task, "the rollback to "+name)
}

// DeleteSnapshot removes a snapshot and leaves the guest alone.
func (d *Driver) DeleteSnapshot(ctx context.Context, driverID, name string) error {
	vm, err := d.vmFor(ctx, driverID)
	if err != nil {
		return err
	}
	task, err := vm.Snapshot(name).Delete(ctx)
	if err != nil {
		return fmt.Errorf("deleting snapshot %s: %w", name, err)
	}
	return awaitTask(ctx, task, "snapshot "+name+" to be removed")
}
