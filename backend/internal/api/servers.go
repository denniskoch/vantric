package api

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/hypervisor/factory"
	"vantric/internal/store"
)

// serverView is the API shape of a server: everything but the secret,
// plus live connection state from a quick probe.
type serverView struct {
	store.Server
	HasSecret bool   `json:"hasSecret"`
	Status    string `json:"status"` // connected | unreachable | unknown
	Nodes     int    `json:"nodes"`
	Error     string `json:"error,omitempty"`
}

func (s *Server) listServers(w http.ResponseWriter, r *http.Request) {
	servers, err := s.store.ListServers(r.Context())
	if err != nil {
		s.fail(w, err, "servers")
		return
	}
	views := make([]serverView, len(servers))
	var wg sync.WaitGroup
	for i := range servers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			views[i] = s.probeServer(r.Context(), servers[i])
		}(i)
	}
	wg.Wait()
	s.json(w, http.StatusOK, views)
}

// probeServer asks the driver for its zones with a short timeout to
// report connectivity and node count.
func (s *Server) probeServer(ctx context.Context, sv store.Server) serverView {
	view := serverView{Server: sv, HasSecret: sv.Secret != "", Status: "unknown"}
	driver, ok := s.registry.Get(sv.ID)
	if !ok {
		view.Error = "no driver loaded"
		return view
	}
	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	zones, err := driver.Zones(probeCtx)
	if err != nil {
		view.Status = "unreachable"
		view.Error = err.Error()
		return view
	}
	view.Status = "connected"
	view.Nodes = len(zones)
	return view
}

type serverRequest struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	BaseURL     string `json:"baseUrl"`
	TokenID     string `json:"tokenId"`
	Secret      string `json:"secret"`
	InsecureTLS bool   `json:"insecureTls"`
}

func (s *Server) validateServerRequest(w http.ResponseWriter, req *serverRequest) bool {
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return false
	}
	if !slices.Contains(factory.Types, req.Type) {
		s.err(w, http.StatusBadRequest, "unsupported hypervisor type")
		return false
	}
	if req.Type == "proxmox" && req.BaseURL == "" {
		s.err(w, http.StatusBadRequest, "baseUrl is required for Proxmox servers")
		return false
	}
	return true
}

func (s *Server) createServer(w http.ResponseWriter, r *http.Request) {
	var req serverRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateServerRequest(w, &req) {
		return
	}
	if req.Type == "proxmox" && (req.TokenID == "" || req.Secret == "") {
		s.err(w, http.StatusBadRequest, "tokenId and secret are required for Proxmox servers")
		return
	}
	if existing, err := s.store.GetServerByName(r.Context(), req.Name); err == nil && existing != nil {
		s.err(w, http.StatusConflict, "a server with this name already exists")
		return
	}
	sv := &store.Server{
		ID:          uuid.NewString(),
		Name:        req.Name,
		Type:        req.Type,
		BaseURL:     req.BaseURL,
		TokenID:     req.TokenID,
		Secret:      req.Secret,
		InsecureTLS: req.InsecureTLS,
	}
	driver, err := factory.Build(sv)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.CreateServer(r.Context(), sv); err != nil {
		s.fail(w, err, "creating server")
		return
	}
	s.registry.Set(sv.ID, driver)
	s.json(w, http.StatusCreated, s.probeServer(r.Context(), *sv))
}

func (s *Server) updateServer(w http.ResponseWriter, r *http.Request) {
	sv, err := s.store.GetServer(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "server")
		return
	}
	var req serverRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateServerRequest(w, &req) {
		return
	}
	if req.Name != sv.Name {
		if existing, err := s.store.GetServerByName(r.Context(), req.Name); err == nil && existing != nil {
			s.err(w, http.StatusConflict, "a server with this name already exists")
			return
		}
	}
	sv.Name = req.Name
	sv.Type = req.Type
	sv.BaseURL = req.BaseURL
	sv.TokenID = req.TokenID
	sv.InsecureTLS = req.InsecureTLS
	if req.Secret != "" { // blank means "keep existing secret"
		sv.Secret = req.Secret
	}
	driver, err := factory.Build(sv)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.UpdateServer(r.Context(), sv); err != nil {
		s.fail(w, err, "updating server")
		return
	}
	s.registry.Set(sv.ID, driver)
	s.json(w, http.StatusOK, s.probeServer(r.Context(), *sv))
}

func (s *Server) deleteServer(w http.ResponseWriter, r *http.Request) {
	// Removing a hypervisor takes its guest records with it. That is a
	// disconnect, not a deletion: the VMs and containers themselves are
	// untouched and come back if the server is re-added. Requiring them
	// to be destroyed first would make forgetting a credential the most
	// dangerous button in the app.
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteServer(r.Context(), id); err != nil {
		s.fail(w, err, "deleting server")
		return
	}
	s.registry.Remove(id)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listServerTypes(w http.ResponseWriter, r *http.Request) {
	s.json(w, http.StatusOK, factory.Types)
}
