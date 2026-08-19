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
	ID string `json:"id"`
	// Name is what the inventory service CALLS this machine — Fleet's
	// display_name, which is the computer name where one is set and the
	// hostname otherwise. It is what its own UI shows, and it is what a
	// person recognises: "Diane's MacBook Air" rather than
	// "mac.localdomain", "wireguard" rather than "debian".
	//
	// Choosing the hostname over this was the same mistake as matching
	// guests by hostname instead of UUID — preferring what the machine
	// calls itself over what somebody deliberately named it. Fifteen of
	// this lab's twenty-one hosts differ between the two.
	Name string `json:"name"`
	// Hostname is the machine's own, kept because it's how you'd reach
	// the thing — a display name is for finding it in a list, not for
	// typing into ssh.
	Hostname string `json:"hostname"`
	// UUID is the hardware/system UUID the agent reports, and the key
	// this console correlates on.
	UUID   string `json:"uuid"`
	Serial string `json:"serial"`
	// Vendor and Model are the hardware as the agent read it. They are
	// carried rather than reduced to Virtual alone because the physical
	// listing shows the model — "Macmini9,1" is what that machine IS.
	Vendor string `json:"vendor"`
	Model  string `json:"model"`
	// Virtual is derived from the two above by IsVirtual. It is what
	// separates the laptops from the guests, and it is a derivation
	// rather than a stored flag on purpose.
	Virtual bool `json:"virtual"`
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
	// OperatingSystem marks a flaw in the OS itself rather than in
	// something installed on it. It has no package to upgrade and no
	// installed version — the fix is a system update — so a row saying
	// "no fix published" about one would be describing the wrong thing.
	OperatingSystem bool `json:"operatingSystem"`
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
	Hosts int `json:"hosts"`
	// DetectedAt is when the service first saw it here — unix seconds.
	// Unlike a CVSS score, every tier reports this, which makes it the
	// column a list can rely on.
	DetectedAt int64   `json:"detectedAt"`
	CVSSScore  float64 `json:"cvssScore"`
	Severity   string  `json:"severity"`
	EPSS       float64 `json:"epss"`
	// Description is NVD's summary of the flaw, filled from the console's
	// CVE cache rather than by the inventory service, which doesn't carry
	// one. It's what turns a wall of identifiers into a readable list.
	Description string `json:"description"`
	// KnownExploited means CISA lists it as exploited in the wild. The
	// inventory service has a field for this and only fills it on a paid
	// tier, so it is joined from the catalogue itself — see internal/kev.
	KnownExploited bool `json:"knownExploited"`
	// ExploitedName is CISA's own name for it, e.g. "Apache Log4j2
	// Remote Code Execution Vulnerability". Empty unless KnownExploited.
	ExploitedName string `json:"exploitedName"`
	PublishedAt   int64  `json:"publishedAt"`
	DetailsURL    string `json:"detailsUrl"`
}

// VulnerableSoftware is one package version carrying a CVE, and how
// many machines have it.
type VulnerableSoftware struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Source  string `json:"source"`
	Hosts   int    `json:"hosts"`
	// ResolvedInVersion is the upgrade that fixes it, empty when none
	// has been published.
	ResolvedInVersion string `json:"resolvedInVersion"`
}

// VulnerabilityDetail is one CVE across the estate: what it is, which
// machines have it, and which package versions carry it. The list
// answers "how bad"; this answers "where, and what do I patch".
type VulnerabilityDetail struct {
	Summary  VulnerabilitySummary `json:"summary"`
	Hosts    []Host               `json:"hosts"`
	Software []VulnerableSoftware `json:"software"`
	// DetectedAt is when the service first saw it, HostsCountedAt when
	// it last recounted — both unix seconds, both worth showing because
	// they answer different questions.
	DetectedAt     int64 `json:"detectedAt"`
	HostsCountedAt int64 `json:"hostsCountedAt"`
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
	// HostByID fetches one machine by the service's own identifier,
	// which is what a drill-in page has in its URL. Same payload as
	// HostByUUID: the machine, its software, and the CVEs that carries.
	HostByID(ctx context.Context, id string) (*HostDetail, error)
	// Vulnerabilities rolls up every CVE the service is tracking across
	// every machine. Providers that can't answer return ErrUnsupported,
	// which the console reports as a missing feature rather than a
	// broken connection.
	Vulnerabilities(ctx context.Context) ([]VulnerabilitySummary, error)
	// Vulnerability is one CVE in full: the machines carrying it and
	// the package versions responsible.
	Vulnerability(ctx context.Context, cve string) (*VulnerabilityDetail, error)
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
