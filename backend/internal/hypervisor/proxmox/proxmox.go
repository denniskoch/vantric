// Package proxmox implements hypervisor.Driver against the Proxmox VE
// REST API using API-token auth.
//
// Mapping: zone = cluster node, image = template VMID, create = clone.
package proxmox

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"vantric/internal/hypervisor"
)

type Config struct {
	// BaseURL like https://pve.example.lan:8006
	BaseURL string
	// TokenID like root@pam!labcloud
	TokenID string
	Secret  string
	// InsecureSkipVerify tolerates self-signed certs (common in homelabs).
	InsecureSkipVerify bool
}

type Driver struct {
	cfg    Config
	client *http.Client
	// uploadClient has no timeout: image uploads are multi-GB and are
	// bounded by the request context instead.
	uploadClient *http.Client

	mu sync.Mutex
	// vmid -> node cache so Get/Start/... don't need a cluster scan each time
	nodeOf map[string]string
}

func New(cfg Config) *Driver {
	transport := &http.Transport{}
	if cfg.InsecureSkipVerify {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	return &Driver{
		cfg:          cfg,
		client:       &http.Client{Timeout: 30 * time.Second, Transport: transport},
		uploadClient: &http.Client{Transport: transport},
		nodeOf:       map[string]string{},
	}
}

func (d *Driver) Name() string { return "proxmox" }

// do performs an authenticated API call and decodes the "data" envelope.
func (d *Driver) do(ctx context.Context, method, path string, form url.Values, out any) error {
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, d.cfg.BaseURL+"/api2/json"+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "PVEAPIToken="+d.cfg.TokenID+"="+d.cfg.Secret)
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusNotFound {
		return hypervisor.ErrNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("proxmox: %s %s: %s: %s", method, path, resp.Status, strings.TrimSpace(string(raw)))
	}
	if out == nil {
		return nil
	}
	env := struct {
		Data json.RawMessage `json:"data"`
	}{}
	if err := json.Unmarshal(raw, &env); err != nil {
		return fmt.Errorf("proxmox: decoding %s: %w", path, err)
	}
	return json.Unmarshal(env.Data, out)
}

func (d *Driver) Zones(ctx context.Context) ([]hypervisor.Zone, error) {
	// /nodes reports usage alongside the name, so the summary below is
	// free — it is the same one request either way.
	var nodes []struct {
		Node    string  `json:"node"`
		Status  string  `json:"status"`
		CPU     float64 `json:"cpu"` // fraction 0..1
		MaxCPU  int     `json:"maxcpu"`
		Mem     int64   `json:"mem"`
		MaxMem  int64   `json:"maxmem"`
		Disk    int64   `json:"disk"`
		MaxDisk int64   `json:"maxdisk"`
		Uptime  int64   `json:"uptime"`
	}
	if err := d.do(ctx, http.MethodGet, "/nodes", nil, &nodes); err != nil {
		return nil, err
	}
	zones := make([]hypervisor.Zone, 0, len(nodes))
	for _, n := range nodes {
		zones = append(zones, hypervisor.Zone{
			ID:               n.Node,
			Name:             n.Node,
			Status:           n.Status,
			CPUs:             n.MaxCPU,
			CPUPercent:       n.CPU * 100,
			MemoryUsedBytes:  n.Mem,
			MemoryTotalBytes: n.MaxMem,
			DiskUsedBytes:    n.Disk,
			DiskTotalBytes:   n.MaxDisk,
			UptimeSeconds:    n.Uptime,
		})
	}
	sortByName(zones, func(z hypervisor.Zone) string { return z.Name })
	return zones, nil
}

type clusterVM struct {
	VMID     int    `json:"vmid"`
	Name     string `json:"name"`
	Node     string `json:"node"`
	Status   string `json:"status"`
	Template int    `json:"template"`
	// Type distinguishes "qemu" VMs from "lxc" containers; the
	// cluster/resources?type=vm endpoint returns BOTH.
	Type    string  `json:"type"`
	MaxCPU  int     `json:"maxcpu"`
	MaxMem  int64   `json:"maxmem"`
	MaxDisk int64   `json:"maxdisk"`
	Lock    string  `json:"lock"`
	CPU     float64 `json:"cpu"`
}

