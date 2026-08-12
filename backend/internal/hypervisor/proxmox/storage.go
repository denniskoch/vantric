package proxmox

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"lab-cloud-manager/internal/hypervisor"
)

// diskKeyRe matches VM config keys that carry attached disks. EFI/TPM
// state volumes are intentionally excluded.
var diskKeyRe = regexp.MustCompile(`^(scsi|virtio|sata|ide)\d+$`)

// Disks lists every disk attached to a (non-template) VM by parsing
// each VM's config, e.g. "scsi0": "local-lvm:vm-101-disk-0,size=32G".
func (d *Driver) Disks(ctx context.Context) ([]hypervisor.Disk, error) {
	vms, err := d.clusterVMs(ctx)
	if err != nil {
		return nil, err
	}
	disks := []hypervisor.Disk{}
	for _, vm := range vms {
		if vm.Template == 1 || vm.Type != "qemu" {
			continue
		}
		var cfg map[string]any
		path := fmt.Sprintf("/nodes/%s/qemu/%d/config", vm.Node, vm.VMID)
		if err := d.do(ctx, http.MethodGet, path, nil, &cfg); err != nil {
			continue // VM may be mid-migration/deletion; skip
		}
		for key, raw := range cfg {
			val, ok := raw.(string)
			if !ok || !diskKeyRe.MatchString(key) || strings.Contains(val, "media=cdrom") {
				continue
			}
			disks = append(disks, parseDisk(key, val, vm))
		}
	}
	return disks, nil
}

func parseDisk(key, val string, vm clusterVM) hypervisor.Disk {
	disk := hypervisor.Disk{
		ID:      fmt.Sprintf("%d/%s", vm.VMID, key),
		Name:    key,
		InUseBy: vm.Name,
		Zone:    vm.Node,
	}
	parts := strings.Split(val, ",")
	if vol := parts[0]; strings.Contains(vol, ":") {
		storageAndName := strings.SplitN(vol, ":", 2)
		disk.Storage = storageAndName[0]
		disk.Name = storageAndName[1]
	}
	for _, part := range parts[1:] {
		if after, found := strings.CutPrefix(part, "size="); found {
			disk.SizeGB = parseSizeGB(after)
		}
	}
	return disk
}

// parseSizeGB converts Proxmox size strings ("32G", "512M", "1T") to GB.
func parseSizeGB(s string) int {
	if s == "" {
		return 0
	}
	unit := s[len(s)-1]
	n, err := strconv.Atoi(s[:len(s)-1])
	if err != nil {
		return 0
	}
	switch unit {
	case 'T':
		return n * 1024
	case 'G':
		return n
	case 'M':
		return (n + 1023) / 1024
	default:
		return 0
	}
}

// Snapshots lists snapshots of every (non-template) VM.
func (d *Driver) Snapshots(ctx context.Context) ([]hypervisor.Snapshot, error) {
	vms, err := d.clusterVMs(ctx)
	if err != nil {
		return nil, err
	}
	snapshots := []hypervisor.Snapshot{}
	for _, vm := range vms {
		if vm.Template == 1 || vm.Type != "qemu" {
			continue
		}
		var snaps []struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			SnapTime    int64  `json:"snaptime"`
			VMState     int    `json:"vmstate"`
		}
		path := fmt.Sprintf("/nodes/%s/qemu/%d/snapshot", vm.Node, vm.VMID)
		if err := d.do(ctx, http.MethodGet, path, nil, &snaps); err != nil {
			continue
		}
		for _, s := range snaps {
			// "current" is the you-are-here pseudo entry, not a snapshot.
			if s.Name == "current" {
				continue
			}
			snapshots = append(snapshots, hypervisor.Snapshot{
				ID:          fmt.Sprintf("%d/%s", vm.VMID, s.Name),
				Name:        s.Name,
				VMName:      vm.Name,
				Zone:        vm.Node,
				Description: strings.TrimSpace(s.Description),
				CreatedAt:   s.SnapTime,
				IncludesRAM: s.VMState == 1,
			})
		}
	}
	return snapshots, nil
}
