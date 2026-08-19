// Package fleet implements inventory.Provider against FleetDM's REST
// API (/api/v1/fleet) using an API-only user's token.
//
// Fleet runs osquery on each machine and keeps what it finds: the
// package list, and the CVEs those package versions carry. Both are
// per host, and both arrive on the host detail endpoint, so a guest's
// OS Info costs one request.
package fleet

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"vantric/internal/inventory"
)

type Config struct {
	// BaseURL is the Fleet root, e.g. https://fleet.example.com.
	BaseURL string
	Token   string
	// InsecureTLS allows a self-signed certificate, which a
	// self-hosted instance often has.
	InsecureTLS bool
}

type Provider struct {
	cfg    Config
	client *http.Client
}

func New(cfg Config) *Provider {
	transport := &http.Transport{}
	if cfg.InsecureTLS {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	}
	return &Provider{
		cfg:    cfg,
		client: &http.Client{Timeout: 30 * time.Second, Transport: transport},
	}
}

func (p *Provider) Type() string { return "fleet" }

func (p *Provider) do(ctx context.Context, path string, out any) error {
	endpoint := strings.TrimRight(p.cfg.BaseURL, "/") + "/api/v1/fleet" + path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+p.cfg.Token)
	req.Header.Set("Accept", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("fleet: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 32<<20))

	switch {
	case resp.StatusCode == http.StatusNotFound:
		return inventory.ErrNotFound
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
		// Worth naming: Fleet issues these to browser sessions as well
		// as API tokens, and the usual cause is a token from a user
		// account rather than an API-only one.
		return fmt.Errorf("fleet: %s — the token was refused (an API-only user's token is what this needs)",
			resp.Status)
	case resp.StatusCode >= 300:
		return fmt.Errorf("fleet: GET %s: %s: %s", path, resp.Status, snippet(raw))
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("fleet: decoding %s: %w", path, err)
	}
	return nil
}

func snippet(raw []byte) string {
	text := strings.TrimSpace(string(raw))
	if len(text) > 300 {
		return text[:300] + "…"
	}
	return text
}

// --- wire types -----------------------------------------------------
//
// Only the fields this console shows are named. Fleet's host payload
// is large and grows between releases; decoding the whole of it would
// make every upgrade a change here.

type wireHost struct {
	ID              int    `json:"id"`
	Hostname        string `json:"hostname"`
	ComputerName    string `json:"computer_name"`
	UUID            string `json:"uuid"`
	HardwareSerial  string `json:"hardware_serial"`
	Platform        string `json:"platform"`
	OSVersion       string `json:"os_version"`
	Status          string `json:"status"`
	SeenTime        string `json:"seen_time"`
	DetailUpdatedAt string `json:"detail_updated_at"`
	IssuesSummary   struct {
		TotalIssuesCount int `json:"total_issues_count"`
	} `json:"issues"`
	Software []wireSoftware `json:"software"`
}

type wireSoftware struct {
	Name            string `json:"name"`
	Version         string `json:"version"`
	Source          string `json:"source"`
	Vulnerabilities []struct {
		CVE               string  `json:"cve"`
		DetailsLink       string  `json:"details_link"`
		CVSSScore         float64 `json:"cvss_score"`
		EPSSProbability   float64 `json:"epss_probability"`
		CISAKnownExploit  bool    `json:"cisa_known_exploit"`
		CVEPublished      string  `json:"cve_published"`
		ResolvedInVersion string  `json:"resolved_in_version"`
	} `json:"vulnerabilities"`
}

func (h wireHost) toHost() inventory.Host {
	name := h.Hostname
	if name == "" {
		name = h.ComputerName
	}
	return inventory.Host{
		ID:            strconv.Itoa(h.ID),
		Hostname:      name,
		UUID:          strings.ToLower(h.UUID),
		Serial:        h.HardwareSerial,
		Platform:      h.Platform,
		OSVersion:     h.OSVersion,
		Status:        h.Status,
		SeenAt:        parseTime(h.SeenTime),
		UpdatedAt:     parseTime(h.DetailUpdatedAt),
		IssuesFailing: h.IssuesSummary.TotalIssuesCount,
	}
}

// parseTime reads Fleet's RFC3339 timestamps, returning 0 for the ones
// it leaves as a zero date on hosts that have never reported.
func parseTime(value string) int64 {
	if value == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil || t.Year() < 2000 {
		return 0
	}
	return t.Unix()
}

// --- provider -------------------------------------------------------

func (p *Provider) Verify(ctx context.Context) (*inventory.Info, error) {
	var version struct {
		Version string `json:"version"`
	}
	if err := p.do(ctx, "/version", &version); err != nil {
		return nil, err
	}
	// The host count doubles as proof the token can read hosts, which
	// /version alone doesn't establish.
	var hosts struct {
		Count int `json:"count"`
	}
	if err := p.do(ctx, "/hosts/count", &hosts); err != nil {
		return nil, err
	}
	return &inventory.Info{Version: version.Version, Hosts: hosts.Count}, nil
}

func (p *Provider) Hosts(ctx context.Context) ([]inventory.Host, error) {
	var out struct {
		Hosts []wireHost `json:"hosts"`
	}
	if err := p.do(ctx, "/hosts?per_page=1000", &out); err != nil {
		return nil, err
	}
	hosts := make([]inventory.Host, 0, len(out.Hosts))
	for _, h := range out.Hosts {
		hosts = append(hosts, h.toHost())
	}
	return hosts, nil
}

// HostByUUID asks Fleet for the machine reporting this system UUID.
//
// Fleet's identifier endpoint accepts a uuid, hostname or serial, and
// the uuid is used deliberately: it's the one value the hypervisor and
// the agent both derive from the same place, so a match means the same
// machine rather than two machines with the same name.
// HostByUUID finds a machine by the SMBIOS UUID both sides can see.
//
// FLEET'S LOOKUP IS CASE-SENSITIVE AND FLEET'S CASE IS THE GUEST'S, not
// a canonical one: it stores whatever osquery reported, and osquery
// reads WMI on Windows and IOKit on macOS (uppercase) but
// /sys/class/dmi/id/product_uuid on Linux (lowercase). In this lab that
// is 7 hosts uppercase and 12 lowercase.
//
// The hypervisor reports lowercase for all of them. So a lowercase
// lookup matched every Linux guest and silently missed every Windows
// and macOS one — and it missed them by 404, which reads as "this guest
// isn't enrolled" rather than as a failed match. The console said so on
// the instance page while the Devices page, which compares in Go with
// both sides lowercased, correctly showed the very same machine as
// managed here. Two pages, one UUID, opposite answers.
//
// Trying both cases costs one extra request on a miss and none on a
// hit. Normalising to one case would only move the bug to the other
// platform, since neither case is Fleet's.
func (p *Provider) HostByUUID(ctx context.Context, uuid string) (*inventory.HostDetail, error) {
	if uuid == "" {
		return nil, inventory.ErrNotFound
	}
	tried := map[string]bool{}
	for _, candidate := range []string{uuid, strings.ToUpper(uuid), strings.ToLower(uuid)} {
		if tried[candidate] {
			continue
		}
		tried[candidate] = true
		detail, err := p.hostDetail(ctx, "/hosts/identifier/"+url.PathEscape(candidate))
		if err == nil {
			return detail, nil
		}
		// Only a miss is worth retrying in another case; an auth or
		// transport failure means the next call fails the same way.
		if !errors.Is(err, inventory.ErrNotFound) {
			return nil, err
		}
	}
	return nil, inventory.ErrNotFound
}

// HostByID is the same host by Fleet's own id, which is what a drill-in
// page carries in its URL.
func (p *Provider) HostByID(ctx context.Context, id string) (*inventory.HostDetail, error) {
	if id == "" {
		return nil, inventory.ErrNotFound
	}
	return p.hostDetail(ctx, "/hosts/"+url.PathEscape(id))
}

func (p *Provider) hostDetail(ctx context.Context, path string) (*inventory.HostDetail, error) {
	var out struct {
		Host wireHost `json:"host"`
	}
	if err := p.do(ctx, path, &out); err != nil {
		return nil, err
	}
	// Empty, not nil: these serialize into an API a browser reads, and
	// a nil slice becomes JSON null. A host with no CVEs is the common
	// case, so "null" would be the common case too — and it crashed the
	// page that trusted the contract.
	detail := &inventory.HostDetail{
		Host:            out.Host.toHost(),
		Packages:        []inventory.Package{},
		Vulnerabilities: []inventory.Vulnerability{},
	}
	for _, s := range out.Host.Software {
		pkg := inventory.Package{
			Name: s.Name, Version: s.Version, Source: s.Source,
			Vulnerabilities: []inventory.Vulnerability{},
		}
		for _, v := range s.Vulnerabilities {
			vuln := inventory.Vulnerability{
				CVE:               v.CVE,
				Package:           s.Name,
				InstalledVersion:  s.Version,
				CVSSScore:         v.CVSSScore,
				Severity:          severity(v.CVSSScore),
				EPSS:              v.EPSSProbability,
				KnownExploited:    v.CISAKnownExploit,
				ResolvedInVersion: v.ResolvedInVersion,
				PublishedAt:       parseTime(v.CVEPublished),
				DetailsURL:        v.DetailsLink,
			}
			pkg.Vulnerabilities = append(pkg.Vulnerabilities, vuln)
			detail.Vulnerabilities = append(detail.Vulnerabilities, vuln)
		}
		detail.Packages = append(detail.Packages, pkg)
	}
	return detail, nil
}

// severity puts a CVSS score into the words people sort by. Fleet
// reports the score and leaves the naming to whoever displays it;
// these are the NVD v3 bands, with "minimal" for the 0.0 case Fleet
// uses when it has no score at all.
func severity(score float64) string {
	switch {
	case score >= 9.0:
		return "CRITICAL"
	case score >= 7.0:
		return "HIGH"
	case score >= 4.0:
		return "MEDIUM"
	case score > 0:
		return "LOW"
	default:
		return "MINIMAL"
	}
}

// Vulnerabilities asks Fleet for every CVE it is tracking.
//
// This endpoint carries the interesting fields — EPSS and CISA's
// known-exploited flag — only on Fleet Premium, and older versions
// don't serve it at all. Both come back as an unsupported capability
// rather than an error, because "your Fleet doesn't do this" is a fact
// about the service and shouldn't read as a broken connection.
func (p *Provider) Vulnerabilities(ctx context.Context) ([]inventory.VulnerabilitySummary, error) {
	var out struct {
		Vulnerabilities []struct {
			CVE              string  `json:"cve"`
			HostsCount       int     `json:"hosts_count"`
			DetailsLink      string  `json:"details_link"`
			CVSSScore        float64 `json:"cvss_score"`
			EPSSProbability  float64 `json:"epss_probability"`
			CISAKnownExploit bool    `json:"cisa_known_exploit"`
			CVEPublished     string  `json:"cve_published"`
			CreatedAt        string  `json:"created_at"`
		} `json:"vulnerabilities"`
	}
	if err := p.do(ctx, "/vulnerabilities?order_key=hosts_count&order_direction=desc", &out); err != nil {
		if errors.Is(err, inventory.ErrNotFound) {
			return nil, inventory.ErrUnsupported
		}
		return nil, err
	}
	summaries := make([]inventory.VulnerabilitySummary, 0, len(out.Vulnerabilities))
	for _, v := range out.Vulnerabilities {
		summaries = append(summaries, inventory.VulnerabilitySummary{
			CVE:            v.CVE,
			Hosts:          v.HostsCount,
			CVSSScore:      v.CVSSScore,
			Severity:       severity(v.CVSSScore),
			EPSS:           v.EPSSProbability,
			KnownExploited: v.CISAKnownExploit,
			PublishedAt:    parseTime(v.CVEPublished),
			DetectedAt:     parseTime(v.CreatedAt),
			DetailsURL:     v.DetailsLink,
		})
	}
	return summaries, nil
}

// Vulnerability is one CVE in full.
//
// Two requests, because Fleet splits the answer: the CVE endpoint
// carries the software versions responsible, and the affected machines
// come from the host list filtered by the CVE. They're independent, so
// they go out together.
func (p *Provider) Vulnerability(ctx context.Context, cve string) (*inventory.VulnerabilityDetail, error) {
	if cve == "" {
		return nil, inventory.ErrNotFound
	}
	type detailBody struct {
		Vulnerability struct {
			CVE                 string  `json:"cve"`
			HostsCount          int     `json:"hosts_count"`
			DetailsLink         string  `json:"details_link"`
			CreatedAt           string  `json:"created_at"`
			HostsCountUpdatedAt string  `json:"hosts_count_updated_at"`
			CVSSScore           float64 `json:"cvss_score"`
			EPSSProbability     float64 `json:"epss_probability"`
			CISAKnownExploit    bool    `json:"cisa_known_exploit"`
			CVEPublished        string  `json:"cve_published"`
		} `json:"vulnerability"`
		Software []struct {
			Name              string `json:"name"`
			Version           string `json:"version"`
			Source            string `json:"source"`
			HostsCount        int    `json:"hosts_count"`
			ResolvedInVersion string `json:"resolved_in_version"`
		} `json:"software"`
	}

	var (
		body  detailBody
		hosts struct {
			Hosts []wireHost `json:"hosts"`
		}
		detailErr, hostsErr error
		wg                  sync.WaitGroup
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		detailErr = p.do(ctx, "/vulnerabilities/"+url.PathEscape(cve), &body)
	}()
	go func() {
		defer wg.Done()
		hostsErr = p.do(ctx, "/hosts?per_page=500&vulnerability="+url.PathEscape(cve), &hosts)
	}()
	wg.Wait()
	if detailErr != nil {
		return nil, detailErr
	}
	// A CVE that exists but whose host list failed is still worth
	// showing; the software half is the part that says what to patch.
	out := &inventory.VulnerabilityDetail{
		Summary: inventory.VulnerabilitySummary{
			CVE:            body.Vulnerability.CVE,
			Hosts:          body.Vulnerability.HostsCount,
			CVSSScore:      body.Vulnerability.CVSSScore,
			Severity:       severity(body.Vulnerability.CVSSScore),
			EPSS:           body.Vulnerability.EPSSProbability,
			KnownExploited: body.Vulnerability.CISAKnownExploit,
			PublishedAt:    parseTime(body.Vulnerability.CVEPublished),
			DetailsURL:     body.Vulnerability.DetailsLink,
		},
		Hosts:          []inventory.Host{},
		Software:       []inventory.VulnerableSoftware{},
		DetectedAt:     parseTime(body.Vulnerability.CreatedAt),
		HostsCountedAt: parseTime(body.Vulnerability.HostsCountUpdatedAt),
	}
	if out.Summary.CVE == "" {
		out.Summary.CVE = cve
	}
	for _, s := range body.Software {
		out.Software = append(out.Software, inventory.VulnerableSoftware{
			Name: s.Name, Version: s.Version, Source: s.Source,
			Hosts: s.HostsCount, ResolvedInVersion: s.ResolvedInVersion,
		})
	}
	if hostsErr == nil {
		for _, h := range hosts.Hosts {
			out.Hosts = append(out.Hosts, h.toHost())
		}
	}
	return out, nil
}