func (d *Driver) clusterVMs(ctx context.Context) ([]clusterVM, error) {
	var vms []clusterVM
	err := d.do(ctx, http.MethodGet, "/cluster/resources?type=vm", nil, &vms)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	for _, vm := range vms {
		d.nodeOf[strconv.Itoa(vm.VMID)] = vm.Node
	}
	d.mu.Unlock()
	return vms, nil
}

func (d *Driver) Images(ctx context.Context) ([]hypervisor.Image, error) {
	vms, err := d.clusterVMs(ctx)
	if err != nil {
		return nil, err
	}
	var images []hypervisor.Image
	for _, vm := range vms {
		if vm.Type != "qemu" {
			continue
		}
		if vm.Template == 1 {
			images = append(images, hypervisor.Image{
				ID:   strconv.Itoa(vm.VMID),
				Name: vm.Name,
				Zone: vm.Node,
			})
		}
	}
	d.describeImages(ctx, images)
	return images, nil
}

// describeImages fills in what /cluster/resources doesn't carry —
// description, tags, architecture and creation time — with one config
// read per template.
//
// This is the exception to "one cheap call": a lab has a handful of
// templates, this list isn't polled the way instances are, and the
// alternative is a picker that can't show what it's picking. The reads
// run concurrently and a failure is left blank rather than failing the
// listing, since a template you can still clone is worth showing
// without its label.
func (d *Driver) describeImages(ctx context.Context, images []hypervisor.Image) {
	const parallel = 8
	sem := make(chan struct{}, parallel)
	var wg sync.WaitGroup
	for i := range images {
		wg.Add(1)
		go func(img *hypervisor.Image) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			var cfg map[string]any
			path := fmt.Sprintf("/nodes/%s/qemu/%s/config", img.Zone, img.ID)
			if err := d.do(ctx, http.MethodGet, path, nil, &cfg); err != nil {
				return
			}
			img.Description = strings.TrimSpace(cfgString(cfg, "description"))
			if tags := cfgString(cfg, "tags"); tags != "" {
				img.Tags = strings.FieldsFunc(tags, func(r rune) bool { return r == ';' || r == ',' })
			}
			img.Architecture = cfgString(cfg, "arch")
			if img.Architecture == "" {
				img.Architecture = "x86_64"
			}
			img.CreatedAt = creationTime(cfgString(cfg, "meta"))
		}(&images[i])
	}
	wg.Wait()
}

func (d *Driver) node(ctx context.Context, driverID string) (string, error) {
	d.mu.Lock()
	node, ok := d.nodeOf[driverID]
	d.mu.Unlock()
	if ok {
		return node, nil
	}
	if _, err := d.clusterVMs(ctx); err != nil {
		return "", err
	}
	d.mu.Lock()
	node, ok = d.nodeOf[driverID]
	d.mu.Unlock()
	if !ok {
		return "", hypervisor.ErrNotFound
	}
	return node, nil
}

