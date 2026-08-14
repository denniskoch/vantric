// Package unifi implements network.Provider against a UniFi Network
// controller.
//
// Two generations are in the wild and this speaks both. UniFi OS
// (Dream Machine, Cloud Key gen2) serves the network app under
// /proxy/network and logs in at /api/auth/login; the older standalone
// controller has no prefix and logs in at /api/login. Which one you
// have is discovered on first use rather than configured, because
// nobody should have to know.
package unifi

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"sync"
	"time"

	"lab-cloud-manager/internal/network"
)

type Config struct {
	// BaseURL is the controller root, e.g. https://192.168.1.1 or
	// https://unifi.lan:8443.
	BaseURL string
	// Site restricts every listing to one site. Blank — the usual
	// case — spans all of them.
	Site string
	// APIKey is a local API key from Control Plane → Integrations on
	// newer controllers. When set, no login happens at all.
	APIKey string
	// Username/Password are the fallback for controllers with no API
	// key support. A read-only local admin is enough.
	Username string
	Password string
	// InsecureTLS allows the self-signed certificate a controller
	// serves by default.
	InsecureTLS bool
}

type Provider struct {
	cfg    Config
	client *http.Client

	mu sync.Mutex
	// prefix is "" for a standalone controller and "/proxy/network"
	// for UniFi OS; empty until discovered.
	prefix     string
	discovered bool
	loggedIn   bool
}

