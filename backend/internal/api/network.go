package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/network"
	networkfactory "vantric/internal/network/factory"
	"vantric/internal/store"
)

// Network controllers are the same shape as every other backend here:
// a DB record holding credentials, one live provider per record in a
// registry, verified before it's stored. Read-only for now — this
// console reports what the controller says, it doesn't reconfigure
// your network.

func (s *Server) networkRoutes(r chi.Router) {
	r.Get("/network/provider-types", func(w http.ResponseWriter, r *http.Request) {
		s.json(w, http.StatusOK, networkfactory.Types)
	})
	r.Get("/network/providers", s.listNetworkProviders)
	r.Post("/network/providers", s.createNetworkProvider)
	r.Put("/network/providers/{id}", s.updateNetworkProvider)
	r.Delete("/network/providers/{id}", s.deleteNetworkProvider)
	r.Get("/network/sites", s.listNetworkSites)
	r.Get("/network/networks", s.listNetworkNetworks)
	r.Get("/network/wifi", s.listNetworkWiFi)
	r.Get("/network/clients", s.listNetworkClients)
	r.Get("/network/devices", s.listNetworkDevices)
}

type networkProviderView struct {
	store.NetworkProvider
	HasCredentials bool          `json:"hasCredentials"`
	Status         string        `json:"status"`
	Info           *network.Info `json:"info,omitempty"`
	Error          string        `json:"error,omitempty"`
}

func (s *Server) probeNetworkProvider(ctx context.Context, p store.NetworkProvider) networkProviderView {
	view := networkProviderView{
		NetworkProvider: p,
		HasCredentials:  p.APIKey != "" || p.Password != "",
		Status:          "unknown",
	}
	provider, ok := s.networkRegistry.Get(p.ID)
	if !ok {
		view.Error = "no provider loaded"
		return view
	}
	info, err := provider.Info(ctx)
	if err != nil {
		view.Status = "unreachable"
		view.Error = err.Error()
		return view
	}
	view.Status = "connected"
	view.Info = info
	return view
}

func (s *Server) listNetworkProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := s.store.ListNetworkProviders(r.Context())
	if err != nil {
		s.fail(w, err, "network providers")
		return
	}
	views := make([]networkProviderView, len(providers))
	var wg sync.WaitGroup
	for i := range providers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			views[i] = s.probeNetworkProvider(r.Context(), providers[i])
		}(i)
	}
	wg.Wait()
	s.json(w, http.StatusOK, views)
}