func (d *Driver) Create(ctx context.Context, spec hypervisor.InstanceSpec) (string, error) {
	// Allocate the next free VMID cluster-wide.
	var nextID string
	if err := d.do(ctx, http.MethodGet, "/cluster/nextid", nil, &nextID); err != nil {
		return "", fmt.Errorf("allocating vmid: %w", err)
	}
	templateNode, err := d.node(ctx, spec.ImageID)
	if err != nil {
		return "", fmt.Errorf("locating template %s: %w", spec.ImageID, err)
	}
	form := url.Values{
		"newid":  {nextID},
		"name":   {spec.Name},
		"target": {spec.Zone},
		"full":   {"1"},
	}
	path := fmt.Sprintf("/nodes/%s/qemu/%s/clone", templateNode, spec.ImageID)
	if err := d.do(ctx, http.MethodPost, path, form, nil); err != nil {
		return "", fmt.Errorf("cloning template: %w", err)
	}
	d.mu.Lock()
	d.nodeOf[nextID] = spec.Zone
	d.mu.Unlock()

	// Apply sizing and optional settings. Clone is async;
	// Proxmox queues these behind the clone lock, so failures here are
	// surfaced by Get.
	cfg := url.Values{
		"cores":  {strconv.Itoa(spec.CPUs)},
		"memory": {strconv.Itoa(spec.MemoryMB)},
	}
	if spec.Description != "" {
		cfg.Set("description", spec.Description)
	}
	if spec.NetworkBridge != "" {
		net0 := "virtio,bridge=" + spec.NetworkBridge
		if spec.VLANTag > 0 {
			net0 += fmt.Sprintf(",tag=%d", spec.VLANTag)
		}
		cfg.Set("net0", net0)
	}
	applyCloudInit(cfg, spec.CloudInit)
	cfgPath := fmt.Sprintf("/nodes/%s/qemu/%s/config", spec.Zone, nextID)
	if err := d.do(ctx, http.MethodPost, cfgPath, cfg, nil); err != nil {
		return nextID, nil // instance exists; config can be fixed manually
	}
	if spec.Serial != "" {
		// A machine that exists without its serial is worth more than a
		// failed create, and the gap reports itself: the reconciler
		// reads the serial back and the detail page says "not set on the
		// hypervisor" rather than showing what was asked for.
		_ = d.setSerial(ctx, spec.Zone, nextID, spec.Serial)
	}

	// Booting it is the console's job, not this method's. A new instance
	// does start automatically — that's GCP's behaviour and the app's —
	// but the start used to be fired here and its error discarded, which
	// is a bad trade: right after a full clone Proxmox can still hold
	// the clone lock, and the request fails. What you saw then was a
	// freshly created VM sitting stopped with nothing saying why. So the
	// create flow starts it as a step of its own, retries while the lock
	// clears, and reports it if it never does.
	return nextID, nil
}

// List reports every non-template VM from a single cluster/resources
// call. IPs are omitted (the guest agent requires per-VM calls); the
// reconciler fills them in via Get for running instances.
func (d *Driver) List(ctx context.Context) ([]hypervisor.InstanceState, error) {
	vms, err := d.clusterVMs(ctx)
	if err != nil {
		return nil, err
	}
	states := []hypervisor.InstanceState{}
	for _, vm := range vms {
		if vm.Template == 1 || vm.Type != "qemu" {
			continue
		}
		states = append(states, hypervisor.InstanceState{
			DriverID: strconv.Itoa(vm.VMID),
			Name:     vm.Name,
			Zone:     vm.Node,
			Status:   mapStatus(vm.Status, vm.Lock),
			CPUs:     vm.MaxCPU,
			MemoryMB: int(vm.MaxMem / (1024 * 1024)),
			DiskGB:   int(vm.MaxDisk / (1024 * 1024 * 1024)),
		})
	}
	return states, nil
}

func (d *Driver) Get(ctx context.Context, driverID string) (*hypervisor.InstanceState, error) {
	node, err := d.node(ctx, driverID)
	if err != nil {
		return nil, err
	}
	var cur struct {
		Name    string `json:"name"`
		Status  string `json:"status"` // running | stopped
		Lock    string `json:"lock"`
		CPUs    int    `json:"cpus"`
		MaxMem  int64  `json:"maxmem"`
		MaxDisk int64  `json:"maxdisk"`
		Agent   int    `json:"agent"`
		Uptime  int64  `json:"uptime"`
	}
	path := fmt.Sprintf("/nodes/%s/qemu/%s/status/current", node, driverID)
	if err := d.do(ctx, http.MethodGet, path, nil, &cur); err != nil {
		return nil, err
	}
	state := &hypervisor.InstanceState{
		DriverID:      driverID,
		Name:          cur.Name,
		Zone:          node,
		Status:        mapStatus(cur.Status, cur.Lock),
		CPUs:          cur.CPUs,
		MemoryMB:      int(cur.MaxMem / (1024 * 1024)),
		DiskGB:        int(cur.MaxDisk / (1024 * 1024 * 1024)),
		UptimeSeconds: cur.Uptime,
	}
	if state.Status == hypervisor.StatusRunning {
		state.InternalIP = d.guestIP(ctx, node, driverID)
	}
	return state, nil
}

