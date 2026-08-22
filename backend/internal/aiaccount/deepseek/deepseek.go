// Package deepseek reads a DeepSeek account's balance.
//
// The simplest of them: one endpoint, and the ORDINARY inference key
// reads it — no second credential, unlike OpenRouter and xAI. The
// figures arrive as strings, and the currency is DeepSeek's own, which
// may be CNY rather than dollars.
package deepseek

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"vantric/internal/aiaccount"
)

const balanceURL = "https://api.deepseek.com/user/balance"

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

func (p *Provider) Name() string { return "deepseek" }

func (p *Provider) Check(ctx context.Context) (*aiaccount.Info, error) {
	if _, err := p.Balance(ctx); err != nil {
		return nil, err
	}
	return &aiaccount.Info{}, nil
}

func (p *Provider) Balance(ctx context.Context) (*aiaccount.Balance, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, balanceURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.key)
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("deepseek: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, errors.New("deepseek: the key was rejected")
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("deepseek: %s", resp.Status)
	}
	var body struct {
		IsAvailable  bool `json:"is_available"`
		BalanceInfos []struct {
			Currency       string `json:"currency"`
			TotalBalance   string `json:"total_balance"`
			GrantedBalance string `json:"granted_balance"`
		} `json:"balance_infos"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	if len(body.BalanceInfos) == 0 {
		return nil, aiaccount.ErrUnsupported
	}
	// The first entry, not a sum: DeepSeek reports per currency, and
	// adding CNY to USD would produce a number that is wrong in both.
	info := body.BalanceInfos[0]
	total := parseAmount(info.TotalBalance)
	granted := parseAmount(info.GrantedBalance)
	return &aiaccount.Balance{
		Kind:      aiaccount.KindCredits,
		Unit:      info.Currency,
		Remaining: &total,
		// DeepSeek says what is left and what was granted, never what
		// was spent. Used is derived where both are known and left at
		// zero otherwise, rather than inventing a subtraction.
		Used:    max(0, granted-total),
		Granted: granted,
		AsOf:    time.Now(),
	}, nil
}

func parseAmount(s string) float64 {
	v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return v
}
