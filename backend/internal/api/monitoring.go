package api

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/monitoring"
	monitoringfactory "vantric/internal/monitoring/factory"
	"vantric/internal/store"
)

// The Monitoring section: what the monitoring service says is on fire,
// and the join between its hosts and this console's guests.
//
// Endpoints default to the single configured service when ?provider=
// is absent — a lab has one monitoring service, the same rule the
// identity and AI sections follow.

func (s *Server) monitoringRoutes(r chi.Router) {
	r.Get("/monitoring/provider-types", func(w http.ResponseWriter, r *http.Request) {
		s.json(w, http.StatusOK, monitoringfactory.Types)
	})
	r.Get("/monitoring/providers", s.listMonitoringProviders)
	r.Post("/monitoring/providers", s.createMonitoringProvider)
	r.Put("/monitoring/providers/{id}", s.updateMonitoringProvider)
	r.Delete("/monitoring/providers/{id}", s.deleteMonitoringProvider)
	r.Get("/monitoring/problems", s.listMonitoringProblems)
	r.Get("/monitoring/hosts", s.listMonitoringHosts)
}

type monitoringProviderView struct {
	store.MonitoringProvider
	HasToken bool             `json:"hasToken"`
	Status   string           `json:"status"` // connected | unreachable | unknown
	Info     *monitoring.Info `json:"info,omitempty"`
	Error    string           `json:"error,omitempty"`
}

func (s *Server) probeMonitoringProvider(ctx context.Context, p store.MonitoringProvider) monitoringProviderView {
	view := monitoringProviderView{MonitoringProvider: p, HasToken: p.Token != "", Status: "unknown"}
	provider, ok := s.monitoringRegistry.Get(p.ID)
	if !ok {
		view.Error = "no provider loaded"
		return view
	}
	info, err := provider.Check(ctx)
	if err != nil {
		view.Status = "unreachable"
		view.Error = err.Error()
		return view
	}
	view.Status = "connected"
	view.Info = info
	return view
}

func (s *Server) listMonitoringProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := s.store.ListMonitoringProviders(r.Context())
	if err != nil {
		s.fail(w, err, "monitoring services")
		return
	}
	views := make([]monitoringProviderView, len(providers))
	var wg sync.WaitGroup
	for i := range providers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			views[i] = s.probeMonitoringProvider(r.Context(), providers[i])
		}(i)
	}
	wg.Wait()
	s.json(w, http.StatusOK, views)
}

type monitoringProviderRequest struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	BaseURL     string `json:"baseUrl"`
	Token       string `json:"token"`
	InsecureTLS bool   `json:"insecureTls"`
}

func (s *Server) validateMonitoringProvider(w http.ResponseWriter, req *monitoringProviderRequest) bool {
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return false
	}
	if !slices.Contains(monitoringfactory.Types, req.Type) {
		s.err(w, http.StatusBadRequest, "unsupported monitoring service type")
		return false
	}
	if !strings.HasPrefix(req.BaseURL, "http://") && !strings.HasPrefix(req.BaseURL, "https://") {
		s.err(w, http.StatusBadRequest, "base URL must start with http:// or https://")
		return false
	}
	return true
}

func (s *Server) createMonitoringProvider(w http.ResponseWriter, r *http.Request) {
	var req monitoringProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateMonitoringProvider(w, &req) {
		return
	}
	if strings.TrimSpace(req.Token) == "" {
		s.err(w, http.StatusBadRequest, "an API token is required")
		return
	}
	p := &store.MonitoringProvider{
		ID:          uuid.NewString(),
		Name:        req.Name,
		Type:        req.Type,
		BaseURL:     strings.TrimRight(strings.TrimSpace(req.BaseURL), "/"),
		Token:       strings.TrimSpace(req.Token),
		InsecureTLS: req.InsecureTLS,
	}
	provider, err := monitoringfactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := provider.Check(r.Context()); err != nil {
		s.log.Warn("monitoring service rejected", "name", p.Name, "type", p.Type, "error", err)
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.CreateMonitoringProvider(r.Context(), p); err != nil {
		s.fail(w, err, "creating the service")
		return
	}
	s.monitoringRegistry.Set(p.ID, provider)
	s.json(w, http.StatusCreated, s.probeMonitoringProvider(r.Context(), *p))
}

func (s *Server) updateMonitoringProvider(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetMonitoringProvider(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "service")
		return
	}
	var req monitoringProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateMonitoringProvider(w, &req) {
		return
	}
	p.Name = req.Name
	p.Type = req.Type
	p.BaseURL = strings.TrimRight(strings.TrimSpace(req.BaseURL), "/")
	p.InsecureTLS = req.InsecureTLS
	// Blank keeps what's stored, the rule every credential form follows.
	if token := strings.TrimSpace(req.Token); token != "" {
		p.Token = token
	}
	provider, err := monitoringfactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := provider.Check(r.Context()); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.UpdateMonitoringProvider(r.Context(), p); err != nil {
		s.fail(w, err, "updating the service")
		return
	}
	s.monitoringRegistry.Set(p.ID, provider)
	s.json(w, http.StatusOK, s.probeMonitoringProvider(r.Context(), *p))
}

