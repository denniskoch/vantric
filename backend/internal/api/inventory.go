package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"sort"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/inventory"
	inventoryfactory "vantric/internal/inventory/factory"
	"vantric/internal/kev"
	"vantric/internal/nvd"
	"vantric/internal/store"
)

// Device inventory (FleetDM). Same shape as every other backend here: a
// DB record holding credentials, one live provider per record in a
// registry, verified before it's stored.
//
// What it adds is the one thing neither side can do alone. Fleet knows
// what's installed inside a machine and which CVEs that carries; the
// hypervisor knows the machine. Joining them on the SMBIOS UUID puts a
// guest's packages and vulnerabilities on the page that already shows
// its disks and its address.

func (s *Server) inventoryRoutes(r chi.Router) {
	r.Get("/inventory/provider-types", func(w http.ResponseWriter, r *http.Request) {
		s.json(w, http.StatusOK, inventoryfactory.Types)
	})
	r.Get("/inventory/providers", s.listInventoryProviders)
	r.Post("/inventory/providers", s.createInventoryProvider)
	r.Put("/inventory/providers/{id}", s.updateInventoryProvider)
	r.Delete("/inventory/providers/{id}", s.deleteInventoryProvider)
	r.Get("/inventory/hosts", s.listInventoryHosts)
	r.Get("/inventory/hosts/{id}", s.getInventoryHost)
	r.Get("/inventory/vulnerabilities", s.listInventoryVulnerabilities)
	r.Get("/inventory/vulnerabilities/{cve}", s.getInventoryVulnerability)
	r.Get("/inventory/enrichment", s.getEnrichment)
	r.Put("/inventory/enrichment/key", s.setNVDAPIKey)
	r.Put("/inventory/enrichment/enabled", s.setEnrichmentEnabled)
}

type inventoryProviderView struct {
	store.InventoryProvider
	HasToken bool            `json:"hasToken"`
	Status   string          `json:"status"` // connected | unreachable | unknown
	Info     *inventory.Info `json:"info,omitempty"`
	Error    string          `json:"error,omitempty"`
}

func (s *Server) probeInventoryProvider(ctx context.Context, p store.InventoryProvider) inventoryProviderView {
	view := inventoryProviderView{InventoryProvider: p, HasToken: p.Token != "", Status: "unknown"}
	provider, ok := s.inventoryRegistry.Get(p.ID)
	if !ok {
		view.Error = "no provider loaded"
		return view
	}
	info, err := provider.Verify(ctx)
	if err != nil {
		view.Status = "unreachable"
		view.Error = err.Error()
		return view
	}
	view.Status = "connected"
	view.Info = info
	return view
}

func (s *Server) listInventoryProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := s.store.ListInventoryProviders(r.Context())
	if err != nil {
		s.fail(w, err, "inventory providers")
		return
	}
	views := make([]inventoryProviderView, len(providers))
	var wg sync.WaitGroup
	for i := range providers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			views[i] = s.probeInventoryProvider(r.Context(), providers[i])
		}(i)
	}
	wg.Wait()
	s.json(w, http.StatusOK, views)
}

type inventoryProviderRequest struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	BaseURL     string `json:"baseUrl"`
	Token       string `json:"token"`
	InsecureTLS bool   `json:"insecureTls"`
}

func (s *Server) validateInventoryProvider(w http.ResponseWriter, req *inventoryProviderRequest) bool {
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return false
	}
	if !slices.Contains(inventoryfactory.Types, req.Type) {
		s.err(w, http.StatusBadRequest, "unsupported inventory provider type")
		return false
	}
	if !strings.HasPrefix(req.BaseURL, "http://") && !strings.HasPrefix(req.BaseURL, "https://") {
		s.err(w, http.StatusBadRequest, "base URL must start with http:// or https://")
		return false
	}
	return true
}

