// Package factory constructs DNS providers from stored records. It is
// the only place mapping a provider "type" to an implementation, so
// adding one is a single entry here plus the implementation.
package factory

import (
	"fmt"

	"vantric/internal/dns"
	"vantric/internal/dns/cloudflare"
	"vantric/internal/dns/powerdns"
	"vantric/internal/store"
)

// Types lists supported provider types, in display order.
var Types = []string{"cloudflare", "powerdns"}

// SelfHosted reports whether a provider type needs an address. A hosted
// API's endpoint is a constant in its implementation; a server in the
// lab has to be told where it is.
func SelfHosted(providerType string) bool {
	return providerType == "powerdns"
}

func Build(p *store.DNSProvider) (dns.Provider, error) {
	switch p.Type {
	case "cloudflare":
		return cloudflare.New(cloudflare.Config{
			Token:     p.Token,
			AccountID: p.AccountID,
		}), nil
	case "powerdns":
		return powerdns.New(powerdns.Config{
			BaseURL: p.BaseURL,
			APIKey:  p.Token,
			// AccountID doubles as the API's server id here. It is
			// "localhost" on every install outside a hosting provider,
			// which is why the form defaults it rather than asking.
			ServerID: p.AccountID,
		}), nil
	default:
		return nil, fmt.Errorf("factory: unknown DNS provider type %q", p.Type)
	}
}