func (s *Server) deleteMonitoringProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteMonitoringProvider(r.Context(), id); err != nil {
		s.fail(w, err, "deleting the service")
		return
	}
	s.monitoringRegistry.Remove(id)
	w.WriteHeader(http.StatusNoContent)
}

// monitoringProvider resolves ?provider=, or the only one configured.
func (s *Server) monitoringProvider(w http.ResponseWriter, r *http.Request) monitoring.Provider {
	if id := r.URL.Query().Get("provider"); id != "" {
		provider, ok := s.monitoringRegistry.Get(id)
		if !ok {
			s.err(w, http.StatusNotFound, "no such monitoring service")
			return nil
		}
		return provider
	}
	providers, err := s.store.ListMonitoringProviders(r.Context())
	if err != nil {
		s.fail(w, err, "monitoring services")
		return nil
	}
	switch len(providers) {
	case 0:
		s.err(w, http.StatusNotFound, "no monitoring service is connected")
		return nil
	case 1:
		provider, ok := s.monitoringRegistry.Get(providers[0].ID)
		if !ok {
			s.err(w, http.StatusConflict, "the monitoring service's credentials didn't load")
			return nil
		}
		return provider
	default:
		s.err(w, http.StatusBadRequest, "several services are connected — name one with ?provider=")
		return nil
	}
}

func (s *Server) listMonitoringProblems(w http.ResponseWriter, r *http.Request) {
	provider := s.monitoringProvider(w, r)
	if provider == nil {
		return
	}
	problems, err := provider.Problems(r.Context())
	if err != nil {
		s.fail(w, err, "monitoring problems")
		return
	}
	s.json(w, http.StatusOK, problems)
}

// monitoredHost is a host the service watches, stamped with the
// instance this console runs at the same address — the correlation
// neither tool can see alone. The join is INTERFACE IP, not hostname:
// a monitoring agent doesn't report SMBIOS, and the address is what
// both sides hold fresh. Weaker than the Devices UUID join, and the
// page says so.
type monitoredHost struct {
	monitoring.Host
	Instance string `json:"instance,omitempty"`
}

type monitoringHostsResponse struct {
	Hosts []monitoredHost `json:"hosts"`
	// Unmonitored are running instances no watched host answers for —
	// the finding, same as Devices' unenrolled list.
	Unmonitored []string `json:"unmonitored"`
}

func (s *Server) listMonitoringHosts(w http.ResponseWriter, r *http.Request) {
	provider := s.monitoringProvider(w, r)
	if provider == nil {
		return
	}
	hosts, err := provider.Hosts(r.Context())
	if err != nil {
		s.fail(w, err, "monitoring hosts")
		return
	}
	instances, err := s.store.ListInstances(r.Context())
	if err != nil {
		s.fail(w, err, "instances")
		return
	}
	byAddr := map[string]string{}
	for _, inst := range instances {
		if inst.InternalIP != "" {
			byAddr[inst.InternalIP] = inst.Name
		}
	}
	matched := map[string]bool{}
	out := monitoringHostsResponse{Hosts: make([]monitoredHost, 0, len(hosts)), Unmonitored: []string{}}
	for _, h := range hosts {
		mh := monitoredHost{Host: h}
		for _, addr := range h.Addresses {
			if name, ok := byAddr[addr]; ok {
				mh.Instance = name
				matched[name] = true
				break
			}
		}
		out.Hosts = append(out.Hosts, mh)
	}
	// Only RUNNING guests count as unmonitored: a stopped VM having no
	// monitoring is the expected state, not a finding.
	for _, inst := range instances {
		if inst.Status == "RUNNING" && !matched[inst.Name] {
			out.Unmonitored = append(out.Unmonitored, inst.Name)
		}
	}
	s.json(w, http.StatusOK, out)
}
