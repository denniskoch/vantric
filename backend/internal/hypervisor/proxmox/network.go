package proxmox

import (
	"context"
	"net/http"
	"strings"

	"vantric/internal/hypervisor"
)

// Bridges lists bridges across the cluster's nodes. "any_bridge" covers
// both Linux and OVS bridges.
func (d *Driver) Bridges(ctx context.Context) ([]hypervisor.Bridge, error) {
	nodes, err := d.Nodes(ctx)
	if err != nil {
		return nil, err
	}
	bridges := []hypervisor.Bridge{}
	for _, node := range nodes {
		var ifaces []struct {
			Iface     string `json:"iface"`
			CIDR      string `json:"cidr"`
			Comments  string `json:"comments"`
			Active    int    `json:"active"`
			VLANAware int    `json:"bridge_vlan_aware"`
			Ports     string `json:"bridge_ports"`
		}
		path := apiPath("/nodes/%s/network?type=any_bridge", node.ID)
		if err := d.do(ctx, http.MethodGet, path, nil, &ifaces); err != nil {
			continue // a node that's down shouldn't hide the others
		}
		for _, iface := range ifaces {
			bridges = append(bridges, hypervisor.Bridge{
				Name:      iface.Iface,
				Node:      node.ID,
				CIDR:      iface.CIDR,
				Comment:   strings.TrimSpace(iface.Comments),
				Active:    iface.Active == 1,
				VLANAware: iface.VLANAware == 1,
				Ports:     iface.Ports,
			})
		}
	}
	return bridges, nil
}
