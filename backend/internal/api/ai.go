package api

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/ai"
	aifactory "vantric/internal/ai/factory"
	"vantric/internal/store"
)

// The AI section: what the lab asked of a model, and what answered.
//
// One gateway is the ordinary case, so the request endpoints DEFAULT
// TO THE SINGLE CONFIGURED ONE when ?gateway= is absent — the same
// rule the identity endpoints follow, and for the same reason: making
// every page pass an id it cannot get wrong is noise.
//
// Connecting a gateway is an OWNER's decision (it is a stored
// credential, even when that credential is empty); reading the log is
// anyone's, like every other read here.

func (s *Server) aiRoutes(r chi.Router) {
	r.Get("/ai/gateway-types", func(w http.ResponseWriter, r *http.Request) {
		s.json(w, http.StatusOK, aifactory.Types)
	})
	r.Get("/ai/gateways", s.listAIGateways)
	r.Post("/ai/gateways", s.createAIGateway)
	r.Put("/ai/gateways/{id}", s.updateAIGateway)
	r.Delete("/ai/gateways/{id}", s.deleteAIGateway)
	r.Get("/ai/requests", s.listAIRequests)
	r.Get("/ai/requests/{id}", s.getAIRequest)
	r.Get("/ai/stats", s.aiStats)
	r.Get("/ai/filters", s.aiFilters)
	r.Get("/ai/traffic", s.aiTraffic)
	r.Get("/ai/rankings", s.aiRankings)
	r.Get("/ai/providers", s.aiGatewayProviders)
	r.Get("/ai/virtual-keys", s.aiVirtualKeys)
	r.Get("/ai/limits", s.aiLimits)
}

type aiGatewayView struct {
	store.AIGateway
	HasToken bool     `json:"hasToken"`
	Status   string   `json:"status"` // connected | unreachable | unknown
	Info     *ai.Info `json:"info,omitempty"`
	Error    string   `json:"error,omitempty"`
}

func (s *Server) probeAIGateway(ctx context.Context, g store.AIGateway) aiGatewayView {
	view := aiGatewayView{AIGateway: g, HasToken: g.Token != "", Status: "unknown"}
	provider, ok := s.aiRegistry.Get(g.ID)
	if !ok {
		view.Error = "no gateway loaded"
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

func (s *Server) listAIGateways(w http.ResponseWriter, r *http.Request) {
	gateways, err := s.store.ListAIGateways(r.Context())
	if err != nil {
		s.fail(w, err, "AI gateways")
		return
	}
	views := make([]aiGatewayView, len(gateways))
	var wg sync.WaitGroup
	for i := range gateways {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			views[i] = s.probeAIGateway(r.Context(), gateways[i])
		}(i)
	}
	wg.Wait()
	s.json(w, http.StatusOK, views)
}

type aiGatewayRequest struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	BaseURL     string `json:"baseUrl"`
	Token       string `json:"token"`
	InsecureTLS bool   `json:"insecureTls"`
}

func (s *Server) validateAIGateway(w http.ResponseWriter, req *aiGatewayRequest) bool {
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return false
	}
	if !slices.Contains(aifactory.Types, req.Type) {
		s.err(w, http.StatusBadRequest, "unsupported AI gateway type")
		return false
	}
	if !strings.HasPrefix(req.BaseURL, "http://") && !strings.HasPrefix(req.BaseURL, "https://") {
		s.err(w, http.StatusBadRequest, "base URL must start with http:// or https://")
		return false
	}
	return true
}