type networkProviderRequest struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	BaseURL     string `json:"baseUrl"`
	Site        string `json:"site"`
	APIKey      string `json:"apiKey"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	InsecureTLS bool   `json:"insecureTls"`
}

func (s *Server) validateNetworkProvider(w http.ResponseWriter, req *networkProviderRequest) bool {
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return false
	}
	if !slices.Contains(networkfactory.Types, req.Type) {
		s.err(w, http.StatusBadRequest, "unsupported controller type")
		return false
	}
	if !strings.HasPrefix(req.BaseURL, "http://") && !strings.HasPrefix(req.BaseURL, "https://") {
		s.err(w, http.StatusBadRequest, "controller URL must start with http:// or https://")
		return false
	}
	return true
}

func (s *Server) createNetworkProvider(w http.ResponseWriter, r *http.Request) {
	var req networkProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateNetworkProvider(w, &req) {
		return
	}
	// One or the other: a key where the controller offers them, a local
	// account where it doesn't.
	if strings.TrimSpace(req.APIKey) == "" && strings.TrimSpace(req.Username) == "" {
		s.err(w, http.StatusBadRequest, "an API key, or a username and password, is required")
		return
	}
	if existing, err := s.store.GetNetworkProviderByName(r.Context(), req.Name); err == nil && existing != nil {
		s.err(w, http.StatusConflict, "a controller with this name already exists")
		return
	}
	p := &store.NetworkProvider{
		ID:          uuid.NewString(),
		Name:        req.Name,
		Type:        req.Type,
		BaseURL:     strings.TrimRight(strings.TrimSpace(req.BaseURL), "/"),
		Site:        strings.TrimSpace(req.Site),
		APIKey:      strings.TrimSpace(req.APIKey),
		Username:    strings.TrimSpace(req.Username),
		Password:    req.Password,
		InsecureTLS: req.InsecureTLS,
	}
	provider, err := networkfactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := provider.Verify(r.Context()); err != nil {
		s.log.Warn("network controller rejected", "name", p.Name, "type", p.Type, "error", err)
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.CreateNetworkProvider(r.Context(), p); err != nil {
		s.fail(w, err, "creating controller")
		return
	}
	s.networkRegistry.Set(p.ID, provider)
	s.json(w, http.StatusCreated, s.probeNetworkProvider(r.Context(), *p))
}

func (s *Server) updateNetworkProvider(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetNetworkProvider(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "controller")
		return
	}
	var req networkProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateNetworkProvider(w, &req) {
		return
	}
	if req.Name != p.Name {
		if existing, err := s.store.GetNetworkProviderByName(r.Context(), req.Name); err == nil && existing != nil {
			s.err(w, http.StatusConflict, "a controller with this name already exists")
			return
		}
	}
	p.Name = req.Name
	p.Type = req.Type
	p.BaseURL = strings.TrimRight(strings.TrimSpace(req.BaseURL), "/")
	p.Username = strings.TrimSpace(req.Username)
	p.InsecureTLS = req.InsecureTLS
	p.Site = strings.TrimSpace(req.Site)
	if key := strings.TrimSpace(req.APIKey); key != "" { // blank means "keep existing"
		p.APIKey = key
	}
	if req.Password != "" {
		p.Password = req.Password
	}
	provider, err := networkfactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := provider.Verify(r.Context()); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.UpdateNetworkProvider(r.Context(), p); err != nil {
		s.fail(w, err, "updating controller")
		return
	}
	s.networkRegistry.Set(p.ID, provider)
	s.json(w, http.StatusOK, s.probeNetworkProvider(r.Context(), *p))
}

func (s *Server) deleteNetworkProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteNetworkProvider(r.Context(), id); err != nil {
		s.fail(w, err, "deleting controller")
		return
	}
	s.networkRegistry.Remove(id)
	w.WriteHeader(http.StatusNoContent)
}

// networkProvider resolves ?provider=, defaulting to the only
// configured controller — a lab has one, and making every page pass an
// id it can't get wrong is noise.
func (s *Server) networkProvider(w http.ResponseWriter, r *http.Request) network.Provider {
	if id := r.URL.Query().Get("provider"); id != "" {
		provider, ok := s.networkRegistry.Get(id)
		if !ok {
			s.err(w, http.StatusNotFound, "controller: not found")
			return nil
		}
		return provider
	}
	records, err := s.store.ListNetworkProviders(r.Context())
	if err != nil {
		s.fail(w, err, "network providers")
		return nil
	}
	if len(records) == 0 {
		s.err(w, http.StatusNotFound, "no network controller is configured")
		return nil
	}
	provider, ok := s.networkRegistry.Get(records[0].ID)
	if !ok {
		s.err(w, http.StatusNotFound, "controller: not loaded")
		return nil
	}
	return provider
}

func (s *Server) listNetworkSites(w http.ResponseWriter, r *http.Request) {
	provider := s.networkProvider(w, r)
	if provider == nil {
		return
	}
	sites, err := provider.Sites(r.Context())
	if err != nil {
		s.fail(w, err, "sites")
		return
	}
	slices.SortFunc(sites, func(a, b network.Site) int { return strings.Compare(a.Name, b.Name) })
	s.json(w, http.StatusOK, sites)
}

func (s *Server) listNetworkNetworks(w http.ResponseWriter, r *http.Request) {
	provider := s.networkProvider(w, r)
	if provider == nil {
		return
	}
	networks, err := provider.Networks(r.Context(), r.URL.Query().Get("site"))
	if err != nil {
		s.fail(w, err, "networks")
		return
	}
	if category := r.URL.Query().Get("category"); category != "" {
		networks = slices.DeleteFunc(networks, func(n network.Network) bool {
			return n.Category != category
		})
	}
	slices.SortFunc(networks, func(a, b network.Network) int {
		if a.Site != b.Site {
			return strings.Compare(a.Site, b.Site)
		}
		if a.VLAN != b.VLAN {
			return a.VLAN - b.VLAN
		}
		return strings.Compare(a.Name, b.Name)
	})
	s.json(w, http.StatusOK, networks)
}

// listNetworkWiFi lists SSIDs across every site.
func (s *Server) listNetworkWiFi(w http.ResponseWriter, r *http.Request) {
	provider := s.networkProvider(w, r)
	if provider == nil {
		return
	}
	wifi, err := provider.WiFi(r.Context(), r.URL.Query().Get("site"))
	if err != nil {
		s.fail(w, err, "wifi")
		return
	}
	slices.SortFunc(wifi, func(a, b network.WiFi) int {
		if a.Site != b.Site {
			return strings.Compare(a.Site, b.Site)
		}
		return strings.Compare(a.Name, b.Name)
	})
	s.json(w, http.StatusOK, wifi)
}

func (s *Server) listNetworkClients(w http.ResponseWriter, r *http.Request) {
	provider := s.networkProvider(w, r)
	if provider == nil {
		return
	}
	clients, err := provider.Clients(r.Context(), r.URL.Query().Get("site"))
	if err != nil {
		s.fail(w, err, "clients")
		return
	}
	// By address, since the question this list answers is usually
	// "what holds 192.168.80.something".
	slices.SortFunc(clients, func(a, b network.Client) int {
		if a.Site != b.Site {
			return strings.Compare(a.Site, b.Site)
		}
		return compareIPs(a.IP, b.IP)
	})
	s.json(w, http.StatusOK, clients)
}

// compareIPs orders dotted quads numerically, so .9 comes before .10.
// Anything unparseable sorts last rather than scrambling the list.
func compareIPs(a, b string) int {
	av, aok := ipKey(a)
	bv, bok := ipKey(b)
	switch {
	case aok && bok:
		if av != bv {
			if av < bv {
				return -1
			}
			return 1
		}
		return 0
	case aok:
		return -1
	case bok:
		return 1
	default:
		return strings.Compare(a, b)
	}
}

func ipKey(ip string) (uint32, bool) {
	parts := strings.Split(ip, ".")
	if len(parts) != 4 {
		return 0, false
	}
	var key uint32
	for _, part := range parts {
		var octet uint32
		if _, err := fmt.Sscanf(part, "%d", &octet); err != nil || octet > 255 {
			return 0, false
		}
		key = key<<8 | octet
	}
	return key, true
}

func (s *Server) listNetworkDevices(w http.ResponseWriter, r *http.Request) {
	provider := s.networkProvider(w, r)
	if provider == nil {
		return
	}
	devices, err := provider.Devices(r.Context(), r.URL.Query().Get("site"))
	if err != nil {
		s.fail(w, err, "devices")
		return
	}
	slices.SortFunc(devices, func(a, b network.Device) int {
		if a.Site != b.Site {
			return strings.Compare(a.Site, b.Site)
		}
		if a.Kind != b.Kind {
			return strings.Compare(a.Kind, b.Kind)
		}
		return strings.Compare(a.Name, b.Name)
	})
	s.json(w, http.StatusOK, devices)
}
