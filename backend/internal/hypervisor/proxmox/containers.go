package proxmox

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"vantric/internal/hypervisor"
)

// LXC container support (hypervisor.ContainerDriver). Containers share
// the VMID space with VMs but live under /nodes/{node}/lxc/.

// ListContainers reports every non-template LXC container.
func (d *Driver) ListContainers(ctx context.Context) ([]hypervisor.InstanceState, error) {
	vms, err := d.clusterVMs(ctx)
	if err != nil {
		return nil, err
	}
	states := []hypervisor.InstanceState{}
	for _, vm := range vms {
		if vm.Template == 1 || vm.Type != "lxc" {
			continue
		}
		states = append(states, hypervisor.InstanceState{
			DriverID: strconv.Itoa(vm.VMID),
			Name:     vm.Name,
			Node:     vm.Node,
			Status:   mapStatus(vm.Status, vm.Lock),
			CPUs:     vm.MaxCPU,
			MemoryMB: int(vm.MaxMem / (1024 * 1024)),
			DiskGB:   int(vm.MaxDisk / (1024 * 1024 * 1024)),
		})
	}
	return states, nil
}

func (d *Driver) GetContainer(ctx context.Context, driverID string) (*hypervisor.InstanceState, error) {
	node, err := d.node(ctx, driverID)
	if err != nil {
		return nil, err
	}
	var cur struct {
		Name    string `json:"name"`
		Status  string `json:"status"`
		Lock    string `json:"lock"`
		CPUs    int    `json:"cpus"`
		MaxMem  int64  `json:"maxmem"`
		MaxDisk int64  `json:"maxdisk"`
	}
	path := fmt.Sprintf("/nodes/%s/lxc/%s/status/current", node, driverID)
	if err := d.do(ctx, http.MethodGet, path, nil, &cur); err != nil {
		return nil, err
	}
	state := &hypervisor.InstanceState{
		DriverID: driverID,
		Name:     cur.Name,
		Node:     node,
		Status:   mapStatus(cur.Status, cur.Lock),
		CPUs:     cur.CPUs,
		MemoryMB: int(cur.MaxMem / (1024 * 1024)),
		DiskGB:   int(cur.MaxDisk / (1024 * 1024 * 1024)),
	}
	if state.Status == hypervisor.StatusRunning {
		state.InternalIP = d.containerIP(ctx, node, driverID)
	}
	return state, nil
}

// containerIP reads the container's first non-loopback IPv4 from the
// /interfaces endpoint (no guest agent needed for LXC).
func (d *Driver) containerIP(ctx context.Context, node, vmid string) string {
	var ifaces []struct {
		Name string `json:"name"`
		// inet is CIDR notation, e.g. "192.168.80.7/24"
		Inet string `json:"inet"`
	}
	path := fmt.Sprintf("/nodes/%s/lxc/%s/interfaces", node, vmid)
	if err := d.do(ctx, http.MethodGet, path, nil, &ifaces); err != nil {
		return ""
	}
	for _, iface := range ifaces {
		if iface.Name == "lo" || iface.Inet == "" {
			continue
		}
		ip := iface.Inet
		for i := range ip {
			if ip[i] == '/' {
				ip = ip[:i]
				break
			}
		}
		return ip
	}
	return ""
}

func (d *Driver) containerPower(ctx context.Context, driverID, action string) error {
	node, err := d.node(ctx, driverID)
	if err != nil {
		return err
	}
	path := fmt.Sprintf("/nodes/%s/lxc/%s/status/%s", node, driverID, action)
	return d.do(ctx, http.MethodPost, path, url.Values{}, nil)
}

func (d *Driver) StartContainer(ctx context.Context, driverID string) error {
	return d.containerPower(ctx, driverID, "start")
}

// StopContainer performs a graceful shutdown.
func (d *Driver) StopContainer(ctx context.Context, driverID string) error {
	return d.containerPower(ctx, driverID, "shutdown")
}

func (d *Driver) RestartContainer(ctx context.Context, driverID string) error {
	return d.containerPower(ctx, driverID, "reboot")
}

