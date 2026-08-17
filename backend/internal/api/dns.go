package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/dns"
	dnsfactory "vantric/internal/dns/factory"
	"vantric/internal/store"
)

// DNS providers hold credentials for a DNS account; zones are the
// resources they contain. Same shape as servers and instances.

// domainRe is deliberately permissive: providers reject what they don't
// like, and this only needs to catch obvious mistakes (spaces, schemes).
var domainRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)

func (s *Server) dnsRoutes(r chi.Router) {
	r.Get("/dns/provider-types", func(w http.ResponseWriter, r *http.Request) {
		s.json(w, http.StatusOK, dnsfactory.Types)
	})
	r.Get("/dns/providers", s.listDNSProviders)
	r.Post("/dns/providers", s.createDNSProvider)
	r.Put("/dns/providers/{id}", s.updateDNSProvider)
	r.Delete("/dns/providers/{id}", s.deleteDNSProvider)
	r.Get("/dns/accounts", s.listDNSAccounts)
	r.Get("/dns/zones", s.listDNSZones)
	r.Post("/dns/zones", s.createDNSZone)
	r.Get("/dns/zones/{id}", s.getDNSZone)
	r.Get("/dns/zones/{id}/records", s.listDNSRecords)
	r.Get("/dns/zones/{id}/soa", s.zoneSOA)
	r.Put("/dns/zones/{id}/soa", s.saveZoneSOA)
	r.Put("/dns/zones/{id}/record-sets", s.saveDNSRecordSet)
	r.Delete("/dns/zones/{id}/record-sets", s.deleteDNSRecordSet)
	r.Delete("/dns/zones/{id}", s.deleteDNSZone)
}

// dnsProviderView is the API shape: everything but the token, plus a
// live connection check.
type dnsProviderView struct {
	store.DNSProvider
	HasToken bool   `json:"hasToken"`
	Status   string `json:"status"` // connected | unreachable | unknown
	Zones    int    `json:"zones"`
	Error    string `json:"error,omitempty"`
}

func (s *Server) probeDNSProvider(ctx context.Context, p store.DNSProvider) dnsProviderView {
	view := dnsProviderView{DNSProvider: p, HasToken: p.Token != "", Status: "unknown"}
	provider, ok := s.dnsRegistry.Get(p.ID)
	if !ok {
		view.Error = "no provider loaded"
		return view
	}
	zones, err := provider.Zones(ctx)
	if err != nil {
		view.Status = "unreachable"
		view.Error = err.Error()
		return view
	}
	view.Status = "connected"
	view.Zones = len(zones)
	return view
}

func (s *Server) listDNSProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := s.store.ListDNSProviders(r.Context())
	if err != nil {
		s.fail(w, err, "dns providers")
		return
	}
	views := make([]dnsProviderView, len(providers))
	var wg sync.WaitGroup
	for i := range providers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			views[i] = s.probeDNSProvider(r.Context(), providers[i])
		}(i)
	}
	wg.Wait()
	s.json(w, http.StatusOK, views)
}

type dnsProviderRequest struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	Token     string `json:"token"`
	AccountID string `json:"accountId"`
	BaseURL   string `json:"baseUrl"`
}

func (s *Server) validateDNSProvider(w http.ResponseWriter, req *dnsProviderRequest) bool {
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return false
	}
	if !slices.Contains(dnsfactory.Types, req.Type) {
		s.err(w, http.StatusBadRequest, "unsupported DNS provider type")
		return false
	}
	// A self-hosted provider has to be told where it is; a hosted one
	// has no address to give, so accepting one would be accepting a
	// setting that does nothing.
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	if dnsfactory.SelfHosted(req.Type) {
		if req.BaseURL == "" {
			s.err(w, http.StatusBadRequest, "an API URL is required, e.g. http://192.168.1.10:8081")
			return false
		}
		u, err := url.Parse(req.BaseURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			s.err(w, http.StatusBadRequest, "the API URL must be a full http:// or https:// address")
			return false
		}
	} else {
		req.BaseURL = ""
	}
	return true
}

