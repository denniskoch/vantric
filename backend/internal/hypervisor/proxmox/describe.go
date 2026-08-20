package proxmox

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"vantric/internal/hypervisor"
)

var netKeyRe = regexp.MustCompile(`^net\d+$`)

// firmwareDiskKeyRe matches storage volumes that aren't data disks:
// EFI vars, TPM state, and disks detached but still allocated.
var firmwareDiskKeyRe = regexp.MustCompile(`^(efidisk|tpmstate|unused)\d+$`)

// deviceKinds maps repeatable hardware config keys to display names.
// Proxmox allows several of each (serial0-3, usb0-4, hostpci0-15…), so
// they're reported as a device list rather than fixed fields.
var deviceKinds = []struct {
	re   *regexp.Regexp
	kind string
}{
	{regexp.MustCompile(`^serial\d+$`), "Serial port"},
	{regexp.MustCompile(`^parallel\d+$`), "Parallel port"},
	{regexp.MustCompile(`^usb\d+$`), "USB device"},
	{regexp.MustCompile(`^hostpci\d+$`), "PCI passthrough"},
	{regexp.MustCompile(`^audio\d+$`), "Audio device"},
	{regexp.MustCompile(`^virtiofs\d+$`), "VirtioFS share"},
	{regexp.MustCompile(`^numa\d+$`), "NUMA node"},
	{regexp.MustCompile(`^rng\d+$`), "Entropy source"},
	{regexp.MustCompile(`^ivshmem$`), "Shared memory"},
	{regexp.MustCompile(`^watchdog$`), "Watchdog"},
}

func deviceKind(key string) (string, bool) {
	for _, d := range deviceKinds {
		if d.re.MatchString(key) {
			return d.kind, true
		}
	}
	return "", false
}

// firmwareMedia labels a non-data volume by its config key.
func firmwareMedia(key string) string {
	switch {
	case strings.HasPrefix(key, "efidisk"):
		return "efi"
	case strings.HasPrefix(key, "tpmstate"):
		return "tpm"
	default:
		return "unused"
	}
}

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

