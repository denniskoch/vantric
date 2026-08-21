package proxmox

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	sdk "github.com/luthermonson/go-proxmox"

	"vantric/internal/hypervisor"
)

var _ hypervisor.DiskManager = (*Driver)(nil)

// Disk operations on a guest that already exists.
//
// ALL OF THESE MAY BE TASKS. Proxmox answers some config changes with a
// UPID and does the work afterwards, and it does not tell you in
// advance which — a resize returns one, a plain key edit returns null,
// and allocating a volume returns one when the storage takes a moment.
// Reading the config straight after a UPID reply shows the OLD state
// while every status code said success, which is exactly how the boot
// disk resize looked correct and did nothing. So every call here goes
// through settle().
//
// diskSlots is where a new or re-attached disk goes. SCSI only,
// deliberately: it's what the template build uses, what every modern
// guest has a driver for, and choosing a bus is a question with one
// right answer often enough that asking it would be noise.
var diskSlots = []string{
	"scsi1", "scsi2", "scsi3", "scsi4", "scsi5", "scsi6", "scsi7",
	"scsi8", "scsi9", "scsi10", "scsi11", "scsi12", "scsi13", "scsi14",
}

// diskWait bounds the wait for one of these. Allocation and resize are
// metadata on every storage type this reaches; longer than this means
// something is wrong rather than something is large.
const diskWait = 5 * time.Minute

// freeSlot is the first SCSI slot this guest isn't using.
func freeSlot(cfg map[string]any) string {
	for _, slot := range diskSlots {
		if cfgString(cfg, slot) == "" {
			return slot
		}
	}
	return ""
}

// ResizeDisk grows an attached disk.
func (d *Driver) ResizeDisk(ctx context.Context, driverID, disk string, sizeGB int) error {
	if sizeGB <= 0 {
		return fmt.Errorf("a disk size in GB is required")
	}
	vm, err := d.vmFor(ctx, driverID)
	if err != nil {
		return err
	}
	key, current, ok := diskAt(configMap(vm.VirtualMachineConfig), disk)
	if !ok {
		return fmt.Errorf("%s is not a disk on this instance", disk)
	}
	if current >= sizeGB {
		// Said rather than skipped. On create, "already big enough" is a
		// template that grew and the honest answer is the disk you have;
		// here somebody typed a number at a disk they were looking at,
		// and silence would read as a resize that worked.
		return fmt.Errorf("%s is already %d GB, and a disk can be grown but never shrunk", key, current)
	}
	// ABSOLUTE, NOT AN INCREMENT. Proxmox's own GUI asks how much to
	// extend BY — 32 to 40 is "8" there — while the API takes either:
	// "+8G" adds to the current size, "40G" sets it. Everything in this
	// console asks for a final size.
	task, err := vm.ResizeDisk(ctx, key, strconv.Itoa(sizeGB)+"G")
	if err != nil {
		return fmt.Errorf("resizing %s to %dG: %w", key, sizeGB, err)
	}
	return awaitTask(ctx, task, fmt.Sprintf("%s to grow to %dG", key, sizeGB))
}

// AddDisk allocates a new volume and attaches it.
func (d *Driver) AddDisk(ctx context.Context, driverID string, spec hypervisor.DiskSpec) (string, error) {
	if spec.Storage == "" {
		return "", fmt.Errorf("a storage pool is required")
	}
	if spec.SizeGB <= 0 {
		return "", fmt.Errorf("a disk size in GB is required")
	}
	vm, err := d.vmFor(ctx, driverID)
	if err != nil {
		return "", err
	}
	slot := freeSlot(configMap(vm.VirtualMachineConfig))
	if slot == "" {
		return "", fmt.Errorf("no free SCSI slot on this instance")
	}
	// "<storage>:<size in GB>" is how Proxmox is asked to ALLOCATE
	// rather than attach — the volume name is its answer, not ours.
	// discard=on so freeing space in the guest frees it on the pool,
	// which is what everything this console creates already does.
	value := fmt.Sprintf("%s:%d,discard=on", spec.Storage, spec.SizeGB)
	task, err := vm.Config(ctx, sdk.VirtualMachineOption{Name: slot, Value: value})
	if err != nil {
		return "", fmt.Errorf("adding a %d GB disk on %s: %w", spec.SizeGB, spec.Storage, err)
	}
	if err := awaitTask(ctx, task, "the new disk on "+spec.Storage); err != nil {
		return "", err
	}
	return slot, nil
}

// AttachDisk puts an unused volume back into a slot.
func (d *Driver) AttachDisk(ctx context.Context, driverID, unused string) (string, error) {
	vm, err := d.vmFor(ctx, driverID)
	if err != nil {
		return "", err
	}
	cfg := configMap(vm.VirtualMachineConfig)
	volume, _ := cfg[unused].(string)
	if !strings.HasPrefix(unused, "unused") || volume == "" {
		return "", fmt.Errorf("%s is not an unused disk on this instance", unused)
	}
	slot := freeSlot(cfg)
	if slot == "" {
		return "", fmt.Errorf("no free SCSI slot on this instance")
	}
	// Naming the volume in a slot is the whole operation: Proxmox drops
	// the unusedN entry itself once something references it.
	task, err := vm.Config(ctx, sdk.VirtualMachineOption{Name: slot, Value: volume + ",discard=on"})
	if err != nil {
		return "", fmt.Errorf("attaching %s: %w", volume, err)
	}
	if err := awaitTask(ctx, task, volume+" to attach"); err != nil {
		return "", err
	}
	return slot, nil
}

// DetachDisk takes a disk out of its slot and keeps the volume.
func (d *Driver) DetachDisk(ctx context.Context, driverID, disk string) error {
	vm, err := d.vmFor(ctx, driverID)
	if err != nil {
		return err
	}
	cfg := configMap(vm.VirtualMachineConfig)
	if _, _, ok := diskAt(cfg, disk); !ok {
		return fmt.Errorf("%s is not a disk on this instance", disk)
	}
	if boot, _ := bootDisk(cfg); boot == disk {
		// The one disk that isn't a data disk. Detaching it leaves a
		// guest that cannot boot, and the button that did it would have
		// looked like every other detach.
		return fmt.Errorf("%s is the boot disk; detaching it would leave nothing to start", disk)
	}
	// force=false is the whole point: Proxmox keeps the volume and lists
	// it as unusedN, which is what makes this reversible. Passing true
	// would DESTROY it, and this capability deliberately has no way to.
	task, err := vm.UnlinkDisk(ctx, disk, false)
	if err != nil {
		return fmt.Errorf("detaching %s: %w", disk, err)
	}
	return awaitTask(ctx, task, disk+" to detach")
}
