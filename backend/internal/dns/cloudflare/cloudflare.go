// Package cloudflare implements dns.Provider against the Cloudflare
// API v4 using an API token.
package cloudflare

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"lab-cloud-manager/internal/dns"
)

const apiBase = "https://api.cloudflare.com/client/v4"

type Config struct {
	// Token is a scoped API token (not a global API key).
	Token string
	// AccountID is optional; it defaults the account new zones go into.
	AccountID string
}

type Driver struct {
	cfg    Config
	client *http.Client
}

func New(cfg Config) *Driver {
	return &Driver{cfg: cfg, client: &http.Client{Timeout: 20 * time.Second}}
}

func (d *Driver) Type() string { return "cloudflare" }

// envelope is Cloudflare's standard response wrapper. A 200 with
// success:false is a real failure, so errors are read from the body
// rather than the status code alone.
type envelope struct {
	Success bool            `json:"success"`
	Errors  []cfError       `json:"errors"`
	Result  json.RawMessage `json:"result"`
	Info    struct {
		Page       int `json:"page"`
		TotalPages int `json:"total_pages"`
	} `json:"result_info"`
}

type cfError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e envelope) err(path string) error {
	if len(e.Errors) == 0 {
		return fmt.Errorf("cloudflare: %s failed", path)
	}
	msgs := make([]string, 0, len(e.Errors))
	for _, err := range e.Errors {
		msgs = append(msgs, fmt.Sprintf("%s (%d)", err.Message, err.Code))
	}
	return fmt.Errorf("cloudflare: %s: %s", path, strings.Join(msgs, "; "))
}

func (d *Driver) do(ctx context.Context, method, path string, body any, out any) (*envelope, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, apiBase+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+d.cfg.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, fmt.Errorf("cloudflare: decoding %s (%s): %w", path, resp.Status, err)
	}
	if !env.Success {
		return &env, env.err(path)
	}
	if out != nil && len(env.Result) > 0 {
		if err := json.Unmarshal(env.Result, out); err != nil {
			return &env, fmt.Errorf("cloudflare: decoding %s result: %w", path, err)
		}
	}
	return &env, nil
}

// Verify checks the token can do what this app needs.
//
// /user/tokens/verify only answers for user-owned tokens: an
// account-owned token is verified under its account and fails that
// call even though it works fine. So a failure there falls back to
// listing zones, which is the capability actually required — if that
// succeeds the token is good regardless of which kind it is.
func (d *Driver) Verify(ctx context.Context) error {
	var res struct {
		Status string `json:"status"`
	}
	verifyErr := func() error {
		if _, err := d.do(ctx, http.MethodGet, "/user/tokens/verify", nil, &res); err != nil {
			return err
		}
		if res.Status != "active" {
			return fmt.Errorf("cloudflare: token status is %q", res.Status)
		}
		return nil
	}()
	if verifyErr == nil {
		return nil
	}
	if _, err := d.do(ctx, http.MethodGet, "/zones?per_page=1", nil, nil); err != nil {
		// Report both: the second error is usually the informative one
		// (bad token vs a token that simply can't read zones).
		return fmt.Errorf("%w; listing zones also failed: %v", verifyErr, err)
	}
	return nil
}

func (d *Driver) Accounts(ctx context.Context) ([]dns.Account, error) {
	var res []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if _, err := d.do(ctx, http.MethodGet, "/accounts?per_page=50", nil, &res); err != nil {
		return nil, err
	}
	accounts := make([]dns.Account, 0, len(res))
	for _, a := range res {
		accounts = append(accounts, dns.Account{ID: a.ID, Name: a.Name})
	}
	return accounts, nil
}

