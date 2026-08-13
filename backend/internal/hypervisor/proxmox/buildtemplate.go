package proxmox

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"lab-cloud-manager/internal/hypervisor"
)

// CloudImages lists disk images in datastores' "import" content, which
// is what import-from can build a template from.
func (d *Driver) CloudImages(ctx context.Context) ([]hypervisor.CloudImage, error) {
	items, err := d.storageContent(ctx, "import")
	if err != nil {
		return nil, err
	}
	images := make([]hypervisor.CloudImage, 0, len(items))
	for _, it := range items {
		images = append(images, hypervisor.CloudImage{
			ID: it.VolID, Name: it.Name, Zone: it.Node, Storage: it.Storage,
			SizeBytes: it.SizeBytes, CreatedAt: it.CreatedAt,
		})
	}
	return images, nil
}

// waitForTask polls a UPID until it stops, returning an error if the
// task failed.
func (d *Driver) waitForTask(ctx context.Context, taskID string) error {
	if taskID == "" {
		return nil
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		status, err := d.TaskStatus(ctx, taskID)
		if err != nil {
			return err
		}
		if !status.Running {
			if !status.Succeeded {
				return fmt.Errorf("proxmox: task failed: %s", status.ExitStatus)
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

// BuildTemplate creates a VM from a cloud disk image and converts it to
// a template. This is the API equivalent of the usual qm recipe: create
// with import-from, attach a cloud-init drive, wire up a serial console
// (cloud images expect one), then `qm template`.
func (d *Driver) BuildTemplate(ctx context.Context, spec hypervisor.TemplateSpec, progress func(string)) (string, error) {
	step := func(s string) {
		if progress != nil {
			progress(s)
		}
	}

	step("Allocating a VM ID")
	var vmid string
	if err := d.do(ctx, http.MethodGet, "/cluster/nextid", nil, &vmid); err != nil {
		return "", fmt.Errorf("allocating vmid: %w", err)
	}

	bios := spec.BIOS
	if bios == "" {
		bios = "seabios"
	}
	machine := spec.MachineType
	if machine == "" {
		machine = "q35"
	}

	form := url.Values{
		"vmid":    {vmid},
		"name":    {spec.Name},
		"ostype":  {"l26"},
		"cpu":     {"host"},
		"cores":   {strconv.Itoa(spec.CPUs)},
		"sockets": {"1"},
		"memory":  {strconv.Itoa(spec.MemoryMB)},
		"machine": {machine},
		"bios":    {bios},
		"scsihw":  {"virtio-scsi-single"},
		// import-from converts the cloud image into a disk on the target
		// storage; ":0" means "size comes from the image".
		"scsi0": {fmt.Sprintf("%s:0,import-from=%s,discard=on,ssd=1", spec.DiskStorage, spec.SourceVolume)},
		"ide2":  {fmt.Sprintf("%s:cloudinit", spec.DiskStorage)},
		"boot":  {"order=scsi0"},
		// Cloud images log to the serial console and often ship no
		// graphics driver, so make serial the display.
		"serial0": {"socket"},
		"vga":     {"serial0"},
	}
	if spec.EnableAgent {
		form.Set("agent", "1")
	}
	if spec.NetworkBridge != "" {
		net0 := "virtio,bridge=" + spec.NetworkBridge
		if spec.VLANTag > 0 {
			net0 += fmt.Sprintf(",tag=%d", spec.VLANTag)
		}
		form.Set("net0", net0)
	}
	if bios == "ovmf" {
		// UEFI needs somewhere to keep its variables.
		form.Set("efidisk0", fmt.Sprintf("%s:0,efitype=4m,pre-enrolled-keys=0", spec.DiskStorage))
	}
	if spec.CloudInitUser != "" {
		form.Set("ciuser", spec.CloudInitUser)
	}
	if keys := strings.TrimSpace(spec.SSHKeys); keys != "" {
		form.Set("sshkeys", url.QueryEscape(keys))
	}
	if spec.IPConfig != "" {
		form.Set("ipconfig0", spec.IPConfig)
	}
	if spec.Description != "" {
		form.Set("description", spec.Description)
	}

	step("Creating the VM and importing the disk")
	var createTask string
	if err := d.do(ctx, http.MethodPost, fmt.Sprintf("/nodes/%s/qemu", spec.Zone), form, &createTask); err != nil {
		return "", fmt.Errorf("creating VM: %w", err)
	}
	d.mu.Lock()
	d.nodeOf[vmid] = spec.Zone
	d.mu.Unlock()
	if err := d.waitForTask(ctx, createTask); err != nil {
		return "", fmt.Errorf("importing disk: %w", err)
	}

	// Cloud images ship small (2-4 GB); grow to the requested size.
	if spec.DiskGB > 0 {
		step(fmt.Sprintf("Resizing the disk to %d GB", spec.DiskGB))
		resize := url.Values{"disk": {"scsi0"}, "size": {fmt.Sprintf("%dG", spec.DiskGB)}}
		path := fmt.Sprintf("/nodes/%s/qemu/%s/resize", spec.Zone, vmid)
		if err := d.do(ctx, http.MethodPut, path, resize, nil); err != nil {
			// A smaller-than-current request is refused; that's not fatal.
			step("Disk left at the image's own size")
		}
	}

	step("Converting to a template")
	path := fmt.Sprintf("/nodes/%s/qemu/%s/template", spec.Zone, vmid)
	if err := d.do(ctx, http.MethodPost, path, url.Values{}, nil); err != nil {
		return "", fmt.Errorf("converting to template: %w", err)
	}
	step("Template ready")
	return vmid, nil
}
