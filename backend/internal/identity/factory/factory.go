// Package factory constructs identity providers from stored records.
// It is the only place mapping a provider "type" to an
// implementation, so adding one is a single entry here plus the
// implementation.
package factory

import (
	"fmt"

	"vantric/internal/identity"
	"vantric/internal/identity/authentik"
	"vantric/internal/store"
)

// Types lists supported provider types, in display order.
var Types = []string{"authentik"}

func Build(p *store.IdentityProvider) (identity.Provider, error) {
	switch p.Type {
	case "authentik":
		return authentik.New(authentik.Config{
			BaseURL:     p.BaseURL,
			Token:       p.Token,
			InsecureTLS: p.InsecureTLS,
		}), nil
	default:
		return nil, fmt.Errorf("factory: unknown identity provider type %q", p.Type)
	}
}