func (s *Server) createInventoryProvider(w http.ResponseWriter, r *http.Request) {
	var req inventoryProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateInventoryProvider(w, &req) {
		return
	}
	if strings.TrimSpace(req.Token) == "" {
		s.err(w, http.StatusBadRequest, "an API token is required")
		return
	}
	if existing, err := s.store.GetInventoryProviderByName(r.Context(), req.Name); err == nil && existing != nil {
		s.err(w, http.StatusConflict, "a provider with this name already exists")
		return
	}
	p := &store.InventoryProvider{
		ID:          uuid.NewString(),
		Name:        req.Name,
		Type:        req.Type,
		BaseURL:     strings.TrimRight(strings.TrimSpace(req.BaseURL), "/"),
		Token:       strings.TrimSpace(req.Token),
		InsecureTLS: req.InsecureTLS,
	}
	provider, err := inventoryfactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	// Reject credentials that don't work rather than storing a provider
	// that can never connect.
	if _, err := provider.Verify(r.Context()); err != nil {
		s.log.Warn("inventory provider rejected", "name", p.Name, "type", p.Type, "error", err)
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.CreateInventoryProvider(r.Context(), p); err != nil {
		s.fail(w, err, "creating provider")
		return
	}
	s.inventoryRegistry.Set(p.ID, provider)
	s.json(w, http.StatusCreated, s.probeInventoryProvider(r.Context(), *p))
}

func (s *Server) updateInventoryProvider(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetInventoryProvider(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "provider")
		return
	}
	var req inventoryProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateInventoryProvider(w, &req) {
		return
	}
	p.Name = req.Name
	p.Type = req.Type
	p.BaseURL = strings.TrimRight(strings.TrimSpace(req.BaseURL), "/")
	p.InsecureTLS = req.InsecureTLS
	// A blank token means "keep the one you have", so editing the URL
	// doesn't require retyping a secret the API never gave back.
	if token := strings.TrimSpace(req.Token); token != "" {
		p.Token = token
	}
	provider, err := inventoryfactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := provider.Verify(r.Context()); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.UpdateInventoryProvider(r.Context(), p); err != nil {
		s.fail(w, err, "updating provider")
		return
	}
	s.inventoryRegistry.Set(p.ID, provider)
	s.json(w, http.StatusOK, s.probeInventoryProvider(r.Context(), *p))
}

func (s *Server) deleteInventoryProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteInventoryProvider(r.Context(), id); err != nil {
		s.fail(w, err, "deleting provider")
		return
	}
	s.inventoryRegistry.Remove(id)
	w.WriteHeader(http.StatusNoContent)
}

// instanceInventory is the OS Info tab's second half: what the agent
// inside this guest reports.
//
// The correlation is the point, so the answer distinguishes the three
// states rather than collapsing them into an empty list: no inventory
// service configured at all, a service that has never heard of this
// machine, and a machine it knows. The middle one is a real finding —
// an unenrolled guest — not an error.
type instanceInventoryView struct {
	// Configured is false when no inventory service is connected, which
	// is why the tab has nothing rather than the guest being unknown.
	Configured bool                  `json:"configured"`
	Enrolled   bool                  `json:"enrolled"`
	Detail     *inventory.HostDetail `json:"detail,omitempty"`
	// UUID is what was searched for, so an unenrolled guest can say
	// which identity failed to match.
	UUID  string `json:"uuid"`
	Error string `json:"error,omitempty"`
}

func (s *Server) instanceInventory(w http.ResponseWriter, r *http.Request) {
	inst, err := s.store.GetInstance(r.Context(), chi.URLParam(r, "instance"))
	if err != nil {
		s.fail(w, err, "instance")
		return
	}
	view := instanceInventoryView{UUID: inst.UUID}
	provider, ok := s.inventoryRegistry.Any()
	if !ok {
		s.json(w, http.StatusOK, view)
		return
	}
	view.Configured = true
	if inst.UUID == "" {
		// Nothing to search by yet: the reconciler fills the UUID on a
		// slow beat, so a freshly created guest lands here briefly.
		view.Error = "this instance's system UUID hasn't been read from the hypervisor yet"
		s.json(w, http.StatusOK, view)
		return
	}
	detail, err := provider.HostByUUID(r.Context(), inst.UUID)
	if errors.Is(err, inventory.ErrNotFound) {
		s.json(w, http.StatusOK, view)
		return
	}
	if err != nil {
		view.Error = err.Error()
		s.json(w, http.StatusOK, view)
		return
	}
	view.Enrolled = true
	s.enrichHostVulnerabilities(r.Context(), detail.Vulnerabilities)
	view.Detail = detail
	s.json(w, http.StatusOK, view)
}