func (s *Server) createDNSProvider(w http.ResponseWriter, r *http.Request) {
	var req dnsProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateDNSProvider(w, &req) {
		return
	}
	if strings.TrimSpace(req.Token) == "" {
		s.err(w, http.StatusBadRequest, "an API token is required")
		return
	}
	if existing, err := s.store.GetDNSProviderByName(r.Context(), req.Name); err == nil && existing != nil {
		s.err(w, http.StatusConflict, "a provider with this name already exists")
		return
	}
	p := &store.DNSProvider{
		ID:        uuid.NewString(),
		Name:      req.Name,
		Type:      req.Type,
		Token:     strings.TrimSpace(req.Token),
		AccountID: req.AccountID,
		BaseURL:   req.BaseURL,
	}
	provider, err := dnsfactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	// Reject credentials that don't work rather than storing a provider
	// that can never connect.
	if err := provider.Verify(r.Context()); err != nil {
		s.log.Warn("dns provider rejected", "name", p.Name, "type", p.Type, "error", err)
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.CreateDNSProvider(r.Context(), p); err != nil {
		s.fail(w, err, "creating provider")
		return
	}
	s.dnsRegistry.Set(p.ID, provider)
	s.json(w, http.StatusCreated, s.probeDNSProvider(r.Context(), *p))
}

func (s *Server) updateDNSProvider(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetDNSProvider(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "provider")
		return
	}
	var req dnsProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateDNSProvider(w, &req) {
		return
	}
	if req.Name != p.Name {
		if existing, err := s.store.GetDNSProviderByName(r.Context(), req.Name); err == nil && existing != nil {
			s.err(w, http.StatusConflict, "a provider with this name already exists")
			return
		}
	}
	p.Name = req.Name
	p.Type = req.Type
	p.AccountID = req.AccountID
	p.BaseURL = req.BaseURL
	if strings.TrimSpace(req.Token) != "" { // blank means "keep existing"
		p.Token = strings.TrimSpace(req.Token)
	}
	provider, err := dnsfactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := provider.Verify(r.Context()); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.UpdateDNSProvider(r.Context(), p); err != nil {
		s.fail(w, err, "updating provider")
		return
	}
	s.dnsRegistry.Set(p.ID, provider)
	s.json(w, http.StatusOK, s.probeDNSProvider(r.Context(), *p))
}

func (s *Server) deleteDNSProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteDNSProvider(r.Context(), id); err != nil {
		s.fail(w, err, "deleting provider")
		return
	}
	s.dnsRegistry.Remove(id)
	w.WriteHeader(http.StatusNoContent)
}

// dnsProvider resolves the ?provider= query param to a live provider.
func (s *Server) dnsProvider(w http.ResponseWriter, r *http.Request) dns.Provider {
	id := r.URL.Query().Get("provider")
	if id == "" {
		s.err(w, http.StatusBadRequest, "provider query parameter is required")
		return nil
	}
	provider, ok := s.dnsRegistry.Get(id)
	if !ok {
		s.err(w, http.StatusNotFound, "provider: not found")
		return nil
	}
	return provider
}

func (s *Server) listDNSAccounts(w http.ResponseWriter, r *http.Request) {
	provider := s.dnsProvider(w, r)
	if provider == nil {
		return
	}
	accounts, err := provider.Accounts(r.Context())
	if err != nil {
		s.fail(w, err, "dns accounts")
		return
	}
	if accounts == nil {
		accounts = []dns.Account{}
	}
	s.json(w, http.StatusOK, accounts)
}

// listDNSZones spans every configured provider, stamping each zone with
// the provider it came from — the same pattern as catalog listings.
func (s *Server) listDNSZones(w http.ResponseWriter, r *http.Request) {
	providers, err := s.store.ListDNSProviders(r.Context())
	if err != nil {
		s.fail(w, err, "dns providers")
		return
	}
	if only := r.URL.Query().Get("provider"); only != "" {
		providers = slices.DeleteFunc(providers, func(p store.DNSProvider) bool { return p.ID != only })
	}
	zones := []dns.Zone{}
	for _, p := range providers {
		provider, ok := s.dnsRegistry.Get(p.ID)
		if !ok {
			continue
		}
		found, err := provider.Zones(r.Context())
		if err != nil {
			// One unreachable provider shouldn't blank out the others.
			s.log.Warn("listing dns zones", "provider", p.Name, "error", err)
			continue
		}
		for i := range found {
			found[i].ProviderID = p.ID
		}
		zones = append(zones, found...)
	}
	slices.SortFunc(zones, func(a, b dns.Zone) int { return strings.Compare(a.Name, b.Name) })
	s.json(w, http.StatusOK, zones)
}

// getDNSZone reads one zone live from its provider, so the detail view
// doesn't depend on the list's refresh interval.
func (s *Server) getDNSZone(w http.ResponseWriter, r *http.Request) {
	provider := s.dnsProvider(w, r)
	if provider == nil {
		return
	}
	zone, err := provider.Zone(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "zone")
		return
	}
	zone.ProviderID = r.URL.Query().Get("provider")
	s.json(w, http.StatusOK, zone)
}

