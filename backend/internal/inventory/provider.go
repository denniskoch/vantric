// Package inventory defines the abstraction over device inventory
// services (FleetDM first). It mirrors internal/hypervisor,
// internal/dns, internal/database, internal/identity and
// internal/network: nothing outside internal/inventory/* may import a
// provider's specifics.
//
// The provider owns what's INSIDE the guests. An agent on each machine
// reports its packages and the vulnerabilities they carry, and that
// data belongs to the tool collecting it — this console reads it and
// shows it beside the machine it describes, which is the one thing the
// inventory tool can't do, because it has never heard of a hypervisor.
//
// The join is the SMBIOS UUID: the hypervisor knows it as the guest's
// identity and the agent reports the same value from inside. Matching
// on hostname would be matching on something two systems can disagree
// about.
package inventory

import (
	"context"
	"errors"
	"sync"
)

var ErrNotFound = errors.New("inventory: not found")

// ErrUnsupported is what a provider returns for a capability its
// version or licence doesn't include — a fact about the service, not a
// failure of this console, and reported as such.
var ErrUnsupported = errors.New("inventory: not supported by this service")

// Info is what the provider reports about itself, for the connection
// check that runs before a record is stored.
type Info struct {
	Version string `json:"version"`
	// Hosts is how many machines the service is tracking, which is the
	// number that tells you whether it's the right service.
	Hosts int `json:"hosts"`
}

// Host is a machine the inventory service knows about.
type Host struct {
	ID       string `json:"id"`
	Hostname string `json:"hostname"`
	// UUID is the hardware/system UUID the agent reports, and the key
	// this console correlates on.
	UUID   string `json:"uuid"`
	Serial string `json:"serial"`
	// Platform and OSVersion are the agent's own words for the guest.
	Platform  string `json:"platform"`
	OSVersion string `json:"osVersion"`
	// Status is "online" or "offline" as the service judges it.
	Status string `json:"status"`
	// SeenAt and UpdatedAt are unix seconds: when the agent last
	// checked in, and when its detail was last collected. A package
	// list is only as true as UpdatedAt.
	SeenAt    int64 `json:"seenAt"`
	UpdatedAt int64 `json:"updatedAt"`
	// Issues are failing policy checks, where the service runs them.
	IssuesFailing int `json:"issuesFailing"`
}

// Package is one piece of software installed on a host.
type Package struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	// Source is the package manager it came from: deb_packages,
	// rpm_packages, python_packages…
	Source string `json:"source"`
	// Vulnerabilities carried by this version, where the service
	// computes them.
	Vulnerabilities []Vulnerability `json:"vulnerabilities"`
}

// Vulnerability is a CVE affecting an installed package.
type Vulnerability struct {
	CVE string `json:"cve"`
	// Package and InstalledVersion say what carries it, so the list
	// stands on its own.
	Package          string `json:"package"`
	InstalledVersion string `json:"installedVersion"`
	// Severity is the provider's own word where it has one, otherwise
	// derived from the CVSS score.
	Severity  string  `json:"severity"`
	CVSSScore float64 `json:"cvssScore"`
	// EPSS is the probability of exploitation in the wild, 0 when
	// unknown; KnownExploited is CISA's catalogue.
	EPSS           float64 `json:"epss"`
	KnownExploited bool    `json:"knownExploited"`
	// ResolvedInVersion is the upgrade that fixes it, empty when the
	// service doesn't know of one — which is the difference between
	// "patch this" and "wait".
	ResolvedInVersion string `json:"resolvedInVersion"`
	// PublishedAt is unix seconds; 0 when unknown.
	PublishedAt int64 `json:"publishedAt"`
	// DetailsURL points at the provider's or NVD's page for the CVE.
	DetailsURL string `json:"detailsUrl"`
}

// VulnerabilitySummary is one CVE seen across the estate, which is the
// question a per-machine list can't answer: not "what does this box
// carry" but "who has this, and is it being exploited".
type VulnerabilitySummary struct {
	CVE string `json:"cve"`
	// Hosts is how many machines carry it.
	Hosts          int     `json:"hosts"`
	CVSSScore      float64 `json:"cvssScore"`
	Severity       string  `json:"severity"`
	EPSS           float64 `json:"epss"`
	KnownExploited bool    `json:"knownExploited"`
	PublishedAt    int64   `json:"publishedAt"`
	DetailsURL     string  `json:"detailsUrl"`
}

// HostDetail is everything the console shows on one guest's OS Info
// tab: the host record, its software, and the vulnerabilities that
// software carries.
type HostDetail struct {
	Host            Host            `json:"host"`
	Packages        []Package       `json:"packages"`
	Vulnerabilities []Vulnerability `json:"vulnerabilities"`
}

// Provider is a device inventory service.
//
// It is READ ONLY by design, and more strictly than the network
// section: this console reports what the agents found. Running a live
// query, or pushing a policy, is the inventory tool's own job and its
// own blast radius.
type Provider interface {
	// Verify checks the credentials and returns what the service says
	// about itself. Called before a record is stored, so a saved
	// provider is known-good.
	Verify(ctx context.Context) (*Info, error)
	// Hosts lists every machine the service tracks.
	Hosts(ctx context.Context) ([]Host, error)
	// HostByUUID finds the machine reporting this system UUID, which is
	// how a VM here is matched to a host there. ErrNotFound when the
	// guest isn't enrolled — an ordinary answer, not a failure.
	HostByUUID(ctx context.Context, uuid string) (*HostDetail, error)
	// Vulnerabilities rolls up every CVE the service is tracking across
	// every machine. Providers that can't answer return ErrUnsupported,
	// which the console reports as a missing feature rather than a
	// broken connection.
	Vulnerabilities(ctx context.Context) ([]VulnerabilitySummary, error)
}

// Registry holds one live Provider per configured record, keyed by its
// record ID.
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

// Any returns a provider when exactly one is configured, which is the
// case a lab is in: endpoints then don't need a provider id they can't
// get wrong. The same shortcut the identity section takes.
func (r *Registry) Any() (Provider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.providers) != 1 {
		return nil, false
	}
	for _, p := range r.providers {
		return p, true
	}
	return nil, false
}
