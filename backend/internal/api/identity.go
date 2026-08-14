package api

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"lab-cloud-manager/internal/identity"
	identityfactory "lab-cloud-manager/internal/identity/factory"
	"lab-cloud-manager/internal/store"
)

// Identity providers are the lab's own identity service (authentik).
// Same shape as hypervisors, DNS providers and database servers: a DB
// record holding credentials, one live provider per record in a
// registry. The directory itself stays where it is — this reads it and
// performs the everyday actions.

func (s *Server) identityRoutes(r chi.Router) {
	r.Get("/identity/provider-types", func(w http.ResponseWriter, r *http.Request) {
		s.json(w, http.StatusOK, identityfactory.Types)
	})
	r.Get("/identity/providers", s.listIdentityProviders)
	r.Post("/identity/providers", s.createIdentityProvider)
	r.Put("/identity/providers/{id}", s.updateIdentityProvider)
	r.Delete("/identity/providers/{id}", s.deleteIdentityProvider)
	r.Get("/identity/users", s.listIdentityUsers)
	r.Post("/identity/users", s.createIdentityUser)
	r.Post("/identity/users/{userId}/recovery", s.identityUserRecoveryLink)
	r.Post("/identity/users/{userId}/active", s.setIdentityUserActive)
	r.Post("/identity/users/{userId}/password", s.setIdentityUserPassword)
	r.Get("/identity/groups", s.listIdentityGroups)
	r.Post("/identity/groups/{groupId}/members", s.addIdentityGroupMember)
	r.Delete("/identity/groups/{groupId}/members/{userId}", s.removeIdentityGroupMember)
	r.Get("/identity/applications", s.listIdentityApplications)
	r.Get("/identity/events", s.listIdentityEvents)
}

// identityProviderView is the API shape: everything but the token,
// plus a live connection check.
type identityProviderView struct {
	store.IdentityProvider
	HasToken bool           `json:"hasToken"`
	Status   string         `json:"status"` // connected | unreachable | unknown
	Info     *identity.Info `json:"info,omitempty"`
	Error    string         `json:"error,omitempty"`
}

func (s *Server) probeIdentityProvider(ctx context.Context, p store.IdentityProvider) identityProviderView {
	view := identityProviderView{IdentityProvider: p, HasToken: p.Token != "", Status: "unknown"}
	provider, ok := s.identityRegistry.Get(p.ID)
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

func (s *Server) listIdentityProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := s.store.ListIdentityProviders(r.Context())
	if err != nil {
		s.fail(w, err, "identity providers")
		return
	}
	views := make([]identityProviderView, len(providers))
	var wg sync.WaitGroup
	for i := range providers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			views[i] = s.probeIdentityProvider(r.Context(), providers[i])
		}(i)
	}
	wg.Wait()
	s.json(w, http.StatusOK, views)
}

type identityProviderRequest struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	BaseURL     string `json:"baseUrl"`
	Token       string `json:"token"`
	InsecureTLS bool   `json:"insecureTls"`
}

func (s *Server) validateIdentityProvider(w http.ResponseWriter, req *identityProviderRequest) bool {
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return false
	}
	if !slices.Contains(identityfactory.Types, req.Type) {
		s.err(w, http.StatusBadRequest, "unsupported identity provider type")
		return false
	}
	if !strings.HasPrefix(req.BaseURL, "http://") && !strings.HasPrefix(req.BaseURL, "https://") {
		s.err(w, http.StatusBadRequest, "base URL must start with http:// or https://")
		return false
	}
	return true
}

