package proxmox

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"lab-cloud-manager/internal/hypervisor"
)

var netKeyRe = regexp.MustCompile(`^net\d+$`)

// nicModels are the config keys Proxmox uses to name a NIC's model; the
// model is the key of a netN value's first pair (e.g. "virtio=AA:BB:…").
var nicModels = map[string]bool{
	"virtio": true, "e1000": true, "e1000e": true, "rtl8139": true,
	"vmxnet3": true, "ne2k_pci": true, "pcnet": true, "i82551": true,
}

// config value helpers: Proxmox returns a mixed map of strings/numbers.

func cfgString(cfg map[string]any, key string) string {
	switch v := cfg[key].(type) {
	case string:
		return v
	case float64:
		return strconv.Itoa(int(v))
	default:
		return ""
	}
}

func cfgInt(cfg map[string]any, key string) int {
	switch v := cfg[key].(type) {
	case float64:
		return int(v)
	case string:
		n, _ := strconv.Atoi(v)
		return n
	default:
		return 0
	}
}

func cfgBool(cfg map[string]any, key string) bool {
	return cfgInt(cfg, key) == 1
}

// parseDiskSpec parses a disk config value such as
// "local-lvm:vm-101-disk-0,size=32G,ssd=1,discard=on" or a CD-ROM entry
// "local:iso/debian.iso,media=cdrom".
func parseDiskSpec(iface, val string) hypervisor.AttachedDisk {
	parts := strings.Split(val, ",")
	disk := hypervisor.AttachedDisk{Interface: iface, Name: parts[0], Media: "disk"}
	if vol := parts[0]; strings.Contains(vol, ":") {
		storageAndName := strings.SplitN(vol, ":", 2)
		disk.Storage = storageAndName[0]
		disk.Name = storageAndName[1]
	}
	for _, part := range parts[1:] {
		key, value, found := strings.Cut(part, "=")
		if !found {
			continue
		}
		switch key {
		case "size":
			disk.SizeGB = parseSizeGB(value)
		case "media":
			disk.Media = value
		case "ssd":
			disk.SSD = value == "1"
		case "discard":
			disk.Discard = value == "on"
		}
	}
	return disk
}

// parseNIC parses "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=20,firewall=1".
func parseNIC(name, val string) hypervisor.NIC {
	nic := hypervisor.NIC{Name: name}
	for _, part := range strings.Split(val, ",") {
		key, value, found := strings.Cut(part, "=")
		if !found {
			continue
		}
		switch {
		case nicModels[key]:
			nic.Model = key
			nic.MAC = strings.ToUpper(value)
		case key == "model":
			nic.Model = value
		case key == "macaddr":
			nic.MAC = strings.ToUpper(value)
		case key == "bridge":
			nic.Bridge = value
		case key == "tag":
			nic.VLANTag, _ = strconv.Atoi(value)
		case key == "firewall":
			nic.Firewall = value == "1"
		}
	}
	return nic
}

// creationTime reads the ctime Proxmox records in the "meta" config key
// (e.g. "creation-qemu=8.1.5,ctime=1712534138"). Older VMs lack it.
func creationTime(meta string) int64 {
	for _, part := range strings.Split(meta, ",") {
		if after, found := strings.CutPrefix(part, "ctime="); found {
			t, _ := strconv.ParseInt(after, 10, 64)
			return t
		}
	}
	return 0
}

// Describe reads a VM's full configuration plus live status.
func (d *Driver) Describe(ctx context.Context, driverID string) (*hypervisor.InstanceDetail, error) {
	node, err := d.node(ctx, driverID)
	if err != nil {
		return nil, err
	}
	state, err := d.Get(ctx, driverID)
	if err != nil {
		return nil, err
	}
	var cfg map[string]any
	cfgPath := fmt.Sprintf("/nodes/%s/qemu/%s/config", node, driverID)
	if err := d.do(ctx, http.MethodGet, cfgPath, nil, &cfg); err != nil {
		return nil, err
	}

	detail := &hypervisor.InstanceDetail{
		InstanceState: *state,
		Description:   strings.TrimSpace(cfgString(cfg, "description")),
		OSType:        cfgString(cfg, "ostype"),
		CPUType:       cfgString(cfg, "cpu"),
		Architecture:  cfgString(cfg, "arch"),
		Sockets:       cfgInt(cfg, "sockets"),
		BootOrder:     cfgString(cfg, "boot"),
		OnBoot:        cfgBool(cfg, "onboot"),
		HostProtected: cfgBool(cfg, "protection"),
		CreatedAt:     creationTime(cfgString(cfg, "meta")),
		CloudInitUser: cfgString(cfg, "ciuser"),
	}
	if detail.Architecture == "" {
		detail.Architecture = "x86_64"
	}
	if tags := cfgString(cfg, "tags"); tags != "" {
		detail.Tags = strings.FieldsFunc(tags, func(r rune) bool { return r == ';' || r == ',' })
	}
	// agent may be "1" or "1,fstrim_cloned_disks=1"
	detail.GuestAgent = strings.HasPrefix(cfgString(cfg, "agent"), "1")
	if keys := cfgString(cfg, "sshkeys"); keys != "" {
		// Stored URL-encoded.
		if decoded, err := url.QueryUnescape(keys); err == nil {
			keys = decoded
		}
		for _, key := range strings.Split(strings.TrimSpace(keys), "\n") {
			if key = strings.TrimSpace(key); key != "" {
				detail.SSHKeys = append(detail.SSHKeys, key)
			}
		}
	}

	// Interfaces, with guest-agent IPs matched by MAC when available.
	ipByMAC := map[string]string{}
	if state.Status == hypervisor.StatusRunning && detail.GuestAgent {
		ipByMAC = d.guestIPsByMAC(ctx, node, driverID)
	}
	for key, raw := range cfg {
		val, ok := raw.(string)
		if !ok {
			continue
		}
		switch {
		case netKeyRe.MatchString(key):
			nic := parseNIC(key, val)
			nic.IPAddress = ipByMAC[nic.MAC]
			detail.NICs = append(detail.NICs, nic)
		case diskKeyRe.MatchString(key):
			detail.Disks = append(detail.Disks, parseDiskSpec(key, val))
		}
	}
	sortByName(detail.NICs, func(n hypervisor.NIC) string { return n.Name })
	sortByName(detail.Disks, func(d hypervisor.AttachedDisk) string { return d.Interface })
	return detail, nil
}

// guestIPsByMAC maps interface MAC → first IPv4 reported by the agent.
func (d *Driver) guestIPsByMAC(ctx context.Context, node, vmid string) map[string]string {
	var res struct {
		Result []struct {
			Name string `json:"name"`
			MAC  string `json:"hardware-address"`
			Addrs []struct {
				Type string `json:"ip-address-type"`
				Addr string `json:"ip-address"`
			} `json:"ip-addresses"`
		} `json:"result"`
	}
	path := fmt.Sprintf("/nodes/%s/qemu/%s/agent/network-get-interfaces", node, vmid)
	if err := d.do(ctx, http.MethodGet, path, nil, &res); err != nil {
		return nil
	}
	ips := map[string]string{}
	for _, iface := range res.Result {
		if iface.Name == "lo" || iface.MAC == "" {
			continue
		}
		for _, a := range iface.Addrs {
			if a.Type == "ipv4" {
				ips[strings.ToUpper(iface.MAC)] = a.Addr
				break
			}
		}
	}
	return ips
}
