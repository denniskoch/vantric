// Package aiaccount defines the abstraction over a model provider's
// own account — what is LEFT there, which is the one thing the gateway
// in front of them structurally cannot know.
//
// It is a separate boundary from internal/ai on purpose. A gateway
// account and a provider account are different things holding
// different credentials: Bifrost holds inference keys and redacts
// them, and most providers put billing behind a key that cannot call
// inference at all. Reading one tells you nothing about the other.
//
// PROVIDERS DO NOT ANSWER THE SAME QUESTION, and this package refuses
// to pretend otherwise. Of the ten a lab might use, four report a real
// remaining figure and they report it in four different units —
// OpenRouter in dollars of credit, DeepSeek in a currency it names,
// xAI in cents, ElevenLabs in characters. Three more report only what
// has been SPENT, which is a different fact wearing similar clothes.
// Anthropic reports nothing at all to an individual account. So a
// Balance carries its own Kind and Unit, and the console shows what
// each provider actually said rather than forcing them into one
// column of numbers to argue about.
package aiaccount

import (
	"context"
	"errors"
	"time"

	"vantric/internal/registry"
)

var ErrNotFound = errors.New("aiaccount: not found")

// ErrUnsupported is what a provider returns when its account state
// isn't readable with an API key at all — OpenAI's balance is reachable
// only from a browser session, Anthropic's admin API is closed to
// individual accounts. A fact about the provider, and reported as one
// rather than as a failure here.
var ErrUnsupported = errors.New("aiaccount: this provider has no balance API")

// What sort of answer a provider gives.
const (
	// KindCredits is money left to spend.
	KindCredits = "credits"
	// KindQuota is an allowance in the provider's own units, usually
	// resetting each billing period.
	KindQuota = "quota"
	// KindSpend is cost so far, from a provider that won't say what
	// remains. Not a balance, and must not be shown as one.
	KindSpend = "spend"
)

// Balance is the state of one provider account.
type Balance struct {
	Kind string `json:"kind"`
	// Unit is the provider's own — "USD", "characters". A remaining
	// figure with no unit beside it is a number to argue about.
	Unit string `json:"unit"`
	// Remaining is nil where the provider only reports what was used.
	Remaining *float64 `json:"remaining,omitempty"`
	Used      float64  `json:"used"`
	// Granted is what was bought or allowed. Zero where the provider
	// doesn't say.
	Granted float64 `json:"granted"`
	// AsOf is when this was read. A balance is a moving number and a
	// page that doesn't say when it looked is a page you can't trust
	// twice.
	AsOf time.Time `json:"asOf"`
}

// Info identifies the account, for the check that runs before a
// credential is stored.
type Info struct {
	// Label is what the provider calls this key or account, where it
	// says — so a stored credential can be recognised later without
	// reading it back, which this console never does.
	Label string `json:"label,omitempty"`
	// FreeTier is worth stating: a free-tier key has no balance to run
	// down and a page reporting $0.00 left would be alarming about
	// nothing.
	FreeTier bool `json:"freeTier"`
}

// Provider is one model provider's account, as this console reads it.
type Provider interface {
	// Name identifies the implementation, e.g. "openrouter".
	Name() string
	// Check verifies the credential before it is stored.
	Check(ctx context.Context) (*Info, error)
	// Balance reports what is left, or ErrUnsupported.
	Balance(ctx context.Context) (*Balance, error)
}

// Registry holds one live Provider per stored account.
type Registry = registry.Of[Provider]

// NewRegistry returns an empty registry.
func NewRegistry() *Registry { return registry.New[Provider]() }
