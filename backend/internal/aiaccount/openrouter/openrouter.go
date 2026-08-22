// Package openrouter reads an OpenRouter account's credit balance.
//
// TWO KEYS, AND THE WRONG ONE IS THE EXPECTED MISTAKE. The balance
// lives at /api/v1/credits and needs a MANAGEMENT key, made at
// openrouter.ai/settings/management-keys. An ordinary sk-or-v1 key —
// the one already in the gateway — gets a 403 saying only management
// keys may do this. A management key in turn cannot call completions,
// so this is genuinely a second credential rather than a second use of
// the first.
//
// There is also /api/v1/key, which an inference key CAN read, and it
// is deliberately not used for the balance: its limit_remaining is
// that key's own spending cap, and it is null on an uncapped key —
// which is most of them. Wiring a balance to it would report
// "unlimited" for an account that is nearly empty.
package openrouter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"vantric/internal/aiaccount"
)

const baseURL = "https://openrouter.ai/api/v1"

type Config struct {
	Key string
}

type Provider struct {
	key    string
	client *http.Client
}

func New(cfg Config) *Provider {
	return &Provider{
		key:    strings.TrimSpace(cfg.Key),
		client: &http.Client{Timeout: 20 * time.Second},
	}
}

func (p *Provider) Name() string { return "openrouter" }

func (p *Provider) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+p.key)
	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("openrouter: GET %s: %w", path, err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		return errors.New("openrouter: the key was rejected")
	case resp.StatusCode == http.StatusForbidden:
		// The specific mistake this endpoint invites, named rather than
		// reported as a bare 403.
		return errors.New("openrouter: this needs a MANAGEMENT key, not an " +
			"inference key — make one at openrouter.ai/settings/management-keys")
	case resp.StatusCode >= 300:
		return fmt.Errorf("openrouter: GET %s: %s", path, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (p *Provider) Check(ctx context.Context) (*aiaccount.Info, error) {
	// Checking with the balance call itself, because a key that reads
	// the balance is exactly what this account is for — a credential
	// that passes a lighter check and then can't answer the one
	// question is a credential stored for nothing.
	if _, err := p.Balance(ctx); err != nil {
		return nil, err
	}
	return &aiaccount.Info{}, nil
}

func (p *Provider) Balance(ctx context.Context) (*aiaccount.Balance, error) {
	var body struct {
		Data struct {
			TotalCredits float64 `json:"total_credits"`
			TotalUsage   float64 `json:"total_usage"`
		} `json:"data"`
	}
	if err := p.get(ctx, "/credits", &body); err != nil {
		return nil, err
	}
	// OpenRouter reports what was bought and what was used; remaining
	// is the subtraction, and it is the number anybody actually wants.
	remaining := body.Data.TotalCredits - body.Data.TotalUsage
	return &aiaccount.Balance{
		Kind:      aiaccount.KindCredits,
		Unit:      "USD",
		Remaining: &remaining,
		Used:      body.Data.TotalUsage,
		Granted:   body.Data.TotalCredits,
		AsOf:      time.Now(),
	}, nil
}
