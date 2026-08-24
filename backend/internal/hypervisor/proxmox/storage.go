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

// Disks lists every VM disk, IN ALL THREE STATES IT CAN BE IN.
//
// Attached ones come from each VM's config ("scsi0":
// "local-lvm:vm-101-disk-0,size=32G"). Detached ones come from the same
// place under Proxmox's `unusedN` keys, which is where a detached
// volume sits rather than disappearing. And ORPHANS come from the
// datastore itself, cross-referenced against every config: a volume
// nothing mentions is what a guest deleted outside this console leaves
// behind, it costs its space forever, and no page in Proxmox lists it
// as a problem either.
//
// THE CROSS-REFERENCE HAS TO SEE EVERY GUEST, templates and containers
// included. A template's disk is referenced by a config this used to
// skip, and calling that orphaned would offer to delete the disk of
// every VM template in the lab.
func (d *Driver) Disks(ctx context.Context) ([]hypervisor.Disk, error) {
	vms, err := d.clusterVMs(ctx)
	if err != nil {
		return nil, err
	}
	disks := []hypervisor.Disk{}
	// Every volume id any guest refers to, in any slot, and every vmid
	// that exists at all — the two sets an orphan has to be outside of.
	referenced := map[string]bool{}
	live := map[int]bool{}

	for _, vm := range vms {
		kind := "qemu"
		if vm.Type == "lxc" {
			kind = "lxc"
		}
		var cfg map[string]any
		path := apiPath("/nodes/%s/%s/%d/config", vm.Node, kind, vm.VMID)
		if err := d.do(ctx, http.MethodGet, path, nil, &cfg); err != nil {
			// A VM mid-migration or mid-deletion answers nothing. It is
			// SKIPPED FOR LISTING AND FOR THE CROSS-REFERENCE ALIKE, and
			// that asymmetry matters: a config we could not read is a
			// config whose volumes we cannot claim are unreferenced, so
			// nothing from that guest can be called an orphan below.
			continue
		}
		// EVERY GUEST'S VMID, whether its config could be read or not.
		// The strongest orphan test is not "no config mentions this
		// volume" but "no guest with that id exists" — Proxmox names a
		// volume vm-<vmid>-… and a live guest owns things its CURRENT
		// config never mentions: the RAM a snapshot saved, and the
		// disks older snapshots still point at. Both of those looked
		// like orphans until this lab was asked.
		live[vm.VMID] = true

		for key, raw := range cfg {
			val, ok := raw.(string)
			if !ok {
				continue
			}
			// REFERENCED FIRST, SKIPPED SECOND. A cloud-init drive is
			// `ide2: local-zhdd:vm-100-cloudinit,media=cdrom` — not a
			// disk worth listing, but very much a volume in use, and
			// registering it after the cdrom check called thirteen live
			// guests' cloud-init drives orphaned.
			if volid := volumeIDOf(val); volid != "" {
				referenced[volid] = true
			}
			if strings.Contains(val, "media=cdrom") {
				continue
			}
			attached := diskKeyRe.MatchString(key)
			detached := unusedKeyRe.MatchString(key)
			if !attached && !detached {
				continue
			}
			switch {
			case attached && vm.Type == "qemu" && vm.Template != 1:
				disks = append(disks, parseDisk(key, val, vm, hypervisor.DiskAttached))
			case detached && vm.Type == "qemu" && vm.Template != 1:
				disks = append(disks, parseDisk(key, val, vm, hypervisor.DiskDetached))
			}
		}
	}

	// Orphans. Best effort: a datastore that will not list its contents
	// costs the finding, not the page.
	if volumes, err := d.storageContent(ctx, "images"); err == nil {
		for _, v := range volumes {
			// Belt and braces: not mentioned by any config, AND not
			// belonging to a guest that exists. The second is what
			// keeps a snapshot's saved RAM out of the list.
			if referenced[v.VolID] || live[v.VMID] || live[vmidFromVolume(v.Name)] {
				continue
			}
			disks = append(disks, hypervisor.Disk{
				ID:         v.VolID,
				Name:       v.Name,
				Node:       v.Node,
				Storage:    v.Storage,
				SizeGB:     int(v.SizeBytes >> 30),
				Attachment: hypervisor.DiskOrphaned,
				VolumeID:   v.VolID,
			})
		}
	}
	return disks, nil
}

// unusedKeyRe matches the slot Proxmox parks a detached volume in.
var unusedKeyRe = regexp.MustCompile(`^unused\d+$`)

// vmVolumeRe reads the guest id out of a volume name —
// "vm-1006-state-post-install", "vm-100-disk-0", "subvol-2030-disk-0".
var vmVolumeRe = regexp.MustCompile(`^(?:vm|subvol|base)-(\d+)-`)

// vmidFromVolume is the fallback for a datastore that reports no vmid
// of its own. Zero when the name says nothing, which no live guest
// matches.
func vmidFromVolume(name string) int {
	m := vmVolumeRe.FindStringSubmatch(name)
	if m == nil {
		return 0
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

// volumeIDOf takes the volume id off the front of a config value —
// "local-lvm:vm-101-disk-0,size=32G" — and returns nothing for the
// values that hold no volume at all, like "none" or a raw device path.
func volumeIDOf(val string) string {
	head, _, _ := strings.Cut(val, ",")
	if !strings.Contains(head, ":") || strings.HasPrefix(head, "/") {
		return ""
	}
	return head
}

func parseDisk(key, val string, vm clusterVM, attachment string) hypervisor.Disk {
	spec := parseDiskSpec(key, val)
	disk := hypervisor.Disk{
		ID:         fmt.Sprintf("%d/%s", vm.VMID, key),
		Name:       spec.Name,
		InUseBy:    vm.Name,
		Node:       vm.Node,
		Storage:    spec.Storage,
		SizeGB:     int(spec.SizeBytes >> 30),
		Attachment: attachment,
		VolumeID:   volumeIDOf(val),
	}
	// The guest is kept for a DETACHED volume too: it is not in use,
	// but that guest's config is still where the volume lives and where
	// you would go to re-attach or remove it. The attachment column is
	// what says which of the two this is.
	return disk
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
