package inventory

import "strings"

// Telling a virtual machine from a real one, from what the agent read
// off the hardware.
//
// This lives on the boundary rather than in a driver because the
// strings are the HYPERVISOR's, not the inventory service's: osquery,
// or anything else reading SMBIOS, reports "QEMU" because QEMU wrote
// it there. A second provider reading the same machine sees the same
// words, and should reach the same answer.
//
// It is derived, never stored — the same rule the OS names on the
// template picker follow. A flag in a table would be a second registry
// that goes wrong the first time a guest is migrated to different
// hardware and nothing notices.

// virtualVendors are hardware vendors that only exist in software.
// Deliberately excluded: Microsoft, Apple and Oracle, all of which
// make real computers as well as hypervisors — they are decided by
// model below.
var virtualVendors = []string{
	"qemu",
	"vmware",
	"innotek", // VirtualBox
	"xen",
	"bochs",
	"parallels",
	"amazon ec2",
	"digitalocean",
	"openstack",
	"nutanix",
	"scaleway",
	"alibaba",
	"google", // GCE reports "Google" / "Google Compute Engine"
}

// virtualModels catch the vendors that also ship metal. Hyper-V reports
// vendor "Microsoft Corporation" with model "Virtual Machine", and a
// Surface reports the same vendor with a real model name; Apple's own
// VM framework reports "Apple Inc." with "Apple Virtual Machine 1",
// which is otherwise indistinguishable from a Mac.
var virtualModels = []string{
	"virtual machine",
	"virtual platform",
	"virtualbox",
	"kvm",
	"hvm domu",
	"droplet",
	"openstack",
	"standard pc", // SeaBIOS/QEMU machine types
}

// IsVirtual reports whether the hardware a machine describes is
// emulated. Both fields are as the agent reported them; either may be
// empty, in which case this says false — "we could not tell" and
// "physical" are not the same, and the caller has better signals (a
// guest this console runs is virtual whatever SMBIOS claims).
func IsVirtual(vendor, model string) bool {
	v, m := strings.ToLower(vendor), strings.ToLower(model)
	for _, marker := range virtualModels {
		if strings.Contains(m, marker) {
			return true
		}
	}
	for _, marker := range virtualVendors {
		if strings.Contains(v, marker) {
			return true
		}
	}
	return false
}
