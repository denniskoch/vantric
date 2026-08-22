// Package factory constructs provider-account readers from stored
// records. The only place mapping a provider type to an
// implementation, so adding one is an entry here plus the driver.
package factory

import (
	"fmt"

	"vantric/internal/aiaccount"
	"vantric/internal/aiaccount/openrouter"
	"vantric/internal/store"
)

// Types lists supported providers, in display order. The other three
// with a readable balance — DeepSeek, xAI and ElevenLabs — go here as
// their drivers land.
var Types = []string{"openrouter"}

func Build(a *store.AIAccount) (aiaccount.Provider, error) {
	switch a.Type {
	case "openrouter":
		return openrouter.New(openrouter.Config{Key: a.Key}), nil
	default:
		return nil, fmt.Errorf("factory: unknown provider account type %q", a.Type)
	}
}