func (d *Driver) DeleteContainer(ctx context.Context, driverID string) error {
	node, err := d.node(ctx, driverID)
	if err != nil {
		return err
	}
	// Force-stop first; Proxmox refuses to destroy a running container.
	_ = d.containerPower(ctx, driverID, "stop")
	path := fmt.Sprintf("/nodes/%s/lxc/%s?purge=1&destroy-unreferenced-disks=1", node, driverID)
	err = d.do(ctx, http.MethodDelete, path, nil, nil)
	if err == nil {
		d.mu.Lock()
		delete(d.nodeOf, driverID)
		d.mu.Unlock()
	}
	return err
}

// CreateContainer provisions an LXC from a root-filesystem template.
//
// This is NOT the VM path with different keys. Creating a VM is a CLONE:
// Proxmox copies a template guest that already carries a login, keys,
// sizing and a disk, so the form is mostly overrides. A container is
// built from a tarball that carries none of that, so every setting is
// stated here — and the addressing goes on the interface itself rather
// than through cloud-init, so it applies whether or not anything inside
// the container cooperates.
func (d *Driver) CreateContainer(ctx context.Context, spec hypervisor.ContainerSpec) (string, error) {
	var nextID string
	if err := d.do(ctx, http.MethodGet, "/cluster/nextid", nil, &nextID); err != nil {
		return "", fmt.Errorf("allocating vmid: %w", err)
	}

	form := url.Values{
		"vmid":       {nextID},
		"hostname":   {spec.Name},
		"ostemplate": {spec.Template},
		"cores":      {strconv.Itoa(spec.CPUs)},
		"memory":     {strconv.Itoa(spec.MemoryMB)},
		// rootfs is "<storage>:<size in GiB>" on create — the only place
		// in this API where a size is written as a bare number.
		"rootfs": {fmt.Sprintf("%s:%d", spec.Storage, spec.DiskGB)},
	}
	// Swap is 0 by default rather than Proxmox's 512: a lab container
	// swapping out of the host's memory is a surprise, and pve1 is
	// already at its limit. Asked for explicitly, it's honoured.
	form.Set("swap", strconv.Itoa(spec.SwapMB))
	if spec.Unprivileged {
		form.Set("unprivileged", "1")
	}
	if spec.Nesting {
		// The one feature flag a lab actually reaches for — Docker in a
		// container needs it.
		form.Set("features", "nesting=1")
	}
	if spec.StartOnBoot {
		form.Set("onboot", "1")
	}
	if spec.Password != "" {
		form.Set("password", spec.Password) // hashed by Proxmox
	}
	if spec.SSHKeys != "" {
		form.Set("ssh-public-keys", spec.SSHKeys)
	}
	if spec.Nameservers != "" {
		form.Set("nameserver", spec.Nameservers)
	}
	if spec.SearchDomain != "" {
		form.Set("searchdomain", spec.SearchDomain)
	}
	if spec.Description != "" {
		form.Set("description", spec.Description)
	}
	if net := containerNIC(spec); net != "" {
		form.Set("net0", net)
	}

	path := fmt.Sprintf("/nodes/%s/lxc", spec.Node)
	if err := d.do(ctx, http.MethodPost, path, form, nil); err != nil {
		return "", err
	}
	d.mu.Lock()
	d.nodeOf[nextID] = spec.Node
	d.mu.Unlock()
	return nextID, nil
}

// containerNIC renders net0. A container's NIC carries its ADDRESSING as
// well as its bridge, which a VM's does not — that's the shape
// difference to remember when reading this beside the VM create.
func containerNIC(spec hypervisor.ContainerSpec) string {
	if spec.NetworkBridge == "" {
		return ""
	}
	parts := []string{"name=eth0", "bridge=" + spec.NetworkBridge}
	if spec.VLANTag > 0 {
		parts = append(parts, "tag="+strconv.Itoa(spec.VLANTag))
	}
	switch {
	case spec.IP.DHCP:
		parts = append(parts, "ip=dhcp")
	case spec.IP.Address != "":
		parts = append(parts, "ip="+spec.IP.Address)
		if spec.IP.Gateway != "" {
			parts = append(parts, "gw="+spec.IP.Gateway)
		}
	}
	switch {
	case spec.IP.DHCP6:
		parts = append(parts, "ip6=dhcp")
	case spec.IP.SLAAC:
		parts = append(parts, "ip6=auto")
	case spec.IP.Address6 != "":
		parts = append(parts, "ip6="+spec.IP.Address6)
		if spec.IP.Gateway6 != "" {
			parts = append(parts, "gw6="+spec.IP.Gateway6)
		}
	}
	return strings.Join(parts, ",")
}