// guestIP asks the QEMU guest agent for the first non-loopback IPv4.
// Returns "" if the agent isn't running — that's normal early in boot.
func (d *Driver) guestIP(ctx context.Context, node, vmid string) string {
	var res struct {
		Result []struct {
			Name  string `json:"name"`
			Addrs []struct {
				Type string `json:"ip-address-type"`
				Addr string `json:"ip-address"`
			} `json:"ip-addresses"`
		} `json:"result"`
	}
	path := fmt.Sprintf("/nodes/%s/qemu/%s/agent/network-get-interfaces", node, vmid)
	if err := d.do(ctx, http.MethodGet, path, nil, &res); err != nil {
		return ""
	}
	interfaces := make([]guestInterface, 0, len(res.Result))
	for _, iface := range res.Result {
		g := guestInterface{Name: iface.Name}
		for _, a := range iface.Addrs {
			if a.Type == "ipv4" {
				g.IPv4 = append(g.IPv4, a.Addr)
			}
		}
		interfaces = append(interfaces, g)
	}
	return pickGuestIP(interfaces)
}

type guestInterface struct {
	Name string
	IPv4 []string
}

// Interfaces that exist on the guest but aren't how you reach it. A
// container bridge answers on the guest's own side only, so handing one
// to the SSH terminal produces a connection attempt to an address that
// was never routable from here.
var containerInterfaces = []string{
	"docker", "br-", "veth", "virbr", "lxcbr", "lxdbr", "cni", "flannel",
	"cali", "kube", "weave", "podman", "cbr", "vmbr",
}

// Tunnels are routable, just not the LAN address — worth using when
// there's nothing else, never in preference to the real NIC.
var tunnelInterfaces = []string{"tailscale", "wg", "tun", "tap", "zt", "ppp", "nebula"}

// pickGuestIP chooses the address a guest can actually be reached on.
//
// The agent reports every interface the guest has, in whatever order the
// kernel lists them, and the old rule — first one that isn't lo — was
// therefore luck: on a Docker host the answer depends on whether
// docker0 was created before or after the NIC was renamed. A guest
// whose stored address is its own bridge looks fine in the list and
// fails at Connect, which is the worst way to be wrong.
func pickGuestIP(interfaces []guestInterface) string {
	best, bestRank := "", 99
	for _, iface := range interfaces {
		name := strings.ToLower(iface.Name)
		if name == "lo" || strings.HasPrefix(name, "lo:") {
			continue
		}
		rank := 0
		switch {
		case hasPrefixAny(name, containerInterfaces):
			rank = 2
		case hasPrefixAny(name, tunnelInterfaces):
			rank = 1
		}
		for _, addr := range iface.IPv4 {
			if !usableIPv4(addr) {
				continue
			}
			if rank < bestRank {
				best, bestRank = addr, rank
			}
			break // one address per interface is enough
		}
	}
	return best
}

