// Package bifrost implements ai.Provider against Bifrost, Maxim's AI
// gateway (https://docs.getbifrost.ai).
//
// Bifrost serves its management API under /api on the SAME port as the
// OpenAI-compatible inference API — there is no separate admin port.
// What matters for this console is /api/logs, which is a real query
// interface rather than a dump: filters, an offset pager and four sort
// keys, all of which the console hands straight through.
//
// AUTH IS OPTIONAL AND USUALLY OFF. Bifrost's middleware passes every
// request through when auth is disabled, which is how it ships, so a
// stored token here is genuinely optional — unlike every other backend
// in this console. When auth IS on, note that a VIRTUAL KEY WILL NOT
// DO: sk-bf-* keys authenticate /v1 inference only, and the management
// API takes the admin credential. That is the mistake to expect,
// the way a browser-session token is the one to expect for Fleet.
package bifrost

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"vantric/internal/ai"
)

type Config struct {
	BaseURL     string
	Token       string
	InsecureTLS bool
}

type Provider struct {
	base   string
	token  string
	client *http.Client
}

func New(cfg Config) *Provider {
	transport := http.DefaultTransport
	if cfg.InsecureTLS {
		transport = &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
	}
	return &Provider{
		base:  strings.TrimRight(cfg.BaseURL, "/"),
		token: cfg.Token,
		client: &http.Client{
			Timeout:   30 * time.Second,
			Transport: transport,
		},
	}
}

func (p *Provider) Name() string { return "bifrost" }

