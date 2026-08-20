package proxmox

import "testing"

// Which disk a guest boots from decides which disk gets grown. The
// template build resizes scsi0 because it created scsi0; a template
// somebody else built can boot from anywhere, and the two wrong answers
// are "fail" and "grow the cloud-init drive".
func TestBootDisk(t *testing.T) {
	cases := []struct {
		name    string
		cfg     map[string]any
		wantKey string
		wantGB  int
	}{
		{
			name: "boot order names it",
			cfg: map[string]any{
				"boot":  "order=scsi0;net0",
				"scsi0": "local-lvm:vm-101-disk-0,size=10G",
				"ide2":  "local-lvm:vm-101-cloudinit,media=cdrom",
			},
			wantKey: "scsi0", wantGB: 10,
		},
		{
			// The cloud-init drive is ide2 and comes FIRST in the scan
			// order only if we forget to skip cdroms. Growing it would
			// succeed at nothing.
			name: "the cloud-init drive is never the boot disk",
			cfg: map[string]any{
				"ide2":    "local-lvm:vm-101-cloudinit,media=cdrom",
				"virtio0": "tank:vm-101-disk-0,size=40G",
			},
			wantKey: "virtio0", wantGB: 40,
		},
		{
			name: "an ISO in the boot order is skipped for the disk after it",
			cfg: map[string]any{
				"boot":  "order=ide0;scsi0",
				"ide0":  "local:iso/debian.iso,media=cdrom",
				"scsi0": "local-lvm:vm-101-disk-0,size=20G",
			},
			wantKey: "scsi0", wantGB: 20,
		},
		{
			name: "no boot key, falls back to the scan",
			cfg: map[string]any{
				"sata0": "local-lvm:vm-101-disk-0,size=8G",
			},
			wantKey: "sata0", wantGB: 8,
		},
		{
			name: "an empty bay is not a disk",
			cfg: map[string]any{
				"ide0":  "none,media=cdrom",
				"scsi0": "local-lvm:vm-101-disk-0,size=32G",
			},
			wantKey: "scsi0", wantGB: 32,
		},
		{
			// Rounds DOWN. Calling this 10 and then "growing" it to 10G
			// is a shrink, which Proxmox refuses.
			name: "megabytes round down, not to nearest",
			cfg: map[string]any{
				"scsi0": "local-lvm:vm-101-disk-0,size=10500M",
			},
			wantKey: "scsi0", wantGB: 10,
		},
		{
			name:    "a VM with no disk at all",
			cfg:     map[string]any{"ide2": "local-lvm:vm-101-cloudinit,media=cdrom"},
			wantKey: "", wantGB: 0,
		},
		{
			// EFI and TPM state volumes look like disks and are not.
			name: "efi and tpm state are not boot disks",
			cfg: map[string]any{
				"efidisk0":  "local-lvm:vm-101-disk-1,size=4M",
				"tpmstate0": "local-lvm:vm-101-disk-2,size=4M",
				"scsi0":     "local-lvm:vm-101-disk-0,size=16G",
			},
			wantKey: "scsi0", wantGB: 16,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			key, gb := bootDisk(c.cfg)
			if key != c.wantKey || gb != c.wantGB {
				t.Errorf("got (%q, %d), want (%q, %d)", key, gb, c.wantKey, c.wantGB)
			}
		})
	}
}
