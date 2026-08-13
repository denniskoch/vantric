// Package factory constructs DNS providers from stored records. It is
// the only place mapping a provider "type" to an implementation, so
// adding one is a single entry here plus the implementation.
package factory

import (
	"fmt"

	"lab-cloud-manager/internal/dns"
	"lab-cloud-manager/internal/dns/cloudflare"
	"lab-cloud-manager/internal/store"
)

// Types lists supported provider types, in display order.
var Types = []string{"cloudflare"}

func Build(p *store.DNSProvider) (dns.Provider, error) {
	switch p.Type {
	case "cloudflare":
		return cloudflare.New(cloudflare.Config{
			Token:     p.Token,
			AccountID: p.AccountID,
		}), nil
	default:
		return nil, fmt.Errorf("factory: unknown DNS provider type %q", p.Type)
	}
}
