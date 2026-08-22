// Package zabbix implements monitoring.Provider against Zabbix's
// JSON-RPC API (version 8; Bearer tokens).
//
// TWO THINGS ABOUT THIS API ARE TRAPS, both verified against a real
// server rather than read from docs.
//
// EVERY VALUE IS A STRING. severity is "2", clock is "1787353326",
// status is "0" — a struct with an int field fails to decode the first
// real row. Everything here decodes strings and parses.
//
// THE ENDPOINT PREFIX VARIES. This lab serves api_jsonrpc.php under
// /zabbix/, other installs serve it at the root, and the root of this
// one answers 404. The prefix is DISCOVERED on first use rather than
// configured — the same rule as UniFi's two generations — so the form
// takes the address people actually know.
package zabbix

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"vantric/internal/monitoring"
)

// severityWords is Zabbix's own vocabulary, indexed by its numeric
// severity. The words travel as-is; inventing our own would be
// deciding what Zabbix meant.
var severityWords = [...]string{
	"Not classified", "Information", "Warning", "Average", "High", "Disaster",
}

type Config struct {
	BaseURL     string
	Token       string
	InsecureTLS bool
}

type Provider struct {
	base   string
	token  string
	client *http.Client

	// endpoint is resolved once from the candidates below.
	mu       sync.Mutex
	endpoint string
}

func New(cfg Config) *Provider {
	transport := http.DefaultTransport
	if cfg.InsecureTLS {
		transport = &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
	}
	return &Provider{
		base:  strings.TrimRight(cfg.BaseURL, "/"),
		token: strings.TrimSpace(cfg.Token),
		client: &http.Client{
			Timeout:   20 * time.Second,
			Transport: transport,
		},
	}
}

func (p *Provider) Name() string { return "zabbix" }

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

func (e *rpcError) Error() string {
	if e.Data != "" {
		return fmt.Sprintf("zabbix: %s: %s", e.Message, e.Data)
	}
	return "zabbix: " + e.Message
}

// candidates are the endpoints an install may serve the API at. The
// bare path first: it is the documented default, and a 404 there is
// cheap.
func (p *Provider) candidates() []string {
	c := []string{p.base + "/api_jsonrpc.php"}
	if !strings.HasSuffix(p.base, "/zabbix") {
		c = append(c, p.base+"/zabbix/api_jsonrpc.php")
	}
	return c
}

func (p *Provider) rpc(ctx context.Context, method string, params any, out any) error {
	p.mu.Lock()
	resolved := p.endpoint
	p.mu.Unlock()

	endpoints := p.candidates()
	if resolved != "" {
		endpoints = []string{resolved}
	}

	var lastErr error
	for _, endpoint := range endpoints {
		err := p.call(ctx, endpoint, method, params, out)
		// An RPC-level error means the endpoint IS the API — the token
		// or the request is what's wrong, and trying another path would
		// hide that behind a second, stranger failure.
		var rpcErr *rpcError
		if err == nil || errors.As(err, &rpcErr) {
			p.mu.Lock()
			p.endpoint = endpoint
			p.mu.Unlock()
			return err
		}
		lastErr = err
	}
	return lastErr
}