// cfgBoolDefault is cfgBool for the keys whose Proxmox default is ON.
// Proxmox omits a key left at its default, so absent and "0" mean
// opposite things and cfgBool can't tell them apart.
func cfgBoolDefault(cfg map[string]any, key string, def bool) bool {
	if _, ok := cfg[key]; !ok {
		return def
	}
	return cfgBool(cfg, key)
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
			disk.SizeBytes = parseSizeBytes(value)
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
//
// A CLONE INHERITS THIS, which is why it is read for TEMPLATES and not
// for instances. `meta` is part of the config, and a clone copies the
// config — so every VM cloned from a template reports the template's
// build date as its own. Three guests cloned from debian-…-trixie all
// claimed to have been created at 21:47 on the day the template was
// built, including one that was ten minutes old, and it read as a real
// timestamp rather than as a missing one. A template built here is
// created fresh (BuildTemplate calls qemu/create), so its own ctime is
// genuinely its build date and the Images list is right to use it.
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
	cfgPath := apiPath("/nodes/%s/qemu/%s/config", node, driverID)
	if err := d.do(ctx, http.MethodGet, cfgPath, nil, &cfg); err != nil {
		return nil, err
	}

	detail := &hypervisor.InstanceDetail{
		InstanceState:  *state,
		Description:    strings.TrimSpace(cfgString(cfg, "description")),
		OSType:         cfgString(cfg, "ostype"),
		CPUType:        cfgString(cfg, "cpu"),
		Architecture:   cfgString(cfg, "arch"),
		Sockets:        cfgInt(cfg, "sockets"),
		BootOrder:      cfgString(cfg, "boot"),
		BIOS:           cfgString(cfg, "bios"),
		MachineType:    cfgString(cfg, "machine"),
		Display:        cfgString(cfg, "vga"),
		SCSIController: cfgString(cfg, "scsihw"),
		OnBoot:         cfgBool(cfg, "onboot"),
		HostProtected:  cfgBool(cfg, "protection"),
		CloudInitUser:  cfgString(cfg, "ciuser"),
		IPConfig:       cfgString(cfg, "ipconfig0"),
		Nameservers:    cfgString(cfg, "nameserver"),
		SearchDomain:   cfgString(cfg, "searchdomain"),
		Datasource:     cfgString(cfg, "citype"),
		// Proxmox's default here is ON, so an absent key means yes —
		// which is why this can't go through cfgBool.
		UpgradePackages: cfgBoolDefault(cfg, "ciupgrade", true),
	}
	if detail.Architecture == "" {
		detail.Architecture = "x86_64"
	}
	// citype follows the guest: nocloud for Linux, configdrive2 for
	// Windows. Reported as the effective value, like BIOS and chipset.
	if detail.Datasource == "" {
		if strings.HasPrefix(detail.OSType, "win") {
			detail.Datasource = "configdrive2 (default)"
		} else {
			detail.Datasource = "nocloud (default)"
		}
	}
	// Proxmox omits keys left at their default; report the effective value.
	for field, fallback := range map[*string]string{
		&detail.BIOS:           "seabios",
		&detail.MachineType:    "i440fx",
		&detail.Display:        "std",
		&detail.SCSIController: "lsi",
	} {
		if *field == "" {
			*field = fallback + " (default)"
		}
	}
	smbios := cfgString(cfg, "smbios1")
	detail.UUID = smbiosUUID(smbios)
	detail.Serial = smbiosSerial(smbios)
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
			disk := parseDiskSpec(key, val)
			// The cloud-init drive is how you tell a guest that reads
			// this configuration from one that ignores all of it.
			if strings.HasSuffix(disk.Name, "cloudinit") {
				detail.CloudInit = true
			}
			detail.Disks = append(detail.Disks, disk)
		case firmwareDiskKeyRe.MatchString(key):
			disk := parseDiskSpec(key, val)
			disk.Media = firmwareMedia(key)
			detail.Disks = append(detail.Disks, disk)
		default:
			if kind, ok := deviceKind(key); ok {
				detail.Devices = append(detail.Devices, hypervisor.Device{
					Key: key, Kind: kind, Value: val,
				})
			}
		}
	}
	sortByName(detail.NICs, func(n hypervisor.NIC) string { return n.Name })
	sortByName(detail.Disks, func(d hypervisor.AttachedDisk) string { return d.Interface })
	sortByName(detail.Devices, func(d hypervisor.Device) string { return d.Key })
	return detail, nil
}

// guestIPsByMAC maps interface MAC → first IPv4 reported by the agent.
func (d *Driver) guestIPsByMAC(ctx context.Context, node, vmid string) map[string]string {
	var res struct {
		Result []struct {
			Name  string `json:"name"`
			MAC   string `json:"hardware-address"`
			Addrs []struct {
				Type string `json:"ip-address-type"`
				Addr string `json:"ip-address"`
			} `json:"ip-addresses"`
		} `json:"result"`
	}
	path := apiPath("/nodes/%s/qemu/%s/agent/network-get-interfaces", node, vmid)
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

// smbiosUUID pulls the system UUID out of Proxmox's smbios1 setting.
func smbiosUUID(smbios1 string) string { return smbiosField(smbios1, "uuid") }

// smbiosSerial pulls the system serial number — empty on almost every
// VM, because Proxmox doesn't set one unless asked. It matters because
// device inventory keys on it: osquery reports hardware_serial, and a
// fleet of VMs that all report "" is a fleet that looks like one host.
func smbiosSerial(smbios1 string) string { return smbiosField(smbios1, "serial") }

// smbiosField reads one field of Proxmox's smbios1 setting: a
// comma-separated list which, when it carries base64=1, has its STRING
// fields base64-encoded — manufacturer, product, version, serial, sku,
// family. The uuid is never encoded, which is why reading it needed no
// decoding and reading a serial does.
func smbiosField(smbios1, name string) string {
	encoded := false
	value := ""
	for _, field := range strings.Split(smbios1, ",") {
		if field == "base64=1" {
			encoded = true
			continue
		}
		if v, ok := strings.CutPrefix(field, name+"="); ok {
			value = v
		}
	}
	if value == "" || name == "uuid" || !encoded {
		return value
	}
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		// Proxmox said it was base64 and it wasn't; the raw value is
		// more use than nothing.
		return value
	}
	return string(decoded)
}