// listDNSRecords returns a zone's records sorted by name then type, so
// the record-set grouping in the UI is stable across refreshes.
func (s *Server) listDNSRecords(w http.ResponseWriter, r *http.Request) {
	provider := s.dnsProvider(w, r)
	if provider == nil {
		return
	}
	records, err := provider.Records(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "dns records")
		return
	}
	slices.SortFunc(records, func(a, b dns.Record) int {
		if c := strings.Compare(a.Name, b.Name); c != 0 {
			return c
		}
		if c := strings.Compare(a.Type, b.Type); c != 0 {
			return c
		}
		return strings.Compare(a.Content, b.Content)
	})
	s.json(w, http.StatusOK, records)
}

// Record sets are this app's unit of editing: every record sharing a
// name and type, saved together the way Cloud DNS presents them.
// Providers address records one at a time, so saving a set is a diff
// against what's there — pair values up, update those, then create or
// delete the difference.

// editableRecordTypes are the types whose value is a plain string at
// the provider. CAA, SRV and friends carry structured data, so they
// list and delete fine but are left to the provider's own UI to edit
// rather than silently mangled here.
// PTR belongs here for the same reason CNAME does — its value is one
// hostname — and a reverse zone is nothing but PTR records, so without
// it those zones list and never edit.
var editableRecordTypes = []string{"A", "AAAA", "CNAME", "MX", "NS", "PTR", "TXT"}

type recordValue struct {
	Content  string `json:"content"`
	Priority int    `json:"priority"`
}

type recordSetRequest struct {
	Name    string        `json:"name"`
	Type    string        `json:"type"`
	TTL     int           `json:"ttl"`
	Proxied bool          `json:"proxied"`
	Comment string        `json:"comment"`
	Values  []recordValue `json:"values"`
}

// recordSetName normalises a name and checks it belongs to the zone.
func recordSetName(name, zone string) (string, error) {
	name = strings.ToLower(strings.TrimSpace(name))
	name = strings.TrimSuffix(name, ".")
	if name == "" || name == "@" {
		return zone, nil
	}
	if name != zone && !strings.HasSuffix(name, "."+zone) {
		return "", fmt.Errorf("%q is outside the %s zone", name, zone)
	}
	if !domainRe.MatchString(name) {
		return "", fmt.Errorf("%q is not a valid DNS name", name)
	}
	return name, nil
}

// setRecords picks the records belonging to one set, in a stable order
// so pairing old values with new ones is repeatable.
func setRecords(records []dns.Record, name, recordType string) []dns.Record {
	var set []dns.Record
	for _, record := range records {
		if strings.EqualFold(record.Name, name) && record.Type == recordType {
			set = append(set, record)
		}
	}
	slices.SortFunc(set, func(a, b dns.Record) int { return strings.Compare(a.ID, b.ID) })
	return set
}

