package proxmox

import "strings"

// A CLONE INHERITS THE TEMPLATE'S DISK. Nothing in the clone call takes
// a size, so "Boot disk size" on the create form was collected, sent and
// stored against the record — and never acted on. The number then went
// away quietly: the reconciler reads the real size back off the
// hypervisor, so the list ends up truthful and the request ends up
// forgotten, which is the shape of bug nobody reports for months.
//
// Growing it is a second call, and to make it you have to know WHICH
// disk. The template build resizes scsi0 because it created scsi0; an
// arbitrary template can boot from virtio0, sata0 or ide0, and guessing
// wrong either fails or grows something else.

// diskKeyOrder is the fallback search, most likely first. Deliberately
// bounded: Proxmox allows scsi0-30, and a template whose boot disk is
// scsi17 while scsi0-16 are absent is not a case worth a loop.
var diskKeyOrder = []string{
	"scsi0", "scsi1", "scsi2", "scsi3",
	"virtio0", "virtio1", "virtio2", "virtio3",
	"sata0", "sata1", "sata2", "sata3",
	"ide0", "ide1", "ide2", "ide3",
}

// bootDisk is the config key of the disk a guest boots from, and its
// current size in GB. Either may be empty/zero, which the caller reads
// as "don't guess".
//
// `boot` is authoritative where it exists — Proxmox writes
// "order=scsi0;net0" — and the fallback is a scan in the usual order.
// Both skip media=cdrom, which is how an ISO drive AND the cloud-init
// drive are spelled: growing the cloud-init drive would be a confident,
// useless success.
func bootDisk(cfg map[string]any) (key string, sizeGB int) {
	if order := cfgString(cfg, "boot"); order != "" {
		if _, after, found := strings.Cut(order, "order="); found {
			for _, entry := range strings.Split(after, ";") {
				if k, size, ok := diskAt(cfg, strings.TrimSpace(entry)); ok {
					return k, size
				}
			}
		}
	}
	for _, candidate := range diskKeyOrder {
		if k, size, ok := diskAt(cfg, candidate); ok {
			return k, size
		}
	}
	return "", 0
}

// diskAt reports the disk at a config key, if that key holds one.
func diskAt(cfg map[string]any, key string) (string, int, bool) {
	if key == "" || !diskKeyRe.MatchString(key) {
		return "", 0, false
	}
	value := cfgString(cfg, key)
	if value == "" || strings.HasPrefix(value, "none") {
		return "", 0, false
	}
	// parseDiskSpec already reads the size and the media, and is what
	// the disk catalogue and the detail page use.
	spec := parseDiskSpec(key, value)
	if spec.Media == "cdrom" {
		return "", 0, false
	}
	// Rounds DOWN, deliberately: a disk written as 10500M is more than
	// 10G, and calling it 10 then "growing" it to 10G is a request
	// Proxmox refuses as a shrink.
	return key, int(spec.SizeBytes >> 30), true
}
