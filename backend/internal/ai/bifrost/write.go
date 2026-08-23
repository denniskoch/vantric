package bifrost

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"vantric/internal/ai"
)

// The write half of the driver.
//
// BIFROST REPORTS ITS REFUSALS IN A BODY, NOT A STATUS. A bad payload
// comes back 400 with {"error":{"message":"Virtual key name is
// required"}}, and that sentence is the whole value of the response —
// a handler that surfaced only "400 Bad Request" would send somebody
// to read the gateway's logs to learn something it had already been
// told. So `send` unwraps it.
//
// THE PROVIDER RECORD AND ITS KEYS ARE DIFFERENT ENDPOINTS, and
// deliberately so at Bifrost's end: PUT /api/providers/{name} REFUSES
// a body carrying `keys` at all. Credentials go through
// /api/providers/{name}/keys, which is also why this driver has no
// provider update — see ai.ProviderManager.

var (
	_ ai.VirtualKeyManager = (*Provider)(nil)
	_ ai.LimitManager      = (*Provider)(nil)
	_ ai.ProviderManager   = (*Provider)(nil)
)

// send performs a write and decodes into out, which may be nil.
func (p *Provider) send(ctx context.Context, method, path string, body, out any) error {
	var payload io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, p.base+path, payload)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if p.token != "" {
		if user, pass, ok := strings.Cut(p.token, ":"); ok {
			req.Header.Set("Authorization", "Basic "+
				base64.StdEncoding.EncodeToString([]byte(user+":"+pass)))
		} else {
			req.Header.Set("Authorization", "Bearer "+p.token)
		}
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("bifrost: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusNotFound:
		return ai.ErrNotFound
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return errors.New("bifrost: the gateway refused the credential — its " +
			"management API takes the admin account, not a virtual key")
	case resp.StatusCode >= 300:
		return errors.New("bifrost: " + refusal(resp))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// refusal reads the gateway's own words out of an error body, falling
// back to the status where there are none — a truncated or empty body
// must still produce a message rather than an empty error.
func refusal(resp *http.Response) string {
	var body struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
	if json.Unmarshal(raw, &body) == nil && body.Error.Message != "" {
		return body.Error.Message
	}
	return resp.Status
}

// ---------------------------------------------------------------- keys

// vkProviderConfig is one provider a virtual key may reach.
//
// AllowAllKeys is set whenever no key is named, because the alternative
// is a config that reaches a provider through nothing: Bifrost pins a
// virtual key to specific upstream keys when key_ids is given, and an
// empty list with the flag off matches none of them.
type vkProviderConfig struct {
	Provider      string   `json:"provider"`
	AllowedModels []string `json:"allowed_models,omitempty"`
	AllowAllKeys  bool     `json:"allow_all_keys"`
}

func vkProviderConfigs(access []ai.VirtualKeyAccess) []vkProviderConfig {
	out := make([]vkProviderConfig, 0, len(access))
	for _, a := range access {
		models := a.Models
		if len(models) == 0 {
			// "*" is Bifrost's word for all of them, and omitting the
			// list entirely means something different to it.
			models = []string{"*"}
		}
		out = append(out, vkProviderConfig{
			Provider: a.Provider, AllowedModels: models, AllowAllKeys: true,
		})
	}
	return out
}

func (p *Provider) CreateVirtualKey(ctx context.Context, in ai.VirtualKeyInput) (*ai.IssuedVirtualKey, error) {
	body := map[string]any{
		"name":             in.Name,
		"is_active":        in.Active,
		"provider_configs": vkProviderConfigs(in.Access),
	}
	if in.Description != "" {
		body["description"] = in.Description
	}
	var out struct {
		VirtualKey struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			IsActive bool   `json:"is_active"`
			Value    string `json:"value"`
		} `json:"virtual_key"`
	}
	if err := p.send(ctx, http.MethodPost, "/api/governance/virtual-keys", body, &out); err != nil {
		return nil, err
	}
	return &ai.IssuedVirtualKey{
		Key: ai.VirtualKey{
			ID:     out.VirtualKey.ID,
			Name:   out.VirtualKey.Name,
			Active: out.VirtualKey.IsActive,
			Access: in.Access,
		},
		Secret: out.VirtualKey.Value,
	}, nil
}

func (p *Provider) UpdateVirtualKey(ctx context.Context, id string, in ai.VirtualKeyInput) error {
	body := map[string]any{
		"name":             in.Name,
		"description":      in.Description,
		"is_active":        in.Active,
		"provider_configs": vkProviderConfigs(in.Access),
	}
	return p.send(ctx, http.MethodPut, "/api/governance/virtual-keys/"+id, body, nil)
}

func (p *Provider) DeleteVirtualKey(ctx context.Context, id string) error {
	return p.send(ctx, http.MethodDelete, "/api/governance/virtual-keys/"+id, nil, nil)
}

// -------------------------------------------------------------- limits

// limitBody is the model-config payload both create and update take.
//
// Budgets is a LIST at Bifrost's end and one entry here: a model config
// with two budgets is a shape this console has no way to describe and
// nothing in the lab produces. Sending an empty list is how a budget is
// removed while a rate limit stays.
func limitBody(in ai.LimitInput) map[string]any {
	body := map[string]any{"model_name": orAll(in.Model)}
	if in.Provider != "" {
		body["provider"] = in.Provider
	}
	budgets := []map[string]any{}
	if in.Budget != nil {
		budgets = append(budgets, map[string]any{
			"max_limit":      in.Budget.Max,
			"reset_duration": in.Budget.Period,
		})
	}
	body["budgets"] = budgets
	if in.RateLimit != nil {
		rate := map[string]any{}
		if in.RateLimit.MaxRequests != nil {
			rate["request_max_limit"] = *in.RateLimit.MaxRequests
			rate["request_reset_duration"] = in.RateLimit.RequestPeriod
		}
		if in.RateLimit.MaxTokens != nil {
			rate["token_max_limit"] = *in.RateLimit.MaxTokens
			rate["token_reset_duration"] = in.RateLimit.TokenPeriod
		}
		body["rate_limit"] = rate
	}
	return body
}

// orAll turns a blank model pattern into the gateway's word for all of
// them, since "every model" is what an untouched field means here.
func orAll(model string) string {
	if strings.TrimSpace(model) == "" {
		return "*"
	}
	return model
}

func (p *Provider) CreateLimit(ctx context.Context, in ai.LimitInput) (*ai.Limit, error) {
	body := limitBody(in)
	body["scope"] = in.Scope
	if in.ScopeID != "" {
		body["scope_id"] = in.ScopeID
	}
	// Only the id is read back. Everything else about a cap that has
	// just been made is what was asked for, and the figures that aren't
	// — used, last reset — are zero and now by definition.
	var out struct {
		ModelConfig struct {
			ID        string `json:"id"`
			ScopeName string `json:"scope_name"`
		} `json:"model_config"`
	}
	if err := p.send(ctx, http.MethodPost, "/api/governance/model-configs", body, &out); err != nil {
		return nil, err
	}
	return &ai.Limit{
		ID:        out.ModelConfig.ID,
		Scope:     in.Scope,
		ScopeName: out.ModelConfig.ScopeName,
		Model:     orAll(in.Model),
		Budget:    in.Budget,
		RateLimit: in.RateLimit,
	}, nil
}

func (p *Provider) UpdateLimit(ctx context.Context, id string, in ai.LimitInput) error {
	// Scope is deliberately absent: Bifrost's update contract has no
	// scope field, and moving a cap from one virtual key to another is
	// a different cap rather than an edit of this one.
	return p.send(ctx, http.MethodPut, "/api/governance/model-configs/"+id, limitBody(in), nil)
}

func (p *Provider) DeleteLimit(ctx context.Context, id string) error {
	return p.send(ctx, http.MethodDelete, "/api/governance/model-configs/"+id, nil, nil)
}

func (p *Provider) ResetLimitUsage(ctx context.Context, id string) error {
	return p.send(ctx, http.MethodPut, "/api/governance/model-configs/"+id,
		map[string]any{"reset_budget_usage": true}, nil)
}

// ----------------------------------------------------------- providers

// keyBody is one upstream credential.
//
// THE SELF-HOSTED PROVIDERS TAKE AN ADDRESS, NOT AN ACCOUNT. ollama,
// vllm and sgl each carry their own *_key_config holding a url, and a
// key value means nothing to them — which is why the input has both
// fields and only one of them is ever sent.
func keyBody(provider string, in ai.GatewayKeyInput) map[string]any {
	body := map[string]any{"enabled": in.Enabled}
	if len(in.Models) > 0 {
		body["models"] = in.Models
	}
	switch provider {
	case "ollama":
		body["ollama_key_config"] = map[string]any{"url": in.URL}
	case "sgl":
		body["sgl_key_config"] = map[string]any{"url": in.URL}
	default:
		// Blank keeps: Bifrost restores the stored secret when a value
		// it recognises as its own mask comes back, and omitting the
		// field entirely leaves it alone the same way.
		if in.Value != "" {
			body["value"] = in.Value
		}
	}
	return body
}

// supportedProviders is the vendor list Bifrost will accept.
//
// IT LIVES HERE BECAUSE THE GATEWAY WON'T SAY. There is no endpoint
// for it — the names are constants in Bifrost's own schema package, and
// a provider it doesn't recognise is accepted as a RECORD and then
// refused the moment you give it a key ("unsupported provider: …"),
// which is how an inert half-provider gets left behind. So this is a
// driver knowing what its backend takes, the way factory.Types knows
// which hypervisors exist, rather than a second copy of anybody's data.
//
// IT IS A SUGGESTION, NOT A GATE. Bifrost will add vendors after this
// line was written, so nothing validates against it — the create rolls
// back instead. Offering the list is what stops a typo; the rollback is
// what makes one harmless.
var supportedProviders = []string{
	"anthropic", "azure", "bedrock", "cerebras", "cohere", "deepseek",
	"elevenlabs", "fireworks", "gemini", "groq", "huggingface", "mistral",
	"nebius", "ollama", "openai", "openrouter", "parasail", "perplexity",
	"replicate", "runware", "runway", "sarvam", "sgl", "vertex", "vllm", "xai",
}

func (p *Provider) SupportedProviders() []string { return supportedProviders }

// CreateGatewayProvider connects a vendor and gives it its first key.
//
// TWO CALLS, AND THIS ONE ROLLS BACK. Bifrost takes the provider record
// and the credential separately, and it accepts a record for a vendor
// it cannot actually serve — the refusal only arrives at the key. A
// provider with no key reaches nothing, so unlike the object store's
// access keys (where a key with no policy is still a key you can fix)
// there is nothing here worth keeping: the record goes back, and the
// error is the gateway's own sentence about why.
func (p *Provider) CreateGatewayProvider(ctx context.Context, name string, key ai.GatewayKeyInput) error {
	if err := p.send(ctx, http.MethodPost, "/api/providers",
		map[string]any{"provider": name}, nil); err != nil {
		return err
	}
	err := p.AddGatewayKey(ctx, name, key)
	if err == nil {
		return nil
	}
	if undo := p.DeleteGatewayProvider(ctx, name); undo != nil {
		return fmt.Errorf("%s was added but its key was refused (%w), and the "+
			"empty provider could not be removed either — take it out in the gateway", name, err)
	}
	return fmt.Errorf("%s was not connected: %w", name, err)
}

func (p *Provider) DeleteGatewayProvider(ctx context.Context, name string) error {
	return p.send(ctx, http.MethodDelete, "/api/providers/"+name, nil, nil)
}

func (p *Provider) AddGatewayKey(ctx context.Context, provider string, in ai.GatewayKeyInput) error {
	return p.send(ctx, http.MethodPost, "/api/providers/"+provider+"/keys",
		keyBody(provider, in), nil)
}

func (p *Provider) UpdateGatewayKey(ctx context.Context, provider, keyID string, in ai.GatewayKeyInput) error {
	return p.send(ctx, http.MethodPut, "/api/providers/"+provider+"/keys/"+keyID,
		keyBody(provider, in), nil)
}

func (p *Provider) DeleteGatewayKey(ctx context.Context, provider, keyID string) error {
	return p.send(ctx, http.MethodDelete, "/api/providers/"+provider+"/keys/"+keyID, nil, nil)
}
