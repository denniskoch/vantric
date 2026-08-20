package proxmox

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"vantric/internal/hypervisor"
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
		path := apiPath("/nodes/%s/qemu/%d/config", vm.Node, vm.VMID)
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
	spec := parseDiskSpec(key, val)
	return hypervisor.Disk{
		ID:      fmt.Sprintf("%d/%s", vm.VMID, key),
		Name:    spec.Name,
		InUseBy: vm.Name,
		Node:    vm.Node,
		Storage: spec.Storage,
		SizeGB:  int(spec.SizeBytes >> 30),
	}
}

// parseSizeBytes converts Proxmox size strings ("32G", "512M", "1T",
// "528K") to bytes. A bare number is already bytes.
func parseSizeBytes(s string) int64 {
	if s == "" {
		return 0
	}
	unit := s[len(s)-1]
	if unit >= '0' && unit <= '9' {
		n, _ := strconv.ParseInt(s, 10, 64)
		return n
	}
	n, err := strconv.ParseInt(s[:len(s)-1], 10, 64)
	if err != nil {
		return 0
	}
	switch unit {
	case 'T':
		return n << 40
	case 'G':
		return n << 30
	case 'M':
		return n << 20
	case 'K':
		return n << 10
	default:
		return 0
	}
}

type clusterStorage struct {
	Storage    string `json:"storage"`
	Node       string `json:"node"`
	PluginType string `json:"plugintype"`
	Content    string `json:"content"`
	Status     string `json:"status"`
	Shared     int    `json:"shared"`
	MaxDisk    int64  `json:"maxdisk"`
	Disk       int64  `json:"disk"`
}

func (d *Driver) clusterStorages(ctx context.Context) ([]clusterStorage, error) {
	var storages []clusterStorage
	err := d.do(ctx, http.MethodGet, "/cluster/resources?type=storage", nil, &storages)
	return storages, err
}

// Datastores lists every storage pool known to the cluster.
func (d *Driver) Datastores(ctx context.Context) ([]hypervisor.Datastore, error) {
	storages, err := d.clusterStorages(ctx)
	if err != nil {
		return nil, err
	}
	datastores := []hypervisor.Datastore{}
	for _, s := range storages {
		datastores = append(datastores, hypervisor.Datastore{
			ID:         s.Node + "/" + s.Storage,
			Name:       s.Storage,
			Node:       s.Node,
			Type:       s.PluginType,
			Content:    s.Content,
			TotalBytes: s.MaxDisk,
			UsedBytes:  s.Disk,
			Active:     s.Status == "available",
			Shared:     s.Shared == 1,
		})
	}
	return datastores, nil
}

// contentItem is one volume of a given content type on a datastore.
type contentItem struct {
	VolID     string
	Name      string
	Node      string
	Storage   string
	SizeBytes int64
	CreatedAt int64
	// Backup-only fields; zero for every other content type.
	VMID      int
	Format    string
	Notes     string
	Protected bool
	Subtype   string
}

// storageContent lists volumes of one content type ("iso", "vztmpl")
// across every datastore that holds it. Shared datastores appear once
// per node in cluster resources, so volumes are deduplicated by ID.
func (d *Driver) storageContent(ctx context.Context, contentType string) ([]contentItem, error) {
	storages, err := d.clusterStorages(ctx)
	if err != nil {
		return nil, err
	}
	items := []contentItem{}
	seen := map[string]bool{}
	for _, s := range storages {
		if !strings.Contains(s.Content, contentType) || s.Status != "available" {
			continue
		}
		var content []struct {
			VolID string `json:"volid"`
			Size  int64  `json:"size"`
			CTime int64  `json:"ctime"`
			// Backups report which guest they came from and how they
			// were written; other content types leave these empty.
			VMID      int    `json:"vmid"`
			Format    string `json:"format"`
			Notes     string `json:"notes"`
			Protected bool   `json:"protected"`
			Subtype   string `json:"subtype"`
		}
		// content is a query value, not a path segment — see apiPath.
		path := apiPath("/nodes/%s/storage/%s/content", s.Node, s.Storage) +
			"?content=" + url.QueryEscape(contentType)
		if err := d.do(ctx, http.MethodGet, path, nil, &content); err != nil {
			continue
		}
		for _, c := range content {
			if seen[c.VolID] {
				continue
			}
			seen[c.VolID] = true
			name := c.VolID
			if idx := strings.LastIndex(name, "/"); idx >= 0 {
				name = name[idx+1:]
			}
			items = append(items, contentItem{
				VolID:     c.VolID,
				Name:      name,
				Node:      s.Node,
				Storage:   s.Storage,
				SizeBytes: c.Size,
				CreatedAt: c.CTime,
				VMID:      c.VMID,
				Format:    c.Format,
				Notes:     c.Notes,
				Protected: c.Protected,
				Subtype:   c.Subtype,
			})
		}
	}
	return items, nil
}

// ISOs lists ISO images across every datastore that holds them.
func (d *Driver) ISOs(ctx context.Context) ([]hypervisor.ISO, error) {
	items, err := d.storageContent(ctx, "iso")
	if err != nil {
		return nil, err
	}
	isos := make([]hypervisor.ISO, 0, len(items))
	for _, it := range items {
		isos = append(isos, hypervisor.ISO{
			ID: it.VolID, Name: it.Name, Node: it.Node, Storage: it.Storage,
			SizeBytes: it.SizeBytes, CreatedAt: it.CreatedAt,
		})
	}
	return isos, nil
}

// CTTemplates lists container templates (vztmpl tarballs).
func (d *Driver) CTTemplates(ctx context.Context) ([]hypervisor.CTTemplate, error) {
	items, err := d.storageContent(ctx, "vztmpl")
	if err != nil {
		return nil, err
	}
	templates := make([]hypervisor.CTTemplate, 0, len(items))
	for _, it := range items {
		templates = append(templates, hypervisor.CTTemplate{
			ID: it.VolID, Name: it.Name, Node: it.Node, Storage: it.Storage,
			SizeBytes: it.SizeBytes, CreatedAt: it.CreatedAt,
		})
	}
	return templates, nil
}

// Backups lists vzdump archives across every datastore holding them,
// naming the guest each came from where that guest still exists.
func (d *Driver) Backups(ctx context.Context) ([]hypervisor.Backup, error) {
	items, err := d.storageContent(ctx, "backup")
	if err != nil {
		return nil, err
	}
	names := map[int]string{}
	if vms, err := d.clusterVMs(ctx); err == nil {
		for _, vm := range vms {
			names[vm.VMID] = vm.Name
		}
	}
	backups := make([]hypervisor.Backup, 0, len(items))
	for _, it := range items {
		backups = append(backups, hypervisor.Backup{
			ID: it.VolID, Name: it.Name, Node: it.Node, Storage: it.Storage,
			SizeBytes: it.SizeBytes, CreatedAt: it.CreatedAt,
			VMID: it.VMID, GuestName: names[it.VMID], GuestType: it.Subtype,
			Format: it.Format, Notes: it.Notes, Protected: it.Protected,
		})
	}
	return backups, nil
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
		path := apiPath("/nodes/%s/qemu/%d/snapshot", vm.Node, vm.VMID)
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
				Node:        vm.Node,
				Description: strings.TrimSpace(s.Description),
				CreatedAt:   s.SnapTime,
				IncludesRAM: s.VMState == 1,
			})
		}
	}
	return snapshots, nil
}
