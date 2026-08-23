package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"vantric/internal/ai"
)

// Changing what the gateway is configured to do, rather than reading
// what it did.
//
// EVERY HANDLER HERE ASKS THE DRIVER WHETHER IT CAN, by type assertion
// on the capability interface, and answers 501 by name when it can't.
// A gateway that only reads is still worth connecting, and "this
// gateway doesn't offer that" is a different answer from "that failed"
// — the frontend hides the buttons on the same signal, so the two
// never disagree.

// aiCapability reports what this console can change on the gateway,
// so the UI offers exactly the buttons that will work.
type aiCapability struct {
	VirtualKeys bool `json:"virtualKeys"`
	Limits      bool `json:"limits"`
	Providers   bool `json:"providers"`
}

func (s *Server) aiCapabilities(w http.ResponseWriter, r *http.Request) {
	provider := s.aiProvider(w, r)
	if provider == nil {
		return
	}
	_, vk := provider.(ai.VirtualKeyManager)
	_, lim := provider.(ai.LimitManager)
	_, prov := provider.(ai.ProviderManager)
	s.json(w, http.StatusOK, aiCapability{VirtualKeys: vk, Limits: lim, Providers: prov})
}

// unsupported is the one refusal that isn't a failure: the gateway is
// fine, this console simply can't do that to it.
func (s *Server) unsupported(w http.ResponseWriter, what string) {
	s.err(w, http.StatusNotImplemented, "this gateway doesn't support changing "+what+" from here")
}

// aiWriteError maps a driver's answer onto a status. The gateway's own
// sentence is the message wherever there is one — see refusal() in the
// bifrost driver.
func (s *Server) aiWriteError(w http.ResponseWriter, err error, doing string) {
	if errors.Is(err, ai.ErrNotFound) {
		s.err(w, http.StatusNotFound, "the gateway doesn't have that")
		return
	}
	s.fail(w, err, doing)
}

// -------------------------------------------------------- virtual keys

func (s *Server) aiVirtualKeyManager(w http.ResponseWriter, r *http.Request) ai.VirtualKeyManager {
	provider := s.aiProvider(w, r)
	if provider == nil {
		return nil
	}
	manager, ok := provider.(ai.VirtualKeyManager)
	if !ok {
		s.unsupported(w, "virtual keys")
		return nil
	}
	return manager
}

// virtualKeyInput is the wire shape, with Active defaulting to TRUE
// rather than to Go's zero value: a key created switched off is a key
// somebody has to go and switch on, and nobody issues one meaning that.
type virtualKeyInput struct {
	Name        string                `json:"name"`
	Description string                `json:"description"`
	Active      *bool                 `json:"active"`
	Access      []ai.VirtualKeyAccess `json:"access"`
}

func (in virtualKeyInput) toAI() ai.VirtualKeyInput {
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	access := in.Access
	if access == nil {
		access = []ai.VirtualKeyAccess{}
	}
	return ai.VirtualKeyInput{
		Name:        strings.TrimSpace(in.Name),
		Description: strings.TrimSpace(in.Description),
		Active:      active,
		Access:      access,
	}
}

func (s *Server) createAIVirtualKey(w http.ResponseWriter, r *http.Request) {
	manager := s.aiVirtualKeyManager(w, r)
	if manager == nil {
		return
	}
	var in virtualKeyInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a virtual key")
		return
	}
	body := in.toAI()
	if body.Name == "" {
		s.err(w, http.StatusBadRequest, "a virtual key needs a name")
		return
	}
	issued, err := manager.CreateVirtualKey(r.Context(), body)
	if err != nil {
		s.aiWriteError(w, err, "creating the virtual key")
		return
	}
	// The secret rides back on THIS response and no other. It is the
	// only moment it can reach the person who asked for it, and the
	// page says as much — see ai.IssuedVirtualKey.
	s.json(w, http.StatusCreated, issued)
}