func hasPrefixAny(name string, prefixes []string) bool {
	for _, p := range prefixes {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}

// usableIPv4 rejects the addresses that are never an answer to "where
// is this guest": loopback, and the link-local block a machine gives
// itself when DHCP failed.
func usableIPv4(addr string) bool {
	ip := net.ParseIP(addr)
	return ip != nil && ip.To4() != nil && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsUnspecified()
}

func mapStatus(status, lock string) hypervisor.Status {
	switch lock {
	case "clone", "create":
		return hypervisor.StatusProvisioning
	}
	switch status {
	case "running":
		return hypervisor.StatusRunning
	case "stopped":
		return hypervisor.StatusTerminated
	default:
		return hypervisor.StatusStaging
	}
}

func (d *Driver) power(ctx context.Context, driverID, action string) error {
	node, err := d.node(ctx, driverID)
	if err != nil {
		return err
	}
	path := fmt.Sprintf("/nodes/%s/qemu/%s/status/%s", node, driverID, action)
	return d.do(ctx, http.MethodPost, path, url.Values{}, nil)
}

func (d *Driver) Start(ctx context.Context, driverID string) error {
	return d.power(ctx, driverID, "start")
}

// setSerial writes a serial number into the guest's SMBIOS, keeping
// the uuid Proxmox generated for this clone.
//
// smbios1 is one config key holding every SMBIOS string, so writing a
// serial means rewriting the lot — and the uuid must survive that,
// since it's the identity everything else correlates on. The other
// string fields (manufacturer, product, sku, family) are dropped: they
// are unset on every VM this console has ever seen, and carrying them
// through a re-encode would risk mangling what it was trying to
// preserve. base64=1 covers any serial someone types.
func (d *Driver) setSerial(ctx context.Context, node, vmid, serial string) error {
	var cfg map[string]any
	cfgPath := fmt.Sprintf("/nodes/%s/qemu/%s/config", node, vmid)
	if err := d.do(ctx, http.MethodGet, cfgPath, nil, &cfg); err != nil {
		return err
	}
	uuid := smbiosUUID(cfgString(cfg, "smbios1"))
	if uuid == "" {
		return fmt.Errorf("no smbios uuid to preserve on %s", vmid)
	}
	smbios := fmt.Sprintf("uuid=%s,serial=%s,base64=1",
		uuid, base64.StdEncoding.EncodeToString([]byte(serial)))
	return d.do(ctx, http.MethodPost, cfgPath, url.Values{"smbios1": {smbios}}, nil)
}

// SetDescription writes the VM's notes — the same field Proxmox shows
// in its Notes panel, on a running VM as readily as a stopped one.
func (d *Driver) SetDescription(ctx context.Context, driverID, description string) error {
	node, err := d.node(ctx, driverID)
	if err != nil {
		return err
	}
	form := url.Values{"description": {description}}
	path := fmt.Sprintf("/nodes/%s/qemu/%s/config", node, driverID)
	return d.do(ctx, http.MethodPost, path, form, nil)
}

// SetName renames the VM on the hypervisor. Proxmox treats name as an
// ordinary config key, so this is the same write as any other.
func (d *Driver) SetName(ctx context.Context, driverID, name string) error {
	node, err := d.node(ctx, driverID)
	if err != nil {
		return err
	}
	form := url.Values{"name": {name}}
	path := fmt.Sprintf("/nodes/%s/qemu/%s/config", node, driverID)
	return d.do(ctx, http.MethodPost, path, form, nil)
}

// Stop performs a graceful ACPI shutdown, matching GCP's Stop semantics.
func (d *Driver) Stop(ctx context.Context, driverID string) error {
	return d.power(ctx, driverID, "shutdown")
}

func (d *Driver) Reset(ctx context.Context, driverID string) error {
	return d.power(ctx, driverID, "reboot")
}

func (d *Driver) Delete(ctx context.Context, driverID string) error {
	node, err := d.node(ctx, driverID)
	if err != nil {
		return err
	}
	// Force-stop first; Proxmox refuses to destroy a running VM.
	_ = d.power(ctx, driverID, "stop")
	path := fmt.Sprintf("/nodes/%s/qemu/%s?purge=1&destroy-unreferenced-disks=1", node, driverID)
	err = d.do(ctx, http.MethodDelete, path, nil, nil)
	if err == nil {
		d.mu.Lock()
		delete(d.nodeOf, driverID)
		d.mu.Unlock()
	}
	return err
}
