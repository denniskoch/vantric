package api

import (
	"fmt"
	"net/netip"
	"slices"
	"strings"

	"vantric/internal/hypervisor"
)

// cloudInitRequest is the wire shape of guest configuration, shared by
// the create-instance and build-template endpoints.
type cloudInitRequest struct {
	User            string `json:"user"`
	Password        string `json:"password"`
	SSHKeys         string `json:"sshKeys"`
	Nameservers     string `json:"nameservers"`
	SearchDomain    string `json:"searchDomain"`
	UpgradePackages bool   `json:"upgradePackages"`
	Datasource      string `json:"datasource"`
	DHCP            bool   `json:"dhcp"`
	Address         string `json:"address"`
	Gateway         string `json:"gateway"`
	IPv6Mode        string `json:"ipv6Mode"` // none | dhcp | slaac | static
	Address6        string `json:"address6"`
	Gateway6        string `json:"gateway6"`
}

var cloudInitDatasources = []string{"nocloud", "configdrive2"}

// toCloudInit validates the request and converts it to the driver type.
func (r cloudInitRequest) toCloudInit() (hypervisor.CloudInit, error) {
	ci := hypervisor.CloudInit{
		User:            strings.TrimSpace(r.User),
		Password:        r.Password,
		SSHKeys:         r.SSHKeys,
		SearchDomain:    strings.TrimSpace(r.SearchDomain),
		UpgradePackages: r.UpgradePackages,
		Datasource:      r.Datasource,
	}
	if ci.Datasource != "" && !slices.Contains(cloudInitDatasources, ci.Datasource) {
		return ci, fmt.Errorf("datasource must be one of %s", strings.Join(cloudInitDatasources, ", "))
	}
	// Nameservers are space or comma separated in Proxmox; accept either
	// and validate each.
	if ns := strings.TrimSpace(r.Nameservers); ns != "" {
		fields := strings.FieldsFunc(ns, func(c rune) bool { return c == ',' || c == ' ' })
		for _, f := range fields {
			if _, err := netip.ParseAddr(f); err != nil {
				return ci, fmt.Errorf("nameserver %q is not an IP address", f)
			}
		}
		ci.Nameservers = strings.Join(fields, " ")
	}

	ip := hypervisor.IPConfig{DHCP: r.DHCP}
	if !r.DHCP && strings.TrimSpace(r.Address) != "" {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(r.Address))
		if err != nil {
			return ci, fmt.Errorf("address must be in CIDR form, e.g. 192.168.1.50/24")
		}
		ip.Address = prefix.String()
		if gw := strings.TrimSpace(r.Gateway); gw != "" {
			if _, err := netip.ParseAddr(gw); err != nil {
				return ci, fmt.Errorf("gateway %q is not an IP address", gw)
			}
			ip.Gateway = gw
		}
	}
	switch r.IPv6Mode {
	case "", "none":
	case "dhcp":
		ip.DHCP6 = true
	case "slaac":
		ip.SLAAC = true
	case "static":
		prefix, err := netip.ParsePrefix(strings.TrimSpace(r.Address6))
		if err != nil {
			return ci, fmt.Errorf("IPv6 address must be in CIDR form, e.g. 2001:db8::5/64")
		}
		ip.Address6 = prefix.String()
		if gw := strings.TrimSpace(r.Gateway6); gw != "" {
			if _, err := netip.ParseAddr(gw); err != nil {
				return ci, fmt.Errorf("IPv6 gateway %q is not an IP address", gw)
			}
			ip.Gateway6 = gw
		}
	default:
		return ci, fmt.Errorf("ipv6Mode must be none, dhcp, slaac or static")
	}
	ci.IP = ip
	return ci, nil
}