func (s *Server) updateAIVirtualKey(w http.ResponseWriter, r *http.Request) {
	manager := s.aiVirtualKeyManager(w, r)
	if manager == nil {
		return
	}
	var in virtualKeyInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a virtual key")
		return
	}
	body := in.toAI()
	if body.Name == "" {
		s.err(w, http.StatusBadRequest, "a virtual key needs a name")
		return
	}
	if err := manager.UpdateVirtualKey(r.Context(), chi.URLParam(r, "id"), body); err != nil {
		s.aiWriteError(w, err, "saving the virtual key")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteAIVirtualKey(w http.ResponseWriter, r *http.Request) {
	manager := s.aiVirtualKeyManager(w, r)
	if manager == nil {
		return
	}
	if err := manager.DeleteVirtualKey(r.Context(), chi.URLParam(r, "id")); err != nil {
		s.aiWriteError(w, err, "revoking the virtual key")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// -------------------------------------------------------------- limits

func (s *Server) aiLimitManager(w http.ResponseWriter, r *http.Request) ai.LimitManager {
	provider := s.aiProvider(w, r)
	if provider == nil {
		return nil
	}
	manager, ok := provider.(ai.LimitManager)
	if !ok {
		s.unsupported(w, "budgets")
		return nil
	}
	return manager
}

func decodeLimit(w http.ResponseWriter, r *http.Request, s *Server) (*ai.LimitInput, bool) {
	var in ai.LimitInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a budget")
		return nil, false
	}
	// A record with neither half caps nothing, and the gateway would
	// accept it — an empty rule that looks like a rule is worse than a
	// refusal.
	if in.Budget == nil && in.RateLimit == nil {
		s.err(w, http.StatusBadRequest, "set a spending cap, a rate cap, or both")
		return nil, false
	}
	if in.Budget != nil {
		if in.Budget.Max <= 0 {
			s.err(w, http.StatusBadRequest, "a spending cap has to be more than zero")
			return nil, false
		}
		if strings.TrimSpace(in.Budget.Period) == "" {
			s.err(w, http.StatusBadRequest, "a spending cap needs a period to reset over")
			return nil, false
		}
	}
	return &in, true
}

func (s *Server) createAILimit(w http.ResponseWriter, r *http.Request) {
	manager := s.aiLimitManager(w, r)
	if manager == nil {
		return
	}
	in, ok := decodeLimit(w, r, s)
	if !ok {
		return
	}
	if in.Scope == "" {
		in.Scope = "global"
	}
	// Anything but global is a cap on a particular thing, and Bifrost
	// needs to be told which — an omitted id there produces a rule that
	// silently governs nothing.
	if in.Scope != "global" && in.ScopeID == "" {
		s.err(w, http.StatusBadRequest, "a cap on a virtual key has to say which one")
		return
	}
	limit, err := manager.CreateLimit(r.Context(), *in)
	if err != nil {
		s.aiWriteError(w, err, "creating the budget")
		return
	}
	s.json(w, http.StatusCreated, limit)
}

func (s *Server) updateAILimit(w http.ResponseWriter, r *http.Request) {
	manager := s.aiLimitManager(w, r)
	if manager == nil {
		return
	}
	in, ok := decodeLimit(w, r, s)
	if !ok {
		return
	}
	if err := manager.UpdateLimit(r.Context(), chi.URLParam(r, "id"), *in); err != nil {
		s.aiWriteError(w, err, "saving the budget")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteAILimit(w http.ResponseWriter, r *http.Request) {
	manager := s.aiLimitManager(w, r)
	if manager == nil {
		return
	}
	if err := manager.DeleteLimit(r.Context(), chi.URLParam(r, "id")); err != nil {
		s.aiWriteError(w, err, "removing the budget")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// resetAILimitUsage forgives what has been spent so far. Its own route
// rather than a field on save, because it is a decision: a form that
// zeroed the counter every time somebody corrected a typo in the cap
// would make the cap meaningless.
func (s *Server) resetAILimitUsage(w http.ResponseWriter, r *http.Request) {
	manager := s.aiLimitManager(w, r)
	if manager == nil {
		return
	}
	if err := manager.ResetLimitUsage(r.Context(), chi.URLParam(r, "id")); err != nil {
		s.aiWriteError(w, err, "resetting the budget")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ----------------------------------------------------------- providers

func (s *Server) aiProviderManager(w http.ResponseWriter, r *http.Request) ai.ProviderManager {
	provider := s.aiProvider(w, r)
	if provider == nil {
		return nil
	}
	manager, ok := provider.(ai.ProviderManager)
	if !ok {
		s.unsupported(w, "providers")
		return nil
	}
	return manager
}

type gatewayProviderInput struct {
	Name string             `json:"name"`
	Key  ai.GatewayKeyInput `json:"key"`
}

// keyOK checks the half of the credential that depends on which
// provider it is: the self-hosted ones need an address and no secret,
// everyone else the reverse. `editing` allows the blank that means
// "keep what's stored".
func keyOK(provider string, in ai.GatewayKeyInput, editing bool) string {
	switch provider {
	case "ollama", "sgl", "vllm":
		if strings.TrimSpace(in.URL) == "" {
			return provider + " is reached at an address rather than with a key — give it a URL"
		}
	default:
		if !editing && strings.TrimSpace(in.Value) == "" {
			return "that provider needs an API key"
		}
	}
	return ""
}

// aiProviderTypes is the vendor list the gateway will accept, for the
// picker on the create form. Not a gate — see supportedProviders.
func (s *Server) aiProviderTypes(w http.ResponseWriter, r *http.Request) {
	manager := s.aiProviderManager(w, r)
	if manager == nil {
		return
	}
	s.json(w, http.StatusOK, manager.SupportedProviders())
}

func (s *Server) createAIGatewayProvider(w http.ResponseWriter, r *http.Request) {
	manager := s.aiProviderManager(w, r)
	if manager == nil {
		return
	}
	var in gatewayProviderInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a provider")
		return
	}
	in.Name = strings.ToLower(strings.TrimSpace(in.Name))
	if in.Name == "" {
		s.err(w, http.StatusBadRequest, "a provider needs a name")
		return
	}
	if problem := keyOK(in.Name, in.Key, false); problem != "" {
		s.err(w, http.StatusBadRequest, problem)
		return
	}
	if err := manager.CreateGatewayProvider(r.Context(), in.Name, in.Key); err != nil {
		s.aiWriteError(w, err, "connecting the provider")
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (s *Server) deleteAIGatewayProvider(w http.ResponseWriter, r *http.Request) {
	manager := s.aiProviderManager(w, r)
	if manager == nil {
		return
	}
	if err := manager.DeleteGatewayProvider(r.Context(), chi.URLParam(r, "provider")); err != nil {
		s.aiWriteError(w, err, "disconnecting the provider")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) addAIGatewayKey(w http.ResponseWriter, r *http.Request) {
	manager := s.aiProviderManager(w, r)
	if manager == nil {
		return
	}
	provider := chi.URLParam(r, "provider")
	var in ai.GatewayKeyInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a key")
		return
	}
	if problem := keyOK(provider, in, false); problem != "" {
		s.err(w, http.StatusBadRequest, problem)
		return
	}
	if err := manager.AddGatewayKey(r.Context(), provider, in); err != nil {
		s.aiWriteError(w, err, "adding the key")
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (s *Server) updateAIGatewayKey(w http.ResponseWriter, r *http.Request) {
	manager := s.aiProviderManager(w, r)
	if manager == nil {
		return
	}
	provider := chi.URLParam(r, "provider")
	var in ai.GatewayKeyInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a key")
		return
	}
	if problem := keyOK(provider, in, true); problem != "" {
		s.err(w, http.StatusBadRequest, problem)
		return
	}
	if err := manager.UpdateGatewayKey(r.Context(), provider, chi.URLParam(r, "keyId"), in); err != nil {
		s.aiWriteError(w, err, "saving the key")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteAIGatewayKey(w http.ResponseWriter, r *http.Request) {
	manager := s.aiProviderManager(w, r)
	if manager == nil {
		return
	}
	if err := manager.DeleteGatewayKey(r.Context(),
		chi.URLParam(r, "provider"), chi.URLParam(r, "keyId")); err != nil {
		s.aiWriteError(w, err, "removing the key")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
