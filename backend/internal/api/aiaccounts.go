package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/aiaccount"
	aiaccountfactory "vantric/internal/aiaccount/factory"
	"vantric/internal/store"
)

// Provider accounts: what is LEFT where you pay, which the gateway
// cannot know.
//
// Adding one is an OWNER's decision like every other stored
// credential. Reading the balances is anyone's.

func (s *Server) aiAccountRoutes(r chi.Router) {
	r.Get("/ai/account-types", func(w http.ResponseWriter, r *http.Request) {
		s.json(w, http.StatusOK, aiaccountfactory.Types)
	})
	r.Get("/ai/accounts", s.listAIAccounts)
	r.Post("/ai/accounts", s.createAIAccount)
	r.Put("/ai/accounts/{id}", s.updateAIAccount)
	r.Delete("/ai/accounts/{id}", s.deleteAIAccount)
}

type aiAccountView struct {
	store.AIAccount
	HasKey  bool               `json:"hasKey"`
	Status  string             `json:"status"` // connected | unreachable | unsupported | unknown
	Balance *aiaccount.Balance `json:"balance,omitempty"`
	Error   string             `json:"error,omitempty"`
}

func (s *Server) probeAIAccount(ctx context.Context, a store.AIAccount) aiAccountView {
	view := aiAccountView{AIAccount: a, HasKey: a.Key != "", Status: "unknown"}
	provider, ok := s.aiAccountRegistry.Get(a.ID)
	if !ok {
		view.Error = "no provider loaded"
		return view
	}
	balance, err := provider.Balance(ctx)
	switch {
	case errors.Is(err, aiaccount.ErrUnsupported):
		// Not an error: this provider genuinely has no balance API, and
		// saying so is the point. A dash here would read as "we looked
		// and found nothing", which is a different and wrong answer.
		view.Status = "unsupported"
		view.Error = err.Error()
		return view
	case err != nil:
		view.Status = "unreachable"
		view.Error = err.Error()
		return view
	}
	view.Status = "connected"
	view.Balance = balance
	return view
}

func (s *Server) listAIAccounts(w http.ResponseWriter, r *http.Request) {
	accounts, err := s.store.ListAIAccounts(r.Context())
	if err != nil {
		s.fail(w, err, "provider accounts")
		return
	}
	views := make([]aiAccountView, len(accounts))
	var wg sync.WaitGroup
	for i := range accounts {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			views[i] = s.probeAIAccount(r.Context(), accounts[i])
		}(i)
	}
	wg.Wait()
	s.json(w, http.StatusOK, views)
}

type aiAccountRequest struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Key  string `json:"key"`
}

func (s *Server) validateAIAccount(w http.ResponseWriter, req *aiAccountRequest) bool {
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return false
	}
	if !slices.Contains(aiaccountfactory.Types, req.Type) {
		s.err(w, http.StatusBadRequest, "unsupported provider")
		return false
	}
	return true
}

func (s *Server) createAIAccount(w http.ResponseWriter, r *http.Request) {
	var req aiAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateAIAccount(w, &req) {
		return
	}
	if strings.TrimSpace(req.Key) == "" {
		s.err(w, http.StatusBadRequest, "an API key is required")
		return
	}
	a := &store.AIAccount{
		ID:   uuid.NewString(),
		Name: req.Name,
		Type: req.Type,
		Key:  strings.TrimSpace(req.Key),
	}
	provider, err := aiaccountfactory.Build(a)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := provider.Check(r.Context()); err != nil {
		s.log.Warn("provider account rejected", "name", a.Name, "type", a.Type, "error", err)
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.CreateAIAccount(r.Context(), a); err != nil {
		s.fail(w, err, "creating the account")
		return
	}
	s.aiAccountRegistry.Set(a.ID, provider)
	s.json(w, http.StatusCreated, s.probeAIAccount(r.Context(), *a))
}

func (s *Server) updateAIAccount(w http.ResponseWriter, r *http.Request) {
	a, err := s.store.GetAIAccount(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "account")
		return
	}
	var req aiAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateAIAccount(w, &req) {
		return
	}
	a.Name = req.Name
	a.Type = req.Type
	// Blank keeps what's stored, the rule every credential form here
	// follows — the API never gives a key back, so an untouched field
	// must not read as "remove it".
	if key := strings.TrimSpace(req.Key); key != "" {
		a.Key = key
	}
	provider, err := aiaccountfactory.Build(a)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := provider.Check(r.Context()); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.UpdateAIAccount(r.Context(), a); err != nil {
		s.fail(w, err, "updating the account")
		return
	}
	s.aiAccountRegistry.Set(a.ID, provider)
	s.json(w, http.StatusOK, s.probeAIAccount(r.Context(), *a))
}

func (s *Server) deleteAIAccount(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteAIAccount(r.Context(), id); err != nil {
		s.fail(w, err, "deleting the account")
		return
	}
	s.aiAccountRegistry.Remove(id)
	w.WriteHeader(http.StatusNoContent)
}
