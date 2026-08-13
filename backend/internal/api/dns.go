package api

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"lab-cloud-manager/internal/dns"
	dnsfactory "lab-cloud-manager/internal/dns/factory"
	"lab-cloud-manager/internal/store"
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
	}
	provider, err := dnsfactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	// Reject credentials that don't work rather than storing a provider
	// that can never connect.
	if err := provider.Verify(r.Context()); err != nil {
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