// inventoryHostView is a host the inventory service knows, with the
// one thing it can't know: whether this console runs the machine.
//
// That correlation is the reason this section exists. Fleet holds
// laptops and bare metal as readily as VMs and has never heard of a
// hypervisor; this console knows the guests and nothing about a
// MacBook. Neither can see that a VM is missing an agent, or that an
// agent is still reporting for a VM that was deleted.
type inventoryHostView struct {
	inventory.Host
	// Instance is the VM in this console reporting the same system
	// UUID, empty when there is none.
	Instance string `json:"instance"`
	// Managed says the machine is one this console runs. False means
	// physical, or somebody else's — expected, not a fault.
	Managed bool `json:"managed"`
}

type inventoryHostsResponse struct {
	Configured bool                `json:"configured"`
	Hosts      []inventoryHostView `json:"hosts"`
	// Unenrolled are instances this console runs that no agent reports:
	// the other direction of the same drift, and the one that means
	// somebody has to go and install something.
	Unenrolled []string `json:"unenrolled"`
	Error      string   `json:"error,omitempty"`
}

func (s *Server) listInventoryHosts(w http.ResponseWriter, r *http.Request) {
	out := inventoryHostsResponse{Hosts: []inventoryHostView{}, Unenrolled: []string{}}
	provider, ok := s.inventoryRegistry.Any()
	if !ok {
		s.json(w, http.StatusOK, out)
		return
	}
	out.Configured = true
	hosts, err := provider.Hosts(r.Context())
	if err != nil {
		out.Error = err.Error()
		s.json(w, http.StatusOK, out)
		return
	}
	instances, err := s.store.ListInstances(r.Context())
	if err != nil {
		s.fail(w, err, "instances")
		return
	}
	byUUID := map[string]string{}
	for _, inst := range instances {
		if inst.UUID != "" {
			byUUID[strings.ToLower(inst.UUID)] = inst.Name
		}
	}
	seen := map[string]bool{}
	for _, host := range hosts {
		view := inventoryHostView{Host: host}
		if name, found := byUUID[strings.ToLower(host.UUID)]; found {
			view.Instance = name
			view.Managed = true
			seen[name] = true
			// A GUEST THIS CONSOLE RUNS IS VIRTUAL whatever SMBIOS said.
			// The vendor string is the general answer, but it is the
			// hypervisor's to write and can be absent or unfamiliar; a
			// machine we are demonstrably running is not a judgement
			// call, and this keeps such a guest off the physical list
			// rather than in a bucket where nobody is looking for it.
			view.Virtual = true
		}
		out.Hosts = append(out.Hosts, view)
	}
	for _, inst := range instances {
		if !seen[inst.Name] {
			out.Unenrolled = append(out.Unenrolled, inst.Name)
		}
	}
	sort.Strings(out.Unenrolled)
	sort.SliceStable(out.Hosts, func(i, j int) bool {
		return out.Hosts[i].Hostname < out.Hosts[j].Hostname
	})
	s.json(w, http.StatusOK, out)
}

type inventoryVulnerabilitiesResponse struct {
	Configured bool `json:"configured"`
	// Supported is false when the service is connected but can't answer
	// this — an older Fleet, or one without the licence. A missing
	// feature, not a broken connection, and it reads differently.
	Supported       bool                             `json:"supported"`
	Vulnerabilities []inventory.VulnerabilitySummary `json:"vulnerabilities"`
	Error           string                           `json:"error,omitempty"`
}

