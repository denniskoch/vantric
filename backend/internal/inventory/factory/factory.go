// Package factory constructs inventory providers from stored records.
// It is the only place mapping a provider "type" to an
// implementation, so adding one is a single entry here plus the
// implementation.
package factory

import (
	"fmt"

	"vantric/internal/inventory"
	"vantric/internal/inventory/fleet"
	"vantric/internal/store"
)

// Types lists supported provider types, in display order.
var Types = []string{"fleet"}

func Build(p *store.InventoryProvider) (inventory.Provider, error) {
	switch p.Type {
	case "fleet":
		return fleet.New(fleet.Config{
			BaseURL:     p.BaseURL,
			Token:       p.Token,
			InsecureTLS: p.InsecureTLS,
		}), nil
	default:
		return nil, fmt.Errorf("factory: unknown inventory provider type %q", p.Type)
	}
}