func (p *Provider) call(ctx context.Context, endpoint, method string, params, out any) error {
	body, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0", "method": method, "params": params, "id": 1,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json-rpc")
	// apiinfo.version REFUSES a token ("cannot be called with
	// authorization"), so the header is sent only where auth belongs.
	if p.token != "" && method != "apiinfo.version" {
		req.Header.Set("Authorization", "Bearer "+p.token)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("zabbix: %s: %w", method, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("zabbix: %s at %s: %s", method, endpoint, resp.Status)
	}
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  *rpcError       `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return fmt.Errorf("zabbix: %s at %s: not the API: %w", method, endpoint, err)
	}
	if envelope.Error != nil {
		return envelope.Error
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(envelope.Result, out)
}

func (p *Provider) Check(ctx context.Context) (*monitoring.Info, error) {
	var version string
	if err := p.rpc(ctx, "apiinfo.version", map[string]any{}, &version); err != nil {
		return nil, err
	}
	// The version endpoint is unauthenticated, so it proves the address
	// and not the token. Counting hosts proves the token — and is the
	// number that says whether this is the right service.
	var count string
	if err := p.rpc(ctx, "host.get", map[string]any{"countOutput": true}, &count); err != nil {
		return nil, err
	}
	hosts, _ := strconv.Atoi(count)
	return &monitoring.Info{Version: version, Hosts: hosts}, nil
}

func (p *Provider) Problems(ctx context.Context) ([]monitoring.Problem, error) {
	var rows []struct {
		EventID      string `json:"eventid"`
		Name         string `json:"name"`
		Severity     string `json:"severity"`
		Clock        string `json:"clock"`
		Acknowledged string `json:"acknowledged"`
		Suppressed   string `json:"suppressed"`
	}
	if err := p.rpc(ctx, "problem.get", map[string]any{
		"output":    []string{"eventid", "name", "severity", "clock", "acknowledged", "suppressed"},
		"sortfield": []string{"eventid"},
		"sortorder": "DESC",
	}, &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []monitoring.Problem{}, nil
	}

	// The host behind each problem comes from event.get with
	// selectHosts — deliberately, because it stays inside the API
	// allow-list this console documents (host.get, problem.get,
	// event.get). The textbook join via trigger.get would demand a
	// fourth method for the same answer.
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.EventID)
	}
	hosts := map[string]monitoring.Host{}
	var events []struct {
		EventID string `json:"eventid"`
		Hosts   []struct {
			HostID string `json:"hostid"`
			Name   string `json:"name"`
		} `json:"hosts"`
	}
	if err := p.rpc(ctx, "event.get", map[string]any{
		"eventids": ids, "output": []string{"eventid"}, "selectHosts": []string{"hostid", "name"},
	}, &events); err != nil {
		return nil, err
	}
	for _, e := range events {
		if len(e.Hosts) > 0 {
			hosts[e.EventID] = monitoring.Host{ID: e.Hosts[0].HostID, Name: e.Hosts[0].Name}
		}
	}

	out := make([]monitoring.Problem, 0, len(rows))
	for _, r := range rows {
		rank, _ := strconv.Atoi(r.Severity)
		word := "Not classified"
		if rank >= 0 && rank < len(severityWords) {
			word = severityWords[rank]
		}
		clock, _ := strconv.ParseInt(r.Clock, 10, 64)
		problem := monitoring.Problem{
			ID: r.EventID, Name: r.Name,
			Severity: word, Rank: rank,
			StartedAt:    time.Unix(clock, 0),
			Acknowledged: r.Acknowledged == "1",
			Suppressed:   r.Suppressed == "1",
		}
		if h, ok := hosts[r.EventID]; ok {
			problem.HostID, problem.Host = h.ID, h.Name
		}
		out = append(out, problem)
	}
	return out, nil
}

func (p *Provider) Hosts(ctx context.Context) ([]monitoring.Host, error) {
	var rows []struct {
		HostID     string `json:"hostid"`
		Name       string `json:"name"`
		Status     string `json:"status"`
		Interfaces []struct {
			IP  string `json:"ip"`
			DNS string `json:"dns"`
		} `json:"interfaces"`
	}
	if err := p.rpc(ctx, "host.get", map[string]any{
		"output": []string{"hostid", "name", "status"}, "selectInterfaces": []string{"ip", "dns"},
	}, &rows); err != nil {
		return nil, err
	}
	out := make([]monitoring.Host, 0, len(rows))
	for _, r := range rows {
		host := monitoring.Host{
			ID: r.HostID, Name: r.Name,
			// Zabbix's status 0 is monitored; 1 is disabled. Backwards
			// from every other API here, which is exactly why it's
			// spelled out.
			Enabled:   r.Status == "0",
			Addresses: []string{},
		}
		for _, iface := range r.Interfaces {
			for _, addr := range []string{iface.IP, iface.DNS} {
				if addr != "" {
					host.Addresses = append(host.Addresses, addr)
				}
			}
		}
		out = append(out, host)
	}
	return out, nil
}
