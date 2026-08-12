// Package factory constructs hypervisor drivers from server records.
// It is the only place that maps a server "type" to a concrete driver,
// keeping hypervisor specifics out of the API layer.
package factory

import (
	"fmt"

	"lab-cloud-manager/internal/hypervisor"
	"lab-cloud-manager/internal/hypervisor/mock"
	"lab-cloud-manager/internal/hypervisor/proxmox"
	"lab-cloud-manager/internal/store"
)

// Types lists the supported server types, in display order.
var Types = []string{"proxmox", "mock"}

func Build(sv *store.Server) (hypervisor.Driver, error) {
	switch sv.Type {
	case "proxmox":
		return proxmox.New(proxmox.Config{
			BaseURL:            sv.BaseURL,
			TokenID:            sv.TokenID,
			Secret:             sv.Secret,
			InsecureSkipVerify: sv.InsecureTLS,
		}), nil
	case "mock":
		return mock.New(), nil
	default:
		return nil, fmt.Errorf("factory: unknown server type %q", sv.Type)
	}
}