func (s *Server) createAIGateway(w http.ResponseWriter, r *http.Request) {
	var req aiGatewayRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateAIGateway(w, &req) {
		return
	}
	// No token check: a Bifrost with auth disabled is the normal case,
	// and demanding a credential it doesn't want would make the common
	// deployment the unsupported one.
	g := &store.AIGateway{
		ID:          uuid.NewString(),
		Name:        req.Name,
		Type:        req.Type,
		BaseURL:     strings.TrimRight(strings.TrimSpace(req.BaseURL), "/"),
		Token:       strings.TrimSpace(req.Token),
		InsecureTLS: req.InsecureTLS,
	}
	provider, err := aifactory.Build(g)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	// Reject a gateway that doesn't answer rather than storing one that
	// never will.
	if _, err := provider.Check(r.Context()); err != nil {
		s.log.Warn("AI gateway rejected", "name", g.Name, "type", g.Type, "error", err)
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.CreateAIGateway(r.Context(), g); err != nil {
		s.fail(w, err, "creating gateway")
		return
	}
	s.aiRegistry.Set(g.ID, provider)
	s.json(w, http.StatusCreated, s.probeAIGateway(r.Context(), *g))
}

func (s *Server) updateAIGateway(w http.ResponseWriter, r *http.Request) {
	g, err := s.store.GetAIGateway(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "gateway")
		return
	}
	var req aiGatewayRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateAIGateway(w, &req) {
		return
	}
	g.Name = req.Name
	g.Type = req.Type
	g.BaseURL = strings.TrimRight(strings.TrimSpace(req.BaseURL), "/")
	g.InsecureTLS = req.InsecureTLS
	// Blank keeps what's stored, the same rule the other backend forms
	// follow — the API never gives a token back, so an untouched form
	// must not read as "remove it".
	if token := strings.TrimSpace(req.Token); token != "" {
		g.Token = token
	}
	provider, err := aifactory.Build(g)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := provider.Check(r.Context()); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.UpdateAIGateway(r.Context(), g); err != nil {
		s.fail(w, err, "updating gateway")
		return
	}
	s.aiRegistry.Set(g.ID, provider)
	s.json(w, http.StatusOK, s.probeAIGateway(r.Context(), *g))
}

func (s *Server) deleteAIGateway(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteAIGateway(r.Context(), id); err != nil {
		s.fail(w, err, "deleting gateway")
		return
	}
	s.aiRegistry.Remove(id)
	w.WriteHeader(http.StatusNoContent)
}

// aiProvider resolves ?gateway=, or the only one configured.
func (s *Server) aiProvider(w http.ResponseWriter, r *http.Request) ai.Provider {
	if id := r.URL.Query().Get("gateway"); id != "" {
		provider, ok := s.aiRegistry.Get(id)
		if !ok {
			s.err(w, http.StatusNotFound, "no such AI gateway")
			return nil
		}
		return provider
	}
	gateways, err := s.store.ListAIGateways(r.Context())
	if err != nil {
		s.fail(w, err, "AI gateways")
		return nil
	}
	switch len(gateways) {
	case 0:
		s.err(w, http.StatusNotFound, "no AI gateway is connected")
		return nil
	case 1:
		provider, ok := s.aiRegistry.Get(gateways[0].ID)
		if !ok {
			s.err(w, http.StatusConflict, "the AI gateway's credentials didn't load")
			return nil
		}
		return provider
	default:
		s.err(w, http.StatusBadRequest, "several gateways are connected — name one with ?gateway=")
		return nil
	}
}

// aiQuery reads the query string into a provider query.
//
// The LIMIT IS CAPPED HERE as well as at the gateway. Bifrost refuses
// over 1000 with a 400, and a console that passes a bad number through
// so the backend can report someone else's error message is a console
// that made the user debug its own request.
func aiQuery(r *http.Request) ai.RequestQuery {
	q := r.URL.Query()
	query := ai.RequestQuery{
		Limit:     50,
		SortBy:    "timestamp",
		Desc:      true,
		Providers: splitList(q.Get("providers")),
		Models:    splitList(q.Get("models")),
		Callers:   splitList(q.Get("callers")),
		Status:    q.Get("status"),
		Search:    q.Get("search"),
	}
	if n, err := strconv.Atoi(q.Get("limit")); err == nil && n > 0 {
		query.Limit = min(n, 1000)
	}
	if n, err := strconv.Atoi(q.Get("offset")); err == nil && n > 0 {
		query.Offset = n
	}
	if sort := q.Get("sortBy"); slices.Contains([]string{"timestamp", "latency", "tokens", "cost"}, sort) {
		query.SortBy = sort
	}
	if q.Get("order") == "asc" {
		query.Desc = false
	}
	if t, err := time.Parse(time.RFC3339, q.Get("since")); err == nil {
		query.Since = t
	}
	if t, err := time.Parse(time.RFC3339, q.Get("until")); err == nil {
		query.Until = t
	}
	return query
}