func (p *Provider) get(ctx context.Context, path string, query url.Values, out any) error {
	u := p.base + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	if p.token != "" {
		// Bifrost accepts a session token as a bearer, and an admin
		// user:password pair as either Basic or a base64 bearer. A
		// token carrying a colon is the second kind, so it is sent the
		// way that form expects rather than as an opaque bearer that
		// would always be refused.
		if user, pass, ok := strings.Cut(p.token, ":"); ok {
			req.Header.Set("Authorization", "Basic "+
				base64.StdEncoding.EncodeToString([]byte(user+":"+pass)))
		} else {
			req.Header.Set("Authorization", "Bearer "+p.token)
		}
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("bifrost: GET %s: %w", path, err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return ai.ErrNotFound
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return errors.New("bifrost: the gateway refused the credential — its " +
			"management API takes the admin account, not a virtual key")
	case resp.StatusCode >= 300:
		return fmt.Errorf("bifrost: GET %s: %s", path, resp.Status)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (p *Provider) Check(ctx context.Context) (*ai.Info, error) {
	// /api/version answers whether auth is on or off, so it is the one
	// call that always works and always identifies the thing.
	var version string
	if err := p.get(ctx, "/api/version", nil, &version); err != nil {
		return nil, err
	}
	info := &ai.Info{Version: strings.TrimSpace(version)}

	var auth struct {
		IsAuthEnabled bool `json:"is_auth_enabled"`
	}
	if err := p.get(ctx, "/api/session/is-auth-enabled", nil, &auth); err == nil {
		info.AuthEnabled = auth.IsAuthEnabled
	}
	// A gateway with no logstore configured serves no /api/logs at all,
	// which is worth knowing but is not a reason to refuse the record.
	if stats, err := p.Stats(ctx, ai.RequestQuery{}); err == nil {
		info.Requests = stats.Requests
	}
	return info, nil
}

// logEntry is Bifrost's log row, narrowed to what this console shows.
//
// Latency, cost and the token counts are POINTERS because Bifrost
// omits them rather than sending zero: a request that errored before
// the model answered has no latency, and 0 ms would read as instant.
//
// COST IS A VERSION DIFFERENCE, not a missing feature. v1.6.11 records
// none per request and v2 does, so this reads the field and lets it be
// absent — the column then appears the day the gateway is upgraded,
// with nothing here to change. Until then cost arrives only in
// aggregate, from /api/logs/stats.
type logEntry struct {
	ID         string   `json:"id"`
	Timestamp  string   `json:"timestamp"`
	Provider   string   `json:"provider"`
	Model      string   `json:"model"`
	Object     string   `json:"object"`
	Status     string   `json:"status"`
	Latency    *float64 `json:"latency"`
	Cost       *float64 `json:"cost"`
	Stream     bool     `json:"stream"`
	VirtualKey string   `json:"virtual_key_name"`
	KeyName    string   `json:"selected_key_name"`
	TokenUsage *struct {
		Prompt     *int64 `json:"prompt_tokens"`
		Completion *int64 `json:"completion_tokens"`
		Total      *int64 `json:"total_tokens"`
	} `json:"token_usage"`
}

func (p *Provider) Requests(ctx context.Context, q ai.RequestQuery) (*ai.RequestPage, error) {
	var body struct {
		Logs       []logEntry `json:"logs"`
		Pagination struct {
			TotalCount int64 `json:"total_count"`
		} `json:"pagination"`
	}
	if err := p.get(ctx, "/api/logs", queryValues(q, true), &body); err != nil {
		return nil, err
	}
	page := &ai.RequestPage{
		Requests: make([]ai.Request, 0, len(body.Logs)),
		Total:    body.Pagination.TotalCount,
	}
	for _, l := range body.Logs {
		r := ai.Request{
			ID:         l.ID,
			At:         parseTime(l.Timestamp),
			Provider:   l.Provider,
			Model:      l.Model,
			Status:     l.Status,
			LatencyMS:  l.Latency,
			Cost:       l.Cost,
			Caller:     l.VirtualKey,
			Credential: l.KeyName,
			Streamed:   l.Stream,
			Kind:       l.Object,
		}
		if l.TokenUsage != nil {
			r.PromptTokens = l.TokenUsage.Prompt
			r.CompletionTokens = l.TokenUsage.Completion
			r.TotalTokens = l.TokenUsage.Total
		}
		page.Requests = append(page.Requests, r)
	}
	return page, nil
}

func (p *Provider) Stats(ctx context.Context, q ai.RequestQuery) (*ai.Stats, error) {
	// NOT the stats block inside the log response, which this lab's
	// gateway returns as all zeroes beside 473,000 requests. This
	// endpoint answers.
	var body struct {
		TotalRequests int64   `json:"total_requests"`
		SuccessRate   float64 `json:"success_rate"`
		AverageLatecy float64 `json:"average_latency"`
		TotalTokens   int64   `json:"total_tokens"`
		TotalCost     float64 `json:"total_cost"`
	}
	if err := p.get(ctx, "/api/logs/stats", queryValues(q, false), &body); err != nil {
		return nil, err
	}
	return &ai.Stats{
		Requests:    body.TotalRequests,
		SuccessRate: body.SuccessRate,
		AvgLatency:  body.AverageLatecy,
		TotalTokens: body.TotalTokens,
		Cost:        body.TotalCost,
	}, nil
}

func (p *Provider) Filters(ctx context.Context) (*ai.Filters, error) {
	var body struct {
		Models      []string `json:"models"`
		VirtualKeys []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"virtual_keys"`
	}
	if err := p.get(ctx, "/api/logs/filterdata", nil, &body); err != nil {
		return nil, err
	}
	f := &ai.Filters{Models: body.Models, Providers: []string{}, Callers: []ai.Option{}}
	for _, vk := range body.VirtualKeys {
		if vk.Name != "" {
			f.Callers = append(f.Callers, ai.Option{ID: vk.ID, Name: vk.Name})
		}
	}
	// Providers come from the gateway's own list, NOT from splitting
	// model names on a slash. That reading looked right and was wrong
	// in both directions on this lab's gateway: it invented "qwen" from
	// "qwen/…", which is a model family and not a provider Bifrost has,
	// and it missed "ollama" entirely — because a local model is named
	// "qwen2.5:7b" with no vendor in front, and ollama serves every
	// request this gateway has handled today.
	var provs struct {
		Providers []struct {
			Name string `json:"name"`
		} `json:"providers"`
	}
	if err := p.get(ctx, "/api/providers", nil, &provs); err != nil {
		return nil, err
	}
	for _, pr := range provs.Providers {
		f.Providers = append(f.Providers, pr.Name)
	}
	return f, nil
}

// queryValues maps the console's query onto Bifrost's parameters.
// withPaging is false for stats, which summarizes the whole filter and
// would be wrong to page.
func queryValues(q ai.RequestQuery, withPaging bool) url.Values {
	v := url.Values{}
	if withPaging {
		if q.Limit > 0 {
			v.Set("limit", strconv.Itoa(q.Limit))
		}
		if q.Offset > 0 {
			v.Set("offset", strconv.Itoa(q.Offset))
		}
		if q.SortBy != "" {
			v.Set("sort_by", q.SortBy)
			if q.Desc {
				v.Set("order", "desc")
			} else {
				v.Set("order", "asc")
			}
		}
	}
	setList(v, "providers", q.Providers)
	setList(v, "models", q.Models)
	setList(v, "virtual_key_ids", q.Callers)
	if q.Status != "" {
		v.Set("status", q.Status)
	}
	if !q.Since.IsZero() {
		v.Set("start_time", q.Since.UTC().Format(time.RFC3339Nano))
	}
	if !q.Until.IsZero() {
		v.Set("end_time", q.Until.UTC().Format(time.RFC3339Nano))
	}
	if q.Search != "" {
		v.Set("content_search", q.Search)
	}
	return v
}

func setList(v url.Values, key string, values []string) {
	if len(values) > 0 {
		v.Set(key, strings.Join(values, ","))
	}
}

func parseTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339Nano, s)
	return t
}

func (p *Provider) Traffic(ctx context.Context, q ai.RequestQuery) (*ai.Traffic, error) {
	var body struct {
		Overview struct {
			Requests struct {
				BucketSizeSeconds int `json:"bucket_size_seconds"`
				Buckets           []struct {
					Timestamp string `json:"timestamp"`
					Count     int64  `json:"count"`
					Success   int64  `json:"success"`
					Error     int64  `json:"error"`
					Cancelled int64  `json:"cancelled"`
				} `json:"buckets"`
			} `json:"requests"`
		} `json:"overview"`
	}
	if err := p.get(ctx, "/api/logs/dashboard", queryValues(q, false), &body); err != nil {
		return nil, err
	}
	out := &ai.Traffic{BucketSeconds: body.Overview.Requests.BucketSizeSeconds}
	for _, b := range body.Overview.Requests.Buckets {
		out.Buckets = append(out.Buckets, ai.TrafficBucket{
			At:        parseTime(b.Timestamp),
			Total:     b.Count,
			Succeeded: b.Success,
			// A cancelled request didn't get an answer either, and
			// counting it as neither would make the two series stop
			// adding up to the total.
			Failed: b.Error + b.Cancelled,
		})
	}
	// The same response carries token, cost, latency and throughput
	// buckets, and on this gateway every one of them comes back empty.
	// They are not read here: charting five blank panels beside one
	// real chart says the gateway is broken, which it isn't.
	return out, nil
}

func (p *Provider) Rankings(ctx context.Context, q ai.RequestQuery) ([]ai.ModelUsage, error) {
	var body struct {
		Rankings []struct {
			Model         string  `json:"model"`
			Provider      string  `json:"provider"`
			TotalRequests int64   `json:"total_requests"`
			SuccessCount  int64   `json:"success_count"`
			TotalTokens   int64   `json:"total_tokens"`
			TotalCost     float64 `json:"total_cost"`
			AvgLatency    float64 `json:"avg_latency"`
		} `json:"rankings"`
	}
	if err := p.get(ctx, "/api/logs/rankings", queryValues(q, true), &body); err != nil {
		return nil, err
	}
	out := make([]ai.ModelUsage, 0, len(body.Rankings))
	for _, r := range body.Rankings {
		out = append(out, ai.ModelUsage{
			Model:        r.Model,
			Provider:     r.Provider,
			Requests:     r.TotalRequests,
			Succeeded:    r.SuccessCount,
			Tokens:       r.TotalTokens,
			Cost:         r.TotalCost,
			AvgLatencyMS: r.AvgLatency,
		})
	}
	return out, nil
}