func (s *Server) createIdentityProvider(w http.ResponseWriter, r *http.Request) {
	var req identityProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateIdentityProvider(w, &req) {
		return
	}
	if strings.TrimSpace(req.Token) == "" {
		s.err(w, http.StatusBadRequest, "an API token is required")
		return
	}
	if existing, err := s.store.GetIdentityProviderByName(r.Context(), req.Name); err == nil && existing != nil {
		s.err(w, http.StatusConflict, "a provider with this name already exists")
		return
	}
	p := &store.IdentityProvider{
		ID:          uuid.NewString(),
		Name:        req.Name,
		Type:        req.Type,
		BaseURL:     strings.TrimRight(strings.TrimSpace(req.BaseURL), "/"),
		Token:       strings.TrimSpace(req.Token),
		InsecureTLS: req.InsecureTLS,
	}
	provider, err := identityfactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	// Reject credentials that don't work rather than storing a
	// provider that can never connect.
	if err := provider.Verify(r.Context()); err != nil {
		s.log.Warn("identity provider rejected", "name", p.Name, "type", p.Type, "error", err)
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.CreateIdentityProvider(r.Context(), p); err != nil {
		s.fail(w, err, "creating provider")
		return
	}
	s.identityRegistry.Set(p.ID, provider)
	s.json(w, http.StatusCreated, s.probeIdentityProvider(r.Context(), *p))
}

func (s *Server) updateIdentityProvider(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetIdentityProvider(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "provider")
		return
	}
	var req identityProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateIdentityProvider(w, &req) {
		return
	}
	if req.Name != p.Name {
		if existing, err := s.store.GetIdentityProviderByName(r.Context(), req.Name); err == nil && existing != nil {
			s.err(w, http.StatusConflict, "a provider with this name already exists")
			return
		}
	}
	p.Name = req.Name
	p.Type = req.Type
	p.BaseURL = strings.TrimRight(strings.TrimSpace(req.BaseURL), "/")
	p.InsecureTLS = req.InsecureTLS
	if strings.TrimSpace(req.Token) != "" { // blank means "keep existing"
		p.Token = strings.TrimSpace(req.Token)
	}
	provider, err := identityfactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := provider.Verify(r.Context()); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.UpdateIdentityProvider(r.Context(), p); err != nil {
		s.fail(w, err, "updating provider")
		return
	}
	s.identityRegistry.Set(p.ID, provider)
	s.json(w, http.StatusOK, s.probeIdentityProvider(r.Context(), *p))
}

func (s *Server) deleteIdentityProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteIdentityProvider(r.Context(), id); err != nil {
		s.fail(w, err, "deleting provider")
		return
	}
	s.identityRegistry.Remove(id)
	w.WriteHeader(http.StatusNoContent)
}

// identityProvider resolves the ?provider= query param, defaulting to
// the only configured provider — a lab has one identity service, and
// making every page pass an id it can't choose wrong is noise.
func (s *Server) identityProvider(w http.ResponseWriter, r *http.Request) identity.Provider {
	if id := r.URL.Query().Get("provider"); id != "" {
		provider, ok := s.identityRegistry.Get(id)
		if !ok {
			s.err(w, http.StatusNotFound, "provider: not found")
			return nil
		}
		return provider
	}
	records, err := s.store.ListIdentityProviders(r.Context())
	if err != nil {
		s.fail(w, err, "identity providers")
		return nil
	}
	if len(records) == 0 {
		s.err(w, http.StatusNotFound, "no identity provider is configured")
		return nil
	}
	provider, ok := s.identityRegistry.Get(records[0].ID)
	if !ok {
		s.err(w, http.StatusNotFound, "provider: not loaded")
		return nil
	}
	return provider
}

// identityUsers is the shape the user list returns: the directory plus
// the provider it came from, so a future second provider needs no
// change here.
func (s *Server) listIdentityUsers(w http.ResponseWriter, r *http.Request) {
	provider := s.identityProvider(w, r)
	if provider == nil {
		return
	}
	users, err := provider.Users(r.Context())
	if err != nil {
		s.fail(w, err, "identity users")
		return
	}
	slices.SortFunc(users, func(a, b identity.User) int {
		return strings.Compare(strings.ToLower(a.Username), strings.ToLower(b.Username))
	})
	s.json(w, http.StatusOK, users)
}

