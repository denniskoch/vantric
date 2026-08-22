// Package elevenlabs reads an ElevenLabs subscription's remaining
// allowance.
//
// NOT MONEY. ElevenLabs meters CHARACTERS over a billing period, so
// what comes back is a quota rather than a balance — the difference
// the Balance.Kind field exists for. Reporting it as dollars would be
// a number nobody could act on.
//
// It authenticates with an `xi-api-key` header rather than a bearer,
// and an ordinary key reads it — though a key with restricted scopes
// may not.
package elevenlabs

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

const subscriptionURL = "https://api.elevenlabs.io/v1/user/subscription"

type Config struct{ Key string }

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

func (p *Provider) Name() string { return "elevenlabs" }

func (p *Provider) Check(ctx context.Context) (*aiaccount.Info, error) {
	if _, err := p.Balance(ctx); err != nil {
		return nil, err
	}
	return &aiaccount.Info{}, nil
}

func (p *Provider) Balance(ctx context.Context) (*aiaccount.Balance, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, subscriptionURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("xi-api-key", p.key)
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("elevenlabs: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, errors.New("elevenlabs: the key was rejected — a key with " +
			"restricted scopes may not be allowed to read the subscription")
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("elevenlabs: %s", resp.Status)
	}
	var body struct {
		CharacterCount int64 `json:"character_count"`
		CharacterLimit int64 `json:"character_limit"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	remaining := float64(body.CharacterLimit - body.CharacterCount)
	return &aiaccount.Balance{
		Kind:      aiaccount.KindQuota,
		Unit:      "characters",
		Remaining: &remaining,
		Used:      float64(body.CharacterCount),
		Granted:   float64(body.CharacterLimit),
		AsOf:      time.Now(),
	}, nil
}