func (s *Server) listInventoryVulnerabilities(w http.ResponseWriter, r *http.Request) {
	out := inventoryVulnerabilitiesResponse{Vulnerabilities: []inventory.VulnerabilitySummary{}}
	provider, ok := s.inventoryRegistry.Any()
	if !ok {
		s.json(w, http.StatusOK, out)
		return
	}
	out.Configured, out.Supported = true, true
	vulns, err := provider.Vulnerabilities(r.Context())
	if errors.Is(err, inventory.ErrUnsupported) {
		out.Supported = false
		s.json(w, http.StatusOK, out)
		return
	}
	if err != nil {
		out.Error = err.Error()
		s.json(w, http.StatusOK, out)
		return
	}
	// Scores and descriptions from the cache, where the worker has put
	// them. Fleet's own score is kept when it has one — a paid tier
	// knows things NVD doesn't — but the DESCRIPTION is always the
	// cache's, because the inventory service has none at all. It is the
	// column that turns four thousand identifiers into a list somebody
	// can read, and it costs nothing here: this query already returned
	// the whole record and threw everything but the score away.
	if enriched, err := s.store.CVEScores(r.Context()); err == nil {
		for i := range vulns {
			c, ok := enriched[vulns[i].CVE]
			if !ok {
				continue
			}
			if vulns[i].CVSSScore == 0 {
				vulns[i].CVSSScore = c.Score
				vulns[i].Severity = c.Severity
			}
			vulns[i].Description = c.Description
		}
	}

	// Whether anyone is actually exploiting it, from CISA rather than
	// from the inventory service — whose field for this is gated behind
	// a paid tier and arrives empty, which would make every CVE read as
	// "not exploited". A failure leaves the flags off and the page
	// otherwise intact; it is a public file and never worth a 500.
	if catalogue, err := s.kev.Catalogue(r.Context()); err != nil {
		s.log.Warn("kev catalogue unavailable", "error", err)
	} else {
		for i := range vulns {
			if e, ok := catalogue[vulns[i].CVE]; ok {
				vulns[i].KnownExploited = true
				vulns[i].ExploitedName = e.VulnerabilityName
			}
		}
	}
	out.Vulnerabilities = vulns
	s.json(w, http.StatusOK, out)
}

// inventoryHostDetailView is one machine's page: everything the service
// holds about it, plus the instance here reporting the same UUID.
type inventoryHostDetailView struct {
	*inventory.HostDetail
	// Instance is the VM in this console that is this machine, empty
	// when it's physical or somebody else's.
	Instance string `json:"instance"`
	Managed  bool   `json:"managed"`
}

func (s *Server) getInventoryHost(w http.ResponseWriter, r *http.Request) {
	provider, ok := s.inventoryRegistry.Any()
	if !ok {
		s.err(w, http.StatusNotFound, "no inventory service is connected")
		return
	}
	detail, err := provider.HostByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "host")
		return
	}
	s.enrichHostVulnerabilities(r.Context(), detail.Vulnerabilities)
	view := inventoryHostDetailView{HostDetail: detail}
	// The correlation again, from the other end: this page knows the
	// host and wants the guest, where the list knew the guests.
	if detail.Host.UUID != "" {
		instances, err := s.store.ListInstances(r.Context())
		if err != nil {
			s.fail(w, err, "instances")
			return
		}
		for _, inst := range instances {
			if strings.EqualFold(inst.UUID, detail.Host.UUID) {
				view.Instance, view.Managed = inst.Name, true
				break
			}
		}
	}
	s.json(w, http.StatusOK, view)
}

// vulnerabilityHostView is an affected machine with the correlation
// attached, which is what this page is for: Fleet can tell you six
// hosts have a CVE, but only this console can tell you which of them
// are yours to fix and where they live.
type vulnerabilityHostView struct {
	inventory.Host
	Instance string `json:"instance"`
	Managed  bool   `json:"managed"`
}

type vulnerabilityDetailView struct {
	Summary        inventory.VulnerabilitySummary `json:"summary"`
	Hosts          []vulnerabilityHostView        `json:"hosts"`
	Software       []inventory.VulnerableSoftware `json:"software"`
	DetectedAt     int64                          `json:"detectedAt"`
	HostsCountedAt int64                          `json:"hostsCountedAt"`
	// NVD is what the public database says about the flaw itself:
	// absent when it has nothing, or when it couldn't be reached, which
	// is a page with less on it rather than a page that failed.
	NVD      *nvd.Record `json:"nvd,omitempty"`
	NVDError string      `json:"nvdError,omitempty"`
	// KEV is CISA's whole record when this is one they list as actively
	// exploited. The list only needs a flag and a name; a page with room
	// carries the rest — when it was catalogued, the action CISA calls
	// for, and whether it's been seen in ransomware — because that is
	// the difference between "patch this eventually" and "patch this".
	KEV *kev.Entry `json:"kev,omitempty"`
}

