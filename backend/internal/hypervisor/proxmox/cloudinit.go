package proxmox

import (
	"net/url"
	"strings"

	"lab-cloud-manager/internal/hypervisor"
)

// formatIPConfig renders an IPConfig as Proxmox's ipconfig syntax,
// e.g. "ip=192.168.1.50/24,gw=192.168.1.1,ip6=dhcp".
func formatIPConfig(c hypervisor.IPConfig) string {
	parts := []string{}
	switch {
	case c.DHCP:
		parts = append(parts, "ip=dhcp")
	case c.Address != "":
		parts = append(parts, "ip="+c.Address)
		if c.Gateway != "" {
			parts = append(parts, "gw="+c.Gateway)
		}
	}
	switch {
	case c.DHCP6:
		parts = append(parts, "ip6=dhcp")
	case c.SLAAC:
		parts = append(parts, "ip6=auto")
	case c.Address6 != "":
		parts = append(parts, "ip6="+c.Address6)
		if c.Gateway6 != "" {
			parts = append(parts, "gw6="+c.Gateway6)
		}
	}
	return strings.Join(parts, ",")
}

// applyCloudInit sets the cloud-init keys on a VM create/update form.
func applyCloudInit(form url.Values, ci hypervisor.CloudInit) {
	if ci.User != "" {
		form.Set("ciuser", ci.User)
	}
	if ci.Password != "" {
		// Proxmox hashes this itself.
		form.Set("cipassword", ci.Password)
	}
	if keys := strings.TrimSpace(ci.SSHKeys); keys != "" {
		form.Set("sshkeys", encodeSSHKeys(keys))
	}
	if ci.Nameservers != "" {
		form.Set("nameserver", ci.Nameservers)
	}
	if ci.SearchDomain != "" {
		form.Set("searchdomain", ci.SearchDomain)
	}
	if ci.UpgradePackages {
		form.Set("ciupgrade", "1")
	} else {
		// Cloud images default to upgrading on first boot, which can add
		// minutes; be explicit either way.
		form.Set("ciupgrade", "0")
	}
	if ci.Datasource != "" {
		form.Set("citype", ci.Datasource)
	}
	if ip := formatIPConfig(ci.IP); ip != "" {
		form.Set("ipconfig0", ip)
	}
}

// encodeSSHKeys renders the keys the one way Proxmox accepts.
//
// The value has to arrive percent-encoded — Proxmox url-decodes it
// itself, on top of the form decoding — and it will not take a space
// written as "+". url.QueryEscape produces exactly that, so the keys
// came through as an "invalid urlencoded string" and no VM was created.
// Percent-encoding the spaces instead is the whole fix; newlines
// between several keys become %0A the same way.
func encodeSSHKeys(keys string) string {
	return strings.ReplaceAll(url.QueryEscape(keys), "+", "%20")
}
