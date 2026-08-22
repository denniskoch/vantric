// Package factory constructs provider-account readers from stored
// records. The only place mapping a provider type to an
// implementation, so adding one is an entry here plus the driver.
package factory

import (
	"fmt"

	"vantric/internal/aiaccount"
	"vantric/internal/aiaccount/deepseek"
	"vantric/internal/aiaccount/elevenlabs"
	"vantric/internal/aiaccount/openrouter"
	"vantric/internal/store"
)

// Types lists supported providers, in display order.
//
// xAI is the fourth with a readable balance and is absent: its endpoint
// lives on a different host, needs a MANAGEMENT key rather than the
// inference one, and takes a team id this record has nowhere to keep.
// Adding it is a column and a form field, not a driver.
var Types = []string{"openrouter", "deepseek", "elevenlabs"}

func Build(a *store.AIAccount) (aiaccount.Provider, error) {
	switch a.Type {
	case "openrouter":
		return openrouter.New(openrouter.Config{Key: a.Key}), nil
	case "deepseek":
		return deepseek.New(deepseek.Config{Key: a.Key}), nil
	case "elevenlabs":
		return elevenlabs.New(elevenlabs.Config{Key: a.Key}), nil
	default:
		return nil, fmt.Errorf("factory: unknown provider account type %q", a.Type)
	}
}
