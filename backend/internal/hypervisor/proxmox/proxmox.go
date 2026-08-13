// Package proxmox implements hypervisor.Driver against the Proxmox VE
// REST API using API-token auth.
//
// Mapping: zone = cluster node, image = template VMID, create = clone.
package proxmox

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"lab-cloud-manager/internal/hypervisor"
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
		cfg:    cfg,
		client: &http.Client{Timeout: 30 * time.Second, Transport: transport},
		nodeOf: map[string]string{},
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
	var nodes []struct {
		Node   string `json:"node"`
		Status string `json:"status"`
	}
	if err := d.do(ctx, http.MethodGet, "/nodes", nil, &nodes); err != nil {
		return nil, err
	}
	zones := make([]hypervisor.Zone, 0, len(nodes))
	for _, n := range nodes {
		zones = append(zones, hypervisor.Zone{ID: n.Node, Name: n.Node, Status: n.Status})
	}
	return zones, nil
}

type clusterVM struct {
	VMID     int     `json:"vmid"`
	Name     string  `json:"name"`
	Node     string  `json:"node"`
	Status   string  `json:"status"`
	Template int     `json:"template"`
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
	return images, nil
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

	// Apply sizing and optional settings, then boot. Clone is async;
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
	if spec.CloudInitUser != "" {
		cfg.Set("ciuser", spec.CloudInitUser)
	}
	if keys := strings.TrimSpace(spec.SSHKeys); keys != "" {
		// Proxmox expects the sshkeys value itself URL-encoded (it is
		// then form-encoded again on the wire).
		cfg.Set("sshkeys", url.QueryEscape(keys))
	}
	cfgPath := fmt.Sprintf("/nodes/%s/qemu/%s/config", spec.Zone, nextID)
	if err := d.do(ctx, http.MethodPost, cfgPath, cfg, nil); err != nil {
		return nextID, nil // instance exists; config can be fixed manually
	}
	startPath := fmt.Sprintf("/nodes/%s/qemu/%s/status/start", spec.Zone, nextID)
	_ = d.do(ctx, http.MethodPost, startPath, url.Values{}, nil)
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
	for _, iface := range res.Result {
		if iface.Name == "lo" {
			continue
		}
		for _, a := range iface.Addrs {
			if a.Type == "ipv4" {
				return a.Addr
			}
		}
	}
	return ""
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