func (s *Server) getInventoryVulnerability(w http.ResponseWriter, r *http.Request) {
	provider, ok := s.inventoryRegistry.Any()
	if !ok {
		s.err(w, http.StatusNotFound, "no inventory service is connected")
		return
	}
	cve := chi.URLParam(r, "cve")
	// The inventory service and the public database are asked at the
	// same time: one knows who has it, the other knows what it is, and
	// neither should wait for the other.
	var (
		detail    *inventory.VulnerabilityDetail
		record    *nvd.Record
		fleetErr  error
		lookupErr error
		wg        sync.WaitGroup
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		detail, fleetErr = provider.Vulnerability(r.Context(), cve)
	}()
	go func() {
		defer wg.Done()
		// The cache first: the worker has probably been here already,
		// and a page shouldn't wait on a public API for something it
		// already holds.
		if cached, err := s.store.GetCVE(r.Context(), cve); err == nil {
			record = enrichedRecord(cached)
			return
		}
		record, lookupErr = s.nvd.Lookup(r.Context(), cve)
	}()
	wg.Wait()
	if fleetErr != nil {
		s.fail(w, fleetErr, "vulnerability")
		return
	}
	instances, err := s.store.ListInstances(r.Context())
	if err != nil {
		s.fail(w, err, "instances")
		return
	}
	byUUID := map[string]string{}
	for _, inst := range instances {
		if inst.UUID != "" {
			byUUID[strings.ToLower(inst.UUID)] = inst.Name
		}
	}
	// The same CISA join the list does, or the two pages would disagree
	// about one CVE — which is the shape of bug that had the Devices
	// page calling a machine managed while its own instance page called
	// it unenrolled.
	var exploited *kev.Entry
	if catalogue, err := s.kev.Catalogue(r.Context()); err == nil {
		if e, ok := catalogue[strings.ToUpper(cve)]; ok {
			detail.Summary.KnownExploited = true
			detail.Summary.ExploitedName = e.VulnerabilityName
			entry := e
			exploited = &entry
		}
	}
	out := vulnerabilityDetailView{
		Summary:        detail.Summary,
		Hosts:          []vulnerabilityHostView{},
		Software:       detail.Software,
		DetectedAt:     detail.DetectedAt,
		HostsCountedAt: detail.HostsCountedAt,
		NVD:            record,
		KEV:            exploited,
	}
	if lookupErr != nil {
		// Said out loud rather than swallowed: "no description" and
		// "couldn't reach NVD" are different facts.
		out.NVDError = lookupErr.Error()
		s.log.Warn("nvd lookup failed", "cve", cve, "error", lookupErr)
	}
	for _, host := range detail.Hosts {
		view := vulnerabilityHostView{Host: host}
		if name, found := byUUID[strings.ToLower(host.UUID)]; found {
			view.Instance, view.Managed = name, true
		}
		out.Hosts = append(out.Hosts, view)
	}
	s.json(w, http.StatusOK, out)
}

// nvdAPIKeySetting is where the key lives. A credential for an outside
// service, so it follows the same rule as every other one here: a row
// in the database, changeable in the UI, never in config.
const nvdAPIKeySetting = "nvd.apiKey"

// nvdEnrichSetting turns the background pass off for this console.
//
// NVD meters per API key, and per IP for anonymous callers, so two
// consoles sharing either will contend — a dev instance and a
// production one backfilling the same five thousand CVEs is one of them
// getting rate limited. The answer isn't to drop the key, which also
// slows the on-demand lookups; it's to let one console do the backfill
// and the other read what it needs.
const nvdEnrichSetting = "nvd.enrichment"

type enrichmentView struct {
	EnrichmentStatus
	// Cache is the durable side — what's been collected across every
	// run, as opposed to what this process has done since it started.
	Cache *store.CVECacheStats `json:"cache"`
	// Total is how many CVEs the inventory service reports, so the
	// page can say 4,200 of 4,941 rather than a bare count. Cache is
	// counted against this same set, or the two disagree.
	Total int `json:"total"`
	// CachedOverall is every CVE ever fetched, including the ones the
	// estate no longer reports. Always >= Cache.enriched + missing,
	// and reported separately rather than folded in, because that
	// difference is what made the progress line impossible.
	CachedOverall int `json:"cachedOverall"`
	// Enabled is whether THIS console runs the background pass.
	Enabled bool `json:"enabled"`
}

