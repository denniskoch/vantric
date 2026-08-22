// Package monitoring defines the abstraction over monitoring services
// (Zabbix first). It mirrors the other nine splits: nothing outside
// internal/monitoring/* may import a service's specifics.
//
// READ ONLY, more like Devices than Network: this console shows what
// the monitoring service concluded, and the service's own judgment —
// triggers, templates, thresholds — stays where its blast radius is.
// The daily 90% here is one question: what is on fire, and since when.
//
// SEVERITY IS THE SERVICE'S OWN VOCABULARY, carried as words. Zabbix
// says Disaster, High, Average, Warning, Information, Not classified —
// and mapping those onto some vocabulary of ours would be deciding
// what Zabbix meant, the mistake the AI section's status passthrough
// already declines. Rank is carried beside the word so tables can sort
// without parsing prose.
package monitoring

import (
	"context"
	"errors"
	"time"

	"vantric/internal/registry"
)

var ErrNotFound = errors.New("monitoring: not found")

// Info identifies the service, for the check that runs before a
// credential is stored.
type Info struct {
	Version string `json:"version"`
	// Hosts is how many machines it watches — the number that says
	// whether this is the right service.
	Hosts int `json:"hosts"`
}

// Problem is one thing the service says is wrong right now.
type Problem struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Host is who has the problem, as the service names it. Empty where
	// the service didn't say — a problem with no host is still a
	// problem.
	HostID string `json:"hostId,omitempty"`
	Host   string `json:"host,omitempty"`
	// Severity is the service's own word; Rank orders it, higher worse.
	Severity string `json:"severity"`
	Rank     int    `json:"rank"`
	// StartedAt is when the service first saw it. Age is the second
	// question anyone asks about an alert.
	StartedAt time.Time `json:"startedAt"`
	// Acknowledged means a person has seen it; Suppressed means a
	// maintenance window is hiding it on purpose. Both are shown rather
	// than filtered: a console that silently drops suppressed problems
	// re-alerts on work somebody scheduled.
	Acknowledged bool `json:"acknowledged"`
	Suppressed   bool `json:"suppressed"`
}

// Host is a machine the service watches.
type Host struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Addresses are the interfaces the service reaches it on — the join
	// key to this console's instances, since a monitoring agent doesn't
	// report SMBIOS and IP is what both sides hold fresh.
	Addresses []string `json:"addresses"`
	Enabled   bool     `json:"enabled"`
}

// Provider is the monitoring service contract. Implementations must be
// safe for concurrent use.
type Provider interface {
	// Name identifies the implementation, e.g. "zabbix".
	Name() string
	// Check verifies the credential before it is stored.
	Check(ctx context.Context) (*Info, error)
	// Problems lists what is wrong right now, worst first.
	Problems(ctx context.Context) ([]Problem, error)
	// Hosts lists what the service watches.
	Hosts(ctx context.Context) ([]Host, error)
}

// Registry holds one live Provider per configured record.
type Registry = registry.Of[Provider]

// NewRegistry returns an empty registry.
func NewRegistry() *Registry { return registry.New[Provider]() }
