// Package factory constructs AI gateway providers from stored records.
// It is the only place mapping a gateway "type" to an implementation,
// so adding one is a single entry here plus the implementation.
package factory

import (
	"fmt"

	"vantric/internal/ai"
	"vantric/internal/ai/bifrost"
	"vantric/internal/store"
)

// Types lists supported gateway types, in display order.
var Types = []string{"bifrost"}

func Build(g *store.AIGateway) (ai.Provider, error) {
	switch g.Type {
	case "bifrost":
		return bifrost.New(bifrost.Config{
			BaseURL:     g.BaseURL,
			Token:       g.Token,
			InsecureTLS: g.InsecureTLS,
		}), nil
	default:
		return nil, fmt.Errorf("factory: unknown AI gateway type %q", g.Type)
	}
}
