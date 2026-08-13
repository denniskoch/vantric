// Package dns defines the abstraction over DNS providers (Cloudflare
// first, others later). It mirrors internal/hypervisor: nothing outside
// internal/dns/* may import a provider's specifics.
package dns

import (
	"context"
	"errors"
	"sync"
)

// ErrNotFound is returned when a zone no longer exists at the provider.
var ErrNotFound = errors.New("dns: not found")

// Account is a billing/organisation container at the provider. Zones
// are created inside one.
type Account struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Zone is a DNS zone as the provider reports it.
type Zone struct {
	// ProviderID is filled in by the API layer, not the provider.
	ProviderID  string   `json:"providerId"`
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Status      string   `json:"status"` // active, pending, …
	Nameservers []string `json:"nameservers"`
	AccountID   string   `json:"accountId"`
	AccountName string   `json:"accountName"`
	// Type is the provider's zone mode: "full" when it is authoritative,
	// "partial" for CNAME setups.
	Type    string `json:"type"`
	Paused  bool   `json:"paused"`
	Records int    `json:"records"`
	// CreatedAt is unix seconds; 0 when the provider doesn't report it.
	CreatedAt int64 `json:"createdAt"`
}

// ZoneSpec describes a zone to create.
type ZoneSpec struct {
	Name      string
	AccountID string
	// Type is "full" (default) or "partial".
	Type string
}

// Provider is the DNS backend contract. Implementations must be safe
// for concurrent use.
type Provider interface {
	// Type identifies the provider, e.g. "cloudflare".
	Type() string
	// Verify checks the credentials without changing anything.
	Verify(ctx context.Context) error
	Accounts(ctx context.Context) ([]Account, error)
	Zones(ctx context.Context) ([]Zone, error)
	CreateZone(ctx context.Context, spec ZoneSpec) (*Zone, error)
	DeleteZone(ctx context.Context, zoneID string) error
}

// Registry holds one live Provider per configured DNS provider, keyed
// by its record ID, and is updated as providers are added or edited.
type Registry struct {
	mu        sync.RWMutex
	providers map[string]Provider
}

func NewRegistry() *Registry {
	return &Registry{providers: map[string]Provider{}}
}

func (r *Registry) Get(id string) (Provider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[id]
	return p, ok
}

func (r *Registry) Set(id string, p Provider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[id] = p
}

func (r *Registry) Remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.providers, id)
}