// createIdentityUser makes the account, then asks for a recovery link
// so the person sets their own password through the provider's own
// enrollment. The account is reported even when the link fails: it
// exists by then, and saying otherwise would send you looking for a
// user that's already there.
func (s *Server) createIdentityUser(w http.ResponseWriter, r *http.Request) {
	provider := s.identityProvider(w, r)
	if provider == nil {
		return
	}
	var req struct {
		Username string   `json:"username"`
		Name     string   `json:"name"`
		Email    string   `json:"email"`
		Groups   []string `json:"groups"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" {
		s.err(w, http.StatusBadRequest, "a username is required")
		return
	}
	if strings.ContainsAny(req.Username, " \t/\\") {
		s.err(w, http.StatusBadRequest, "usernames can't contain spaces or slashes")
		return
	}
	user, err := provider.CreateUser(r.Context(), identity.UserSpec{
		Username: req.Username,
		Name:     strings.TrimSpace(req.Name),
		Email:    strings.TrimSpace(req.Email),
		Groups:   req.Groups,
	})
	if err != nil {
		s.fail(w, err, "creating user")
		return
	}
	link, linkErr := provider.RecoveryLink(r.Context(), user.ID)
	response := struct {
		identity.User
		RecoveryLink  string `json:"recoveryLink,omitempty"`
		RecoveryError string `json:"recoveryError,omitempty"`
	}{User: *user, RecoveryLink: link}
	if linkErr != nil {
		response.RecoveryError = linkErr.Error()
	}
	s.json(w, http.StatusCreated, response)
}

func (s *Server) identityUserRecoveryLink(w http.ResponseWriter, r *http.Request) {
	provider := s.identityProvider(w, r)
	if provider == nil {
		return
	}
	link, err := provider.RecoveryLink(r.Context(), chi.URLParam(r, "userId"))
	if err != nil {
		s.fail(w, err, "recovery link")
		return
	}
	s.json(w, http.StatusOK, map[string]string{"link": link})
}

func (s *Server) setIdentityUserActive(w http.ResponseWriter, r *http.Request) {
	provider := s.identityProvider(w, r)
	if provider == nil {
		return
	}
	var req struct {
		Active bool `json:"active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := provider.SetUserActive(r.Context(), chi.URLParam(r, "userId"), req.Active); err != nil {
		s.fail(w, err, "updating user")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) setIdentityUserPassword(w http.ResponseWriter, r *http.Request) {
	provider := s.identityProvider(w, r)
	if provider == nil {
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Password == "" {
		s.err(w, http.StatusBadRequest, "a password is required")
		return
	}
	if err := provider.SetUserPassword(r.Context(), chi.URLParam(r, "userId"), req.Password); err != nil {
		s.fail(w, err, "setting password")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listIdentityGroups(w http.ResponseWriter, r *http.Request) {
	provider := s.identityProvider(w, r)
	if provider == nil {
		return
	}
	groups, err := provider.Groups(r.Context())
	if err != nil {
		s.fail(w, err, "identity groups")
		return
	}
	slices.SortFunc(groups, func(a, b identity.Group) int {
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
	s.json(w, http.StatusOK, groups)
}

func (s *Server) addIdentityGroupMember(w http.ResponseWriter, r *http.Request) {
	provider := s.identityProvider(w, r)
	if provider == nil {
		return
	}
	var req struct {
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if _, err := strconv.Atoi(req.UserID); err != nil {
		s.err(w, http.StatusBadRequest, "userId is required")
		return
	}
	if err := provider.AddUserToGroup(r.Context(), chi.URLParam(r, "groupId"), req.UserID); err != nil {
		s.fail(w, err, "adding member")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) removeIdentityGroupMember(w http.ResponseWriter, r *http.Request) {
	provider := s.identityProvider(w, r)
	if provider == nil {
		return
	}
	err := provider.RemoveUserFromGroup(r.Context(),
		chi.URLParam(r, "groupId"), chi.URLParam(r, "userId"))
	if err != nil {
		s.fail(w, err, "removing member")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listIdentityApplications(w http.ResponseWriter, r *http.Request) {
	provider := s.identityProvider(w, r)
	if provider == nil {
		return
	}
	apps, err := provider.Applications(r.Context())
	if err != nil {
		s.fail(w, err, "identity applications")
		return
	}
	slices.SortFunc(apps, func(a, b identity.Application) int {
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
	s.json(w, http.StatusOK, apps)
}

func (s *Server) listIdentityEvents(w http.ResponseWriter, r *http.Request) {
	provider := s.identityProvider(w, r)
	if provider == nil {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	events, err := provider.Events(r.Context(), limit)
	if err != nil {
		s.fail(w, err, "identity events")
		return
	}
	s.json(w, http.StatusOK, events)
}