func (s *Server) getEnrichment(w http.ResponseWriter, r *http.Request) {
	view := enrichmentView{EnrichmentStatus: s.enrich.Status(r.Context())}
	view.Enabled = s.enrich.Enabled()
	stats, err := s.store.CVECacheStats(r.Context())
	if err != nil {
		s.fail(w, err, "cve cache")
		return
	}
	view.Cache = stats
	view.CachedOverall = stats.Enriched + stats.Missing

	// Progress is counted against the CVEs the estate reports NOW, not
	// against the whole cache. The cache is cumulative — a CVE stays
	// after its package is patched or its host is retired — so the two
	// are different populations, and comparing them reported more
	// enriched than existed ("5,237 of 4,711") once enough of the
	// estate had moved on.
	if provider, ok := s.inventoryRegistry.Any(); ok {
		if summaries, err := provider.Vulnerabilities(r.Context()); err == nil {
			view.Total = len(summaries)
			index, err := s.store.CVECacheIndex(r.Context())
			if err != nil {
				s.fail(w, err, "cve cache")
				return
			}
			current := store.CVECacheStats{NewestAt: stats.NewestAt}
			for _, summary := range summaries {
				entry, ok := index[summary.CVE]
				switch {
				case !ok:
					continue
				case entry.Missing:
					current.Missing++
				default:
					current.Enriched++
					if entry.HasScore {
						current.WithScore++
					}
				}
			}
			view.Cache = &current
		}
	}
	s.json(w, http.StatusOK, view)
}

func (s *Server) setNVDAPIKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Key string `json:"key"`
		// Remove has to be asked for. A blank key means "keep the one
		// you have" — the same rule the provider forms follow, and the
		// reason is the same: the field is write-only, so it is ALWAYS
		// blank when the page loads, and a save with an empty box
		// silently deleted a working key.
		Remove bool `json:"remove"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	key := strings.TrimSpace(req.Key)
	if key == "" && !req.Remove {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := s.store.SetSetting(r.Context(), nvdAPIKeySetting, key); err != nil {
		s.fail(w, err, "saving the key")
		return
	}
	s.nvd.SetAPIKey(key)
	s.log.Info("nvd api key updated", "present", key != "")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) setEnrichmentEnabled(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	value := "off"
	if req.Enabled {
		value = "on"
	}
	if err := s.store.SetSetting(r.Context(), nvdEnrichSetting, value); err != nil {
		s.fail(w, err, "saving the setting")
		return
	}
	s.enrich.SetEnabled(req.Enabled)
	s.log.Info("cve enrichment toggled", "enabled", req.Enabled)
	w.WriteHeader(http.StatusNoContent)
}

// enrichHostVulnerabilities fills in what the inventory service can't
// tell you about a CVE on a specific machine: how bad it is, and
// whether anyone is exploiting it.
//
// Both come from elsewhere — the score from the console's own CVE
// cache, the exploited flag from CISA — because Fleet supplies neither
// on a free tier. Without this a host's vulnerability table is a list
// of identifiers with no way to tell the urgent from the ancient, and
// on a machine carrying three thousand of them that is the same as no
// list at all.
//
// It runs for BOTH places that table appears — the host detail page and
// a guest's OS Info tab — because they render the same component, and a
// panel that means different things depending on which page it's on is
// worse than one that means nothing.
//
// Neither lookup is fatal: a missing score leaves "not scored", a
// missing catalogue leaves the flames off. The packages and the CVE
// list are the page; these are columns.
func (s *Server) enrichHostVulnerabilities(ctx context.Context, vulns []inventory.Vulnerability) {
	if len(vulns) == 0 {
		return
	}
	if scores, err := s.store.CVEScores(ctx); err == nil {
		for i := range vulns {
			if c, ok := scores[vulns[i].CVE]; ok && vulns[i].CVSSScore == 0 {
				vulns[i].CVSSScore = c.Score
				vulns[i].Severity = c.Severity
			}
		}
	}
	catalogue, err := s.kev.Catalogue(ctx)
	if err != nil {
		s.log.Warn("kev catalogue unavailable", "error", err)
		return
	}
	for i := range vulns {
		if _, listed := catalogue[strings.ToUpper(vulns[i].CVE)]; listed {
			vulns[i].KnownExploited = true
		}
	}
}