// cfZone is Cloudflare's zone shape.
type cfZone struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Status      string   `json:"status"`
	Paused      bool     `json:"paused"`
	Type        string   `json:"type"`
	NameServers []string `json:"name_servers"`
	CreatedOn   string   `json:"created_on"`
	Account     struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"account"`
}

func (z cfZone) toZone() dns.Zone {
	zone := dns.Zone{
		ID:          z.ID,
		Name:        z.Name,
		Status:      z.Status,
		Nameservers: z.NameServers,
		AccountID:   z.Account.ID,
		AccountName: z.Account.Name,
		Type:        z.Type,
		Paused:      z.Paused,
	}
	if t, err := time.Parse(time.RFC3339, z.CreatedOn); err == nil {
		zone.CreatedAt = t.Unix()
	}
	return zone
}

// Zones lists every zone the token can see, following pagination.
func (d *Driver) Zones(ctx context.Context) ([]dns.Zone, error) {
	zones := []dns.Zone{}
	for page := 1; ; page++ {
		var res []cfZone
		path := fmt.Sprintf("/zones?per_page=50&page=%d", page)
		env, err := d.do(ctx, http.MethodGet, path, nil, &res)
		if err != nil {
			return nil, err
		}
		for _, z := range res {
			zones = append(zones, z.toZone())
		}
		if env.Info.TotalPages <= page || len(res) == 0 {
			break
		}
	}
	return zones, nil
}

func (d *Driver) Zone(ctx context.Context, zoneID string) (*dns.Zone, error) {
	var res cfZone
	if _, err := d.do(ctx, http.MethodGet, "/zones/"+zoneID, nil, &res); err != nil {
		return nil, err
	}
	zone := res.toZone()
	return &zone, nil
}

// cfRecord is Cloudflare's DNS record shape.
type cfRecord struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Content  string `json:"content"`
	TTL      int    `json:"ttl"`
	Priority int    `json:"priority"`
	Proxied  bool   `json:"proxied"`
	Comment  string `json:"comment"`
}

func (r cfRecord) toRecord() dns.Record {
	return dns.Record{
		ID:       r.ID,
		Name:     r.Name,
		Type:     r.Type,
		Content:  r.Content,
		TTL:      r.TTL,
		Priority: r.Priority,
		Proxied:  r.Proxied,
		Comment:  r.Comment,
	}
}

// Records lists every record in a zone, following pagination.
func (d *Driver) Records(ctx context.Context, zoneID string) ([]dns.Record, error) {
	records := []dns.Record{}
	for page := 1; ; page++ {
		var res []cfRecord
		path := fmt.Sprintf("/zones/%s/dns_records?per_page=100&page=%d", zoneID, page)
		env, err := d.do(ctx, http.MethodGet, path, nil, &res)
		if err != nil {
			return nil, err
		}
		for _, r := range res {
			records = append(records, r.toRecord())
		}
		if env.Info.TotalPages <= page || len(res) == 0 {
			break
		}
	}
	return records, nil
}

// recordBody builds the write payload. Cloudflare rejects fields that
// don't apply to a type — priority only means something for MX and
// SRV, proxying only for the types it can proxy — so each is sent only
// where it belongs.
func recordBody(spec dns.RecordSpec) map[string]any {
	ttl := spec.TTL
	if ttl <= 0 {
		ttl = 1 // 1 is Cloudflare's "automatic"
	}
	body := map[string]any{
		"name":    spec.Name,
		"type":    spec.Type,
		"content": spec.Content,
		"ttl":     ttl,
	}
	switch spec.Type {
	case "MX", "SRV", "URI":
		body["priority"] = spec.Priority
	}
	switch spec.Type {
	case "A", "AAAA", "CNAME":
		body["proxied"] = spec.Proxied
	}
	if spec.Comment != "" {
		body["comment"] = spec.Comment
	}
	return body
}

func (d *Driver) CreateRecord(ctx context.Context, zoneID string, spec dns.RecordSpec) (*dns.Record, error) {
	var res cfRecord
	path := "/zones/" + zoneID + "/dns_records"
	if _, err := d.do(ctx, http.MethodPost, path, recordBody(spec), &res); err != nil {
		return nil, err
	}
	record := res.toRecord()
	return &record, nil
}

func (d *Driver) UpdateRecord(ctx context.Context, zoneID, recordID string, spec dns.RecordSpec) (*dns.Record, error) {
	var res cfRecord
	path := "/zones/" + zoneID + "/dns_records/" + recordID
	if _, err := d.do(ctx, http.MethodPut, path, recordBody(spec), &res); err != nil {
		return nil, err
	}
	record := res.toRecord()
	return &record, nil
}

func (d *Driver) DeleteRecord(ctx context.Context, zoneID, recordID string) error {
	_, err := d.do(ctx, http.MethodDelete, "/zones/"+zoneID+"/dns_records/"+recordID, nil, nil)
	return err
}

func (d *Driver) CreateZone(ctx context.Context, spec dns.ZoneSpec) (*dns.Zone, error) {
	accountID := spec.AccountID
	if accountID == "" {
		accountID = d.cfg.AccountID
	}
	if accountID == "" {
		return nil, fmt.Errorf("cloudflare: an account is required to create a zone")
	}
	zoneType := spec.Type
	if zoneType == "" {
		zoneType = "full"
	}
	body := map[string]any{
		"name":    spec.Name,
		"type":    zoneType,
		"account": map[string]string{"id": accountID},
	}
	var res cfZone
	if _, err := d.do(ctx, http.MethodPost, "/zones", body, &res); err != nil {
		return nil, err
	}
	zone := res.toZone()
	return &zone, nil
}

func (d *Driver) DeleteZone(ctx context.Context, zoneID string) error {
	_, err := d.do(ctx, http.MethodDelete, "/zones/"+zoneID, nil, nil)
	return err
}