func splitList(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func (s *Server) listAIRequests(w http.ResponseWriter, r *http.Request) {
	provider := s.aiProvider(w, r)
	if provider == nil {
		return
	}
	page, err := provider.Requests(r.Context(), aiQuery(r))
	if err != nil {
		s.fail(w, err, "AI requests")
		return
	}
	s.json(w, http.StatusOK, page)
}

func (s *Server) aiStats(w http.ResponseWriter, r *http.Request) {
	provider := s.aiProvider(w, r)
	if provider == nil {
		return
	}
	stats, err := provider.Stats(r.Context(), aiQuery(r))
	if err != nil {
		s.fail(w, err, "AI stats")
		return
	}
	s.json(w, http.StatusOK, stats)
}

func (s *Server) aiFilters(w http.ResponseWriter, r *http.Request) {
	provider := s.aiProvider(w, r)
	if provider == nil {
		return
	}
	filters, err := provider.Filters(r.Context())
	if err != nil {
		s.fail(w, err, "AI filters")
		return
	}
	s.json(w, http.StatusOK, filters)
}

func (s *Server) aiTraffic(w http.ResponseWriter, r *http.Request) {
	provider := s.aiProvider(w, r)
	if provider == nil {
		return
	}
	traffic, err := provider.Traffic(r.Context(), aiQuery(r))
	if err != nil {
		s.fail(w, err, "AI traffic")
		return
	}
	s.json(w, http.StatusOK, traffic)
}

func (s *Server) aiRankings(w http.ResponseWriter, r *http.Request) {
	provider := s.aiProvider(w, r)
	if provider == nil {
		return
	}
	rankings, err := provider.Rankings(r.Context(), aiQuery(r))
	if err != nil {
		s.fail(w, err, "AI rankings")
		return
	}
	s.json(w, http.StatusOK, rankings)
}

func (s *Server) aiGatewayProviders(w http.ResponseWriter, r *http.Request) {
	provider := s.aiProvider(w, r)
	if provider == nil {
		return
	}
	providers, err := provider.GatewayProviders(r.Context())
	if err != nil {
		s.fail(w, err, "gateway providers")
		return
	}
	s.json(w, http.StatusOK, providers)
}

func (s *Server) aiVirtualKeys(w http.ResponseWriter, r *http.Request) {
	provider := s.aiProvider(w, r)
	if provider == nil {
		return
	}
	keys, err := provider.VirtualKeys(r.Context(), aiQuery(r))
	if err != nil {
		s.fail(w, err, "virtual keys")
		return
	}
	s.json(w, http.StatusOK, keys)
}

func (s *Server) aiLimits(w http.ResponseWriter, r *http.Request) {
	provider := s.aiProvider(w, r)
	if provider == nil {
		return
	}
	limits, err := provider.Limits(r.Context())
	if err != nil {
		s.fail(w, err, "gateway limits")
		return
	}
	s.json(w, http.StatusOK, limits)
}

func (s *Server) getAIRequest(w http.ResponseWriter, r *http.Request) {
	provider := s.aiProvider(w, r)
	if provider == nil {
		return
	}
	detail, err := provider.Request(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "AI request")
		return
	}
	s.json(w, http.StatusOK, detail)
}
