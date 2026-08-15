// Package factory constructs network providers from stored records. It
// is the only place mapping a controller "type" to an implementation.
package factory

import (
	"fmt"

	"vantric/internal/network"
	"vantric/internal/network/unifi"
	"vantric/internal/store"
)

// Types lists supported controller types, in display order.
var Types = []string{"unifi"}

func Build(p *store.NetworkProvider) (network.Provider, error) {
	switch p.Type {
	case "unifi":
		return unifi.New(unifi.Config{
			BaseURL:     p.BaseURL,
			Site:        p.Site,
			APIKey:      p.APIKey,
			Username:    p.Username,
			Password:    p.Password,
			InsecureTLS: p.InsecureTLS,
		})
	default:
		return nil, fmt.Errorf("factory: unknown network controller type %q", p.Type)
	}
}
