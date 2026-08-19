package inventory

import "testing"

// The vendor and model strings from this lab's own estate, plus the
// ones that make the naive version wrong. Getting this backwards files
// a laptop under virtual machines or hides a guest from the page that
// tracks enrolment, and neither announces itself.
func TestIsVirtual(t *testing.T) {
	cases := []struct {
		vendor, model string
		want          bool
		why           string
	}{
		// Real rows from this estate.
		{"QEMU", "Standard PC (Q35 + ICH9, 2009)", true, "every guest here"},
		{"QEMU", "Standard PC (i440FX + PIIX, 1996)", true, "older machine type"},
		{"Apple Inc.", "Macmini9,1", false, "a Mac mini"},
		{"Apple Inc.", "Mac16,10", false, "a Mac"},
		{"Micro-Star International Co., Ltd.", "MS-7E26", false, "an MSI board"},

		// The vendors that ship both metal and hypervisors — decided by
		// model, which is the whole reason model is checked first.
		{"Microsoft Corporation", "Virtual Machine", true, "Hyper-V"},
		{"Microsoft Corporation", "Surface Laptop 5", false, "real Microsoft hardware"},
		{"Apple Inc.", "Apple Virtual Machine 1", true, "Apple's own VM framework"},
		{"Oracle Corporation", "VirtualBox", true, "VirtualBox by model"},
		{"Oracle Corporation", "SUN FIRE X4170 M2", false, "an actual Sun box"},

		// Other hypervisors and clouds.
		{"VMware, Inc.", "VMware Virtual Platform", true, "ESXi"},
		{"innotek GmbH", "VirtualBox", true, "older VirtualBox"},
		{"Xen", "HVM domU", true, "Xen"},
		{"Amazon EC2", "t3.medium", true, "EC2"},
		{"DigitalOcean", "Droplet", true, "DigitalOcean"},
		{"Parallels International GmbH", "Parallels Virtual Platform", true, "Parallels"},
		{"Red Hat", "KVM", true, "libvirt/KVM by model"},

		// No data is not a claim either way.
		{"", "", false, "nothing reported"},
	}
	for _, c := range cases {
		if got := IsVirtual(c.vendor, c.model); got != c.want {
			t.Errorf("IsVirtual(%q, %q) = %v, want %v — %s", c.vendor, c.model, got, c.want, c.why)
		}
	}
}