func New(cfg Config) (*Provider, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	transport := &http.Transport{}
	if cfg.InsecureTLS {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	return &Provider{
		cfg: cfg,
		client: &http.Client{
			Timeout:   20 * time.Second,
			Transport: transport,
			Jar:       jar,
		},
	}, nil
}

func (p *Provider) Type() string { return "unifi" }

// envelope is the controller's standard response wrapper.
type envelope struct {
	Meta struct {
		RC  string `json:"rc"`
		Msg string `json:"msg"`
	} `json:"meta"`
	Data json.RawMessage `json:"data"`
}

func (p *Provider) request(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method,
		strings.TrimRight(p.cfg.BaseURL, "/")+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if p.cfg.APIKey != "" {
		req.Header.Set("X-API-KEY", p.cfg.APIKey)
	}
	return p.client.Do(req)
}

// login authenticates a session. API keys skip it entirely; sessions
// are re-established when the controller expires one.
func (p *Provider) login(ctx context.Context) error {
	if p.cfg.APIKey != "" {
		return nil
	}
	if p.cfg.Username == "" {
		return fmt.Errorf("unifi: no API key or username configured")
	}
	creds := map[string]string{"username": p.cfg.Username, "password": p.cfg.Password}
	// UniFi OS first; a standalone controller 404s here and takes the
	// older path.
	for _, path := range []string{"/api/auth/login", "/api/login"} {
		resp, err := p.request(ctx, http.MethodPost, path, creds)
		if err != nil {
			return fmt.Errorf("unifi: %w", err)
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		switch {
		case resp.StatusCode < 400:
			p.loggedIn = true
			return nil
		case resp.StatusCode == http.StatusNotFound:
			continue // try the other generation
		case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusBadRequest:
			return fmt.Errorf("unifi: login rejected — check the username and password")
		default:
			return fmt.Errorf("unifi: login failed (%s): %s", resp.Status, snippet(body))
		}
	}
	return fmt.Errorf("unifi: no login endpoint answered; is this a controller URL?")
}

func snippet(body []byte) string {
	text := strings.TrimSpace(string(body))
	if len(text) > 160 {
		text = text[:160]
	}
	return text
}

// getSite calls a site-scoped endpoint.
func (p *Provider) getSite(ctx context.Context, site, endpoint string, out any) error {
	return p.get(ctx, fmt.Sprintf("/api/s/%s%s", site, endpoint), out)
}

// get calls any controller path, discovering the controller generation
// on the first call and re-authenticating once if the session lapsed.
func (p *Provider) get(ctx context.Context, endpoint string, out any) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.loggedIn && p.cfg.APIKey == "" {
		if err := p.login(ctx); err != nil {
			return err
		}
	}

	prefixes := []string{p.prefix}
	if !p.discovered {
		prefixes = []string{"/proxy/network", ""}
	}

	var lastErr error
	for _, prefix := range prefixes {
		path := prefix + endpoint
		resp, err := p.request(ctx, http.MethodGet, path, nil)
		if err != nil {
			return fmt.Errorf("unifi: %w", err)
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
		resp.Body.Close()

		if resp.StatusCode == http.StatusNotFound && !p.discovered {
			lastErr = fmt.Errorf("unifi: %s not found", path)
			continue
		}
		if resp.StatusCode == http.StatusUnauthorized && p.loggedIn {
			// The session lapsed; one retry, then give up.
			p.loggedIn = false
			if err := p.login(ctx); err != nil {
				return err
			}
			resp, err = p.request(ctx, http.MethodGet, path, nil)
			if err != nil {
				return fmt.Errorf("unifi: %w", err)
			}
			raw, _ = io.ReadAll(io.LimitReader(resp.Body, 16<<20))
			resp.Body.Close()
		}
		if resp.StatusCode >= 400 {
			return fmt.Errorf("unifi: %s (%s): %s", endpoint, resp.Status, snippet(raw))
		}

		var env envelope
		if err := json.Unmarshal(raw, &env); err != nil {
			return fmt.Errorf("unifi: decoding %s: %w", endpoint, err)
		}
		if env.Meta.RC != "" && env.Meta.RC != "ok" {
			return fmt.Errorf("unifi: %s: %s", endpoint, env.Meta.Msg)
		}
		p.prefix, p.discovered = prefix, true
		if out != nil && len(env.Data) > 0 {
			if err := json.Unmarshal(env.Data, out); err != nil {
				return fmt.Errorf("unifi: decoding %s data: %w", endpoint, err)
			}
		}
		return nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("unifi: no endpoint answered for %s", endpoint)
	}
	return lastErr
}

func (p *Provider) Verify(ctx context.Context) error {
	sites, err := p.Sites(ctx)
	if err != nil {
		return err
	}
	if len(sites) == 0 {
		return fmt.Errorf("unifi: the account can see no sites")
	}
	return nil
}

// Sites lists what this login can see. A controller with one site
// answers with one; four sites answer with four, and every listing
// below spans them.
func (p *Provider) Sites(ctx context.Context) ([]network.Site, error) {
	var res []struct {
		Name string `json:"name"`
		Desc string `json:"desc"`
	}
	if err := p.get(ctx, "/api/self/sites", &res); err != nil {
		return nil, err
	}
	sites := make([]network.Site, 0, len(res))
	for _, s := range res {
		sites = append(sites, network.Site{ID: s.Name, Name: firstNonEmpty(s.Desc, s.Name)})
	}
	return sites, nil
}

// siteIDs resolves which sites a listing covers: the one asked for,
// the one this provider is pinned to, or all of them.
func (p *Provider) siteIDs(ctx context.Context, site string) ([]network.Site, error) {
	if site == "" {
		site = p.cfg.Site
	}
	sites, err := p.Sites(ctx)
	if err != nil {
		return nil, err
	}
	if site == "" {
		return sites, nil
	}
	for _, s := range sites {
		if s.ID == site || s.Name == site {
			return []network.Site{s}, nil
		}
	}
	return nil, fmt.Errorf("unifi: no site named %q", site)
}

func (p *Provider) Info(ctx context.Context) (*network.Info, error) {
	// Every site the login can see, not just the one this connection
	// reads: a count that shrank with the pin would hide the others.
	all, err := p.Sites(ctx)
	if err != nil {
		return nil, err
	}
	sites, err := p.siteIDs(ctx, "")
	if err != nil {
		return nil, err
	}
	info := &network.Info{Sites: len(all)}
	var sysinfo []struct {
		Version string `json:"version"`
	}
	if len(sites) > 0 {
		if err := p.getSite(ctx, sites[0].ID, "/stat/sysinfo", &sysinfo); err == nil && len(sysinfo) > 0 {
			info.Version = sysinfo[0].Version
		}
	}
	if networks, err := p.Networks(ctx, ""); err == nil {
		info.Networks = len(networks)
	}
	if clients, err := p.Clients(ctx, ""); err == nil {
		info.Clients = len(clients)
	}
	if devices, err := p.Devices(ctx, ""); err == nil {
		info.Devices = len(devices)
	}
	return info, nil
}

func (p *Provider) Networks(ctx context.Context, site string) ([]network.Network, error) {
	sites, err := p.siteIDs(ctx, site)
	if err != nil {
		return nil, err
	}
	networks := []network.Network{}
	for _, s := range sites {
		found, err := p.networksIn(ctx, s)
		if err != nil {
			return nil, err
		}
		networks = append(networks, found...)
	}
	return networks, nil
}

func (p *Provider) networksIn(ctx context.Context, site network.Site) ([]network.Network, error) {
	var res []struct {
		ID          string `json:"_id"`
		Name        string `json:"name"`
		VLAN        any    `json:"vlan"` // string on some versions, number on others
		Subnet      string `json:"ip_subnet"`
		Purpose     string `json:"purpose"`
		Enabled     *bool  `json:"enabled"`
		DHCPEnabled bool   `json:"dhcpd_enabled"`
		DHCPStart   string `json:"dhcpd_start"`
		DHCPStop    string `json:"dhcpd_stop"`
		DomainName  string `json:"domain_name"`
	}
	if err := p.getSite(ctx, site.ID, "/rest/networkconf", &res); err != nil {
		return nil, err
	}
	networks := make([]network.Network, 0, len(res))
	for _, n := range res {
		enabled := true
		if n.Enabled != nil {
			enabled = *n.Enabled
		}
		networks = append(networks, network.Network{
			Site:        site.Name,
			ID:          n.ID,
			Name:        n.Name,
			VLAN:        toInt(n.VLAN),
			Subnet:      n.Subnet,
			Purpose:     n.Purpose,
			Enabled:     enabled,
			DHCPEnabled: n.DHCPEnabled,
			DHCPStart:   n.DHCPStart,
			DHCPStop:    n.DHCPStop,
			DomainName:  n.DomainName,
		})
	}
	return networks, nil
}

// toInt reads a field the controller has typed both ways over the
// years.
func toInt(value any) int {
	switch v := value.(type) {
	case float64:
		return int(v)
	case string:
		var n int
		_, _ = fmt.Sscanf(v, "%d", &n)
		return n
	}
	return 0
}

type staClient struct {
	ID          string `json:"_id"`
	MAC         string `json:"mac"`
	IP          string `json:"ip"`
	Name        string `json:"name"`
	Hostname    string `json:"hostname"`
	Network     string `json:"network"`
	VLAN        any    `json:"vlan"`
	IsWired     bool   `json:"is_wired"`
	UseFixedIP  bool   `json:"use_fixedip"`
	FixedIP     string `json:"fixed_ip"`
	LastSeen    int64  `json:"last_seen"`
	Oui         string `json:"oui"`
	SwPort      int    `json:"sw_port"`
	UplinkMAC   string `json:"sw_mac"`
	APMAC       string `json:"ap_mac"`
	DisplayName string `json:"display_name"`
}

func (c staClient) toClient(online bool, deviceNames map[string]string) network.Client {
	client := network.Client{
		ID:       c.ID,
		Name:     firstNonEmpty(c.Name, c.DisplayName, c.Hostname, c.MAC),
		Hostname: c.Hostname,
		MAC:      c.MAC,
		IP:       firstNonEmpty(c.IP, c.FixedIP),
		Network:  c.Network,
		VLAN:     toInt(c.VLAN),
		Wired:    c.IsWired,
		Online:   online,
		FixedIP:  c.UseFixedIP,
		Port:     c.SwPort,
		LastSeen: c.LastSeen,
		Vendor:   c.Oui,
	}
	if name, ok := deviceNames[firstNonEmpty(c.UplinkMAC, c.APMAC)]; ok {
		client.Uplink = name
	}
	return client
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// Clients merges what's connected now with what the controller
// remembers. An address that's reserved but powered off still occupies
// it, so a list of live sessions alone would misreport what's free.
func (p *Provider) Clients(ctx context.Context, site string) ([]network.Client, error) {
	sites, err := p.siteIDs(ctx, site)
	if err != nil {
		return nil, err
	}
	clients := []network.Client{}
	for _, s := range sites {
		found, err := p.clientsIn(ctx, s)
		if err != nil {
			return nil, err
		}
		clients = append(clients, found...)
	}
	return clients, nil
}

func (p *Provider) clientsIn(ctx context.Context, site network.Site) ([]network.Client, error) {
	deviceNames := map[string]string{}
	if devices, err := p.devicesIn(ctx, site); err == nil {
		for _, d := range devices {
			deviceNames[d.MAC] = d.Name
		}
	}

	var active []staClient
	if err := p.getSite(ctx, site.ID, "/stat/sta", &active); err != nil {
		return nil, err
	}
	clients := make([]network.Client, 0, len(active))
	seen := map[string]bool{}
	for _, c := range active {
		seen[c.MAC] = true
		client := c.toClient(true, deviceNames)
		client.Site = site.Name
		clients = append(clients, client)
	}

	// Known-but-offline clients are best effort: the endpoint is large
	// on a busy network and its absence shouldn't empty the page.
	var known []staClient
	if err := p.getSite(ctx, site.ID, "/rest/user", &known); err == nil {
		for _, c := range known {
			if seen[c.MAC] {
				continue
			}
			// Only ones that hold an address are interesting here.
			if c.UseFixedIP || c.IP != "" {
				client := c.toClient(false, deviceNames)
				client.Site = site.Name
				clients = append(clients, client)
			}
		}
	}
	return clients, nil
}

func (p *Provider) Devices(ctx context.Context, site string) ([]network.Device, error) {
	sites, err := p.siteIDs(ctx, site)
	if err != nil {
		return nil, err
	}
	devices := []network.Device{}
	for _, s := range sites {
		found, err := p.devicesIn(ctx, s)
		if err != nil {
			return nil, err
		}
		devices = append(devices, found...)
	}
	return devices, nil
}

func (p *Provider) devicesIn(ctx context.Context, site network.Site) ([]network.Device, error) {
	var res []struct {
		ID      string `json:"_id"`
		Name    string `json:"name"`
		Model   string `json:"model"`
		Type    string `json:"type"`
		MAC     string `json:"mac"`
		IP      string `json:"ip"`
		Version string `json:"version"`
		State   int    `json:"state"`
		Adopted bool   `json:"adopted"`
		Uptime  int64  `json:"uptime"`
		NumSta  int    `json:"num_sta"`
	}
	if err := p.getSite(ctx, site.ID, "/stat/device", &res); err != nil {
		return nil, err
	}
	devices := make([]network.Device, 0, len(res))
	for _, d := range res {
		devices = append(devices, network.Device{
			Site:          site.Name,
			ID:            d.ID,
			Name:          firstNonEmpty(d.Name, d.Model, d.MAC),
			Model:         d.Model,
			Kind:          deviceKind(d.Type),
			MAC:           d.MAC,
			IP:            d.IP,
			Version:       d.Version,
			State:         deviceState(d.State),
			Adopted:       d.Adopted,
			UptimeSeconds: d.Uptime,
			Clients:       d.NumSta,
		})
	}
	return devices, nil
}

// deviceKind translates UniFi's short type codes.
func deviceKind(t string) string {
	switch t {
	case "ugw", "udm", "uxg":
		return "gateway"
	case "usw":
		return "switch"
	case "uap":
		return "ap"
	case "umbb":
		return "wan backup" // cellular failover
	default:
		return t
	}
}

// deviceState is an enum; 1 is connected and 0 is not, with the rest
// meaning various flavours of "not yet".
func deviceState(state int) string {
	switch state {
	case 0:
		return "offline"
	case 1:
		return "online"
	case 2:
		return "pending adoption"
	case 4:
		return "updating"
	case 5:
		return "provisioning"
	case 6:
		return "unreachable"
	default:
		return "unknown"
	}
}