func (s *Server) saveDNSRecordSet(w http.ResponseWriter, r *http.Request) {
	provider := s.dnsProvider(w, r)
	if provider == nil {
		return
	}
	zoneID := chi.URLParam(r, "id")
	var req recordSetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	req.Type = strings.ToUpper(strings.TrimSpace(req.Type))
	if !slices.Contains(editableRecordTypes, req.Type) {
		s.err(w, http.StatusBadRequest, fmt.Sprintf("%s records can't be edited here", req.Type))
		return
	}
	if len(req.Values) == 0 {
		s.err(w, http.StatusBadRequest, "a record set needs at least one value")
		return
	}
	if req.Type == "CNAME" && len(req.Values) > 1 {
		s.err(w, http.StatusBadRequest, "a CNAME record set holds exactly one value")
		return
	}
	for _, value := range req.Values {
		if strings.TrimSpace(value.Content) == "" {
			s.err(w, http.StatusBadRequest, "every value needs content")
			return
		}
	}

	zone, err := provider.Zone(r.Context(), zoneID)
	if err != nil {
		s.fail(w, err, "zone")
		return
	}
	name, err := recordSetName(req.Name, zone.Name)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}

	existing, err := provider.Records(r.Context(), zoneID)
	if err != nil {
		s.fail(w, err, "dns records")
		return
	}
	// A name is either a CNAME or everything else — never both.
	for _, record := range existing {
		if !strings.EqualFold(record.Name, name) || record.Type == req.Type {
			continue
		}
		if record.Type == "CNAME" || req.Type == "CNAME" {
			s.err(w, http.StatusConflict,
				"a name may have either one CNAME record set or record sets of other types, but not both")
			return
		}
	}

	// A provider whose own unit is the SET writes it in one go. That is
	// not just fewer requests: the record-by-record path below reaches
	// the end state through a sequence, and a provider that validates
	// each step can refuse a legal edit for a state it only passes
	// through — see dns.RecordSetWriter.
	if writer, ok := provider.(dns.RecordSetWriter); ok {
		values := make([]dns.RecordSetValue, 0, len(req.Values))
		for _, value := range req.Values {
			values = append(values, dns.RecordSetValue{
				Content:  strings.TrimSpace(value.Content),
				Priority: value.Priority,
			})
		}
		saved, err := writer.SaveRecordSet(r.Context(), zoneID, dns.RecordSetSpec{
			Name:   name,
			Type:   req.Type,
			TTL:    req.TTL,
			Values: values,
		})
		if err != nil {
			s.fail(w, err, "saving record set")
			return
		}
		s.json(w, http.StatusOK, saved)
		return
	}

	current := setRecords(existing, name, req.Type)
	saved := []dns.Record{}
	for i, value := range req.Values {
		spec := dns.RecordSpec{
			Name:     name,
			Type:     req.Type,
			Content:  strings.TrimSpace(value.Content),
			TTL:      req.TTL,
			Priority: value.Priority,
			Proxied:  req.Proxied,
			Comment:  req.Comment,
		}
		var record *dns.Record
		if i < len(current) {
			record, err = provider.UpdateRecord(r.Context(), zoneID, current[i].ID, spec)
		} else {
			record, err = provider.CreateRecord(r.Context(), zoneID, spec)
		}
		if err != nil {
			s.fail(w, err, "saving record")
			return
		}
		saved = append(saved, *record)
	}
	// Values removed from the set are records the provider still holds.
	for _, record := range current[min(len(req.Values), len(current)):] {
		if err := provider.DeleteRecord(r.Context(), zoneID, record.ID); err != nil {
			s.fail(w, err, "removing record")
			return
		}
	}
	s.json(w, http.StatusOK, saved)
}

// deleteDNSRecordSet removes every record in the set named by the
// ?name= and ?type= query parameters.
func (s *Server) deleteDNSRecordSet(w http.ResponseWriter, r *http.Request) {
	provider := s.dnsProvider(w, r)
	if provider == nil {
		return
	}
	zoneID := chi.URLParam(r, "id")
	name := strings.TrimSuffix(strings.ToLower(r.URL.Query().Get("name")), ".")
	recordType := strings.ToUpper(r.URL.Query().Get("type"))
	if name == "" || recordType == "" {
		s.err(w, http.StatusBadRequest, "name and type query parameters are required")
		return
	}
	records, err := provider.Records(r.Context(), zoneID)
	if err != nil {
		s.fail(w, err, "dns records")
		return
	}
	set := setRecords(records, name, recordType)
	if len(set) == 0 {
		s.err(w, http.StatusNotFound, "record set: not found")
		return
	}
	for _, record := range set {
		if err := provider.DeleteRecord(r.Context(), zoneID, record.ID); err != nil {
			s.fail(w, err, "deleting record")
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) createDNSZone(w http.ResponseWriter, r *http.Request) {
	provider := s.dnsProvider(w, r)
	if provider == nil {
		return
	}
	var req struct {
		Name      string `json:"name"`
		AccountID string `json:"accountId"`
		Type      string `json:"type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	name := strings.ToLower(strings.TrimSpace(req.Name))
	name = strings.TrimSuffix(name, ".")
	if !domainRe.MatchString(name) {
		s.err(w, http.StatusBadRequest, "name must be a domain like example.com")
		return
	}
	if req.Type != "" && req.Type != "full" && req.Type != "partial" {
		s.err(w, http.StatusBadRequest, "type must be full or partial")
		return
	}
	zone, err := provider.CreateZone(r.Context(), dns.ZoneSpec{
		Name:      name,
		AccountID: req.AccountID,
		Type:      req.Type,
	})
	if err != nil {
		s.fail(w, err, "creating zone")
		return
	}
	zone.ProviderID = r.URL.Query().Get("provider")
	s.json(w, http.StatusCreated, zone)
}

func (s *Server) deleteDNSZone(w http.ResponseWriter, r *http.Request) {
	provider := s.dnsProvider(w, r)
	if provider == nil {
		return
	}
	if err := provider.DeleteZone(r.Context(), chi.URLParam(r, "id")); err != nil {
		s.fail(w, err, "deleting zone")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
