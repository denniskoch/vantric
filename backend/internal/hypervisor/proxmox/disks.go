package proxmox

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

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

// settle waits for a config change that turned out to be a task.
//
// The response is a UPID string when Proxmox queued work and null when
// it applied the change inline, so this asks what came back rather than
// assuming either.
func (d *Driver) settle(ctx context.Context, out any) error {
	task, ok := out.(string)
	if !ok || !strings.HasPrefix(task, "UPID:") {
		return nil
	}
	waitCtx, cancel := context.WithTimeout(ctx, diskWait)
	defer cancel()
	return d.waitForTask(waitCtx, task)
}

// configOf reads a guest's config and the node it lives on.
func (d *Driver) configOf(ctx context.Context, driverID string) (map[string]any, string, error) {
	node, err := d.node(ctx, driverID)
	if err != nil {
		return nil, "", err
	}
	var cfg map[string]any
	path := apiPath("/nodes/%s/qemu/%s/config", node, driverID)
	if err := d.do(ctx, http.MethodGet, path, nil, &cfg); err != nil {
		return nil, "", err
	}
	return cfg, node, nil
}

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
	cfg, node, err := d.configOf(ctx, driverID)
	if err != nil {
		return err
	}
	key, current, ok := diskAt(cfg, disk)
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
	return d.resizeDisk(ctx, node, driverID, key, sizeGB)
}

// resizeDisk is the call itself, shared with the create flow.
func (d *Driver) resizeDisk(ctx context.Context, node, driverID, disk string, sizeGB int) error {
	// ABSOLUTE, NOT AN INCREMENT. Proxmox's web GUI asks how much to
	// extend BY — 32 to 40 is "8" there — while the API takes either:
	// "+8G" adds to the current size, "40G" sets it. Everything in this
	// console asks for a final size, so the absolute form is the one
	// that matches the question.
	form := url.Values{"disk": {disk}, "size": {strconv.Itoa(sizeGB) + "G"}}
	var out any
	path := apiPath("/nodes/%s/qemu/%s/resize", node, driverID)
	if err := d.do(ctx, http.MethodPut, path, form, &out); err != nil {
		return fmt.Errorf("resizing %s to %dG: %w", disk, sizeGB, err)
	}
	if err := d.settle(ctx, out); err != nil {
		return fmt.Errorf("waiting for %s to grow to %dG: %w", disk, sizeGB, err)
	}
	return nil
}

// AddDisk allocates a new volume and attaches it.
func (d *Driver) AddDisk(ctx context.Context, driverID string, spec hypervisor.DiskSpec) (string, error) {
	if spec.Storage == "" {
		return "", fmt.Errorf("a storage pool is required")
	}
	if spec.SizeGB <= 0 {
		return "", fmt.Errorf("a disk size in GB is required")
	}
	cfg, node, err := d.configOf(ctx, driverID)
	if err != nil {
		return "", err
	}
	slot := freeSlot(cfg)
	if slot == "" {
		return "", fmt.Errorf("no free SCSI slot on this instance")
	}
	// "<storage>:<size in GB>" is how Proxmox is asked to ALLOCATE
	// rather than attach — the volume name is its answer, not ours.
	// discard=on so freeing space in the guest frees it on the pool,
	// which is what everything this console creates already does.
	value := fmt.Sprintf("%s:%d,discard=on", spec.Storage, spec.SizeGB)
	var out any
	path := apiPath("/nodes/%s/qemu/%s/config", node, driverID)
	if err := d.do(ctx, http.MethodPost, path, url.Values{slot: {value}}, &out); err != nil {
		return "", fmt.Errorf("adding a %d GB disk on %s: %w", spec.SizeGB, spec.Storage, err)
	}
	if err := d.settle(ctx, out); err != nil {
		return "", fmt.Errorf("waiting for the new disk on %s: %w", spec.Storage, err)
	}
	return slot, nil
}

// AttachDisk puts an unused volume back into a slot.
func (d *Driver) AttachDisk(ctx context.Context, driverID, unused string) (string, error) {
	cfg, node, err := d.configOf(ctx, driverID)
	if err != nil {
		return "", err
	}
	volume := cfgString(cfg, unused)
	if !strings.HasPrefix(unused, "unused") || volume == "" {
		return "", fmt.Errorf("%s is not an unused disk on this instance", unused)
	}
	slot := freeSlot(cfg)
	if slot == "" {
		return "", fmt.Errorf("no free SCSI slot on this instance")
	}
	// Naming the volume in a slot is the whole operation: Proxmox drops
	// the unusedN entry itself once something references it.
	var out any
	path := apiPath("/nodes/%s/qemu/%s/config", node, driverID)
	form := url.Values{slot: {volume + ",discard=on"}}
	if err := d.do(ctx, http.MethodPost, path, form, &out); err != nil {
		return "", fmt.Errorf("attaching %s: %w", volume, err)
	}
	if err := d.settle(ctx, out); err != nil {
		return "", fmt.Errorf("waiting for %s to attach: %w", volume, err)
	}
	return slot, nil
}

// DetachDisk takes a disk out of its slot and keeps the volume.
func (d *Driver) DetachDisk(ctx context.Context, driverID, disk string) error {
	cfg, node, err := d.configOf(ctx, driverID)
	if err != nil {
		return err
	}
	if _, _, ok := diskAt(cfg, disk); !ok {
		return fmt.Errorf("%s is not a disk on this instance", disk)
	}
	if boot, _ := bootDisk(cfg); boot == disk {
		// The one disk that isn't a data disk. Detaching it leaves a
		// guest that cannot boot, and the button that did it would have
		// looked like every other detach.
		return fmt.Errorf("%s is the boot disk; detaching it would leave nothing to start", disk)
	}
	// `delete` removes the reference. Proxmox keeps the volume and lists
	// it as unusedN, which is what makes this reversible.
	var out any
	path := apiPath("/nodes/%s/qemu/%s/config", node, driverID)
	if err := d.do(ctx, http.MethodPost, path, url.Values{"delete": {disk}}, &out); err != nil {
		return fmt.Errorf("detaching %s: %w", disk, err)
	}
	if err := d.settle(ctx, out); err != nil {
		return fmt.Errorf("waiting for %s to detach: %w", disk, err)
	}
	return nil
}
