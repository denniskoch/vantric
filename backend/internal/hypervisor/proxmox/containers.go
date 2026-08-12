package proxmox

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"lab-cloud-manager/internal/hypervisor"
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
			Zone:     vm.Node,
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
		Zone:     node,
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
