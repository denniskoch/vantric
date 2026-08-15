// Package nvd looks a CVE up in the National Vulnerability Database.
//
// It is not a provider like the others here: there is no account, no
// credential and nothing to configure, because NVD is a public
// reference rather than a tool in the lab. It exists because the thing
// an inventory service knows — which machines carry a CVE — is only
// half the answer, and the other half (what the flaw is, how bad, and
// where the patch is) is published in one place for everybody.
//
// Two rules follow from it being a public service on the internet:
// answers are CACHED, because NVD rate-limits to a handful of requests
// a minute for anonymous callers and a console that hammered it would
// be told to go away; and a failure is NEVER fatal, because a lab
// console has to work when the internet doesn't. An enriched CVE is
// better than a bare one, and a bare one is better than an error page.
package nvd

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	endpoint = "https://services.nvd.nist.gov/rest/json/cves/2.0"
	// A CVE's description and score change rarely, and never in a way
	// that matters within a working day.
	cacheTTL = 12 * time.Hour
	// A miss is cached too, briefly: a CVE NVD hasn't published yet
	// shouldn't mean a request per page view.
	missTTL = 15 * time.Minute
	// Short on purpose. This is enrichment; the page must not wait on
	// it, and NVD is occasionally slow.
	timeout = 6 * time.Second
)

// Metric is one CVSS scoring of the flaw. NVD carries several — its
// own analysis and the vendor's, in different versions of the standard
// — and they disagree often enough that showing which is which matters
// more than picking a winner.
type Metric struct {
	Version  string  `json:"version"`
	Score    float64 `json:"score"`
	Severity string  `json:"severity"`
	Vector   string  `json:"vector"`
	Source   string  `json:"source"`
	// Primary marks NVD's own analysis, as opposed to the vendor's.
	Primary bool `json:"primary"`
}

type Reference struct {
	URL  string   `json:"url"`
	Tags []string `json:"tags"`
}

// Record is what NVD says about a CVE.
type Record struct {
	CVE         string `json:"cve"`
	Description string `json:"description"`
	// Published and LastModified are unix seconds.
	Published    int64       `json:"published"`
	LastModified int64       `json:"lastModified"`
	Metrics      []Metric    `json:"metrics"`
	Weaknesses   []string    `json:"weaknesses"`
	References   []Reference `json:"references"`
}

type entry struct {
	record  *Record
	fetched time.Time
}

type Client struct {
	http  *http.Client
	mu    sync.Mutex
	cache map[string]entry
	// apiKey raises NVD's rate limit from a handful a minute to about
	// fifty per thirty seconds. Held here rather than in config because
	// it's a credential for an outside service, and this console keeps
	// those in the database where they can be changed without a
	// redeploy.
	apiKey string
}

func (c *Client) SetAPIKey(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.apiKey = key
}

func (c *Client) HasAPIKey() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.apiKey != ""
}

func New() *Client {
	return &Client{
		http:  &http.Client{Timeout: timeout},
		cache: map[string]entry{},
	}
}

// Lookup returns what NVD holds on a CVE, or nil when it holds nothing
// and nil-with-error when it couldn't be asked. Callers are expected to
// carry on either way.
func (c *Client) Lookup(ctx context.Context, cve string) (*Record, error) {
	cve = strings.ToUpper(strings.TrimSpace(cve))
	if !strings.HasPrefix(cve, "CVE-") {
		return nil, nil
	}
	if record, ok := c.cached(cve); ok {
		return record, nil
	}
	record, err := c.fetch(ctx, cve)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.cache[cve] = entry{record: record, fetched: time.Now()}
	c.mu.Unlock()
	return record, nil
}

func (c *Client) cached(cve string) (*Record, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	found, ok := c.cache[cve]
	if !ok {
		return nil, false
	}
	ttl := cacheTTL
	if found.record == nil {
		ttl = missTTL
	}
	if time.Since(found.fetched) > ttl {
		delete(c.cache, cve)
		return nil, false
	}
	return found.record, true
}

func (c *Client) fetch(ctx context.Context, cve string) (*Record, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?cveIds="+cve, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	c.mu.Lock()
	key := c.apiKey
	c.mu.Unlock()
	if key != "" {
		req.Header.Set("apiKey", key)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("nvd: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return nil, nil
	case resp.StatusCode == http.StatusForbidden, resp.StatusCode == http.StatusTooManyRequests:
		// NVD's answer to an anonymous caller asking too often. Worth
		// naming, since the fix is patience or an API key rather than
		// anything about this console.
		return nil, fmt.Errorf("nvd: %s — rate limited (anonymous callers get a few requests a minute)", resp.Status)
	case resp.StatusCode >= 300:
		return nil, fmt.Errorf("nvd: %s", resp.Status)
	}

	var body struct {
		Vulnerabilities []struct {
			CVE struct {
				ID           string `json:"id"`
				Published    string `json:"published"`
				LastModified string `json:"lastModified"`
				Descriptions []struct {
					Lang  string `json:"lang"`
					Value string `json:"value"`
				} `json:"descriptions"`
				Metrics    map[string][]json.RawMessage `json:"metrics"`
				Weaknesses []struct {
					Description []struct {
						Value string `json:"value"`
					} `json:"description"`
				} `json:"weaknesses"`
				References []Reference `json:"references"`
			} `json:"cve"`
		} `json:"vulnerabilities"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, fmt.Errorf("nvd: decoding: %w", err)
	}
	if len(body.Vulnerabilities) == 0 {
		return nil, nil
	}
	v := body.Vulnerabilities[0].CVE

	record := &Record{
		CVE:          v.ID,
		Published:    parseTime(v.Published),
		LastModified: parseTime(v.LastModified),
		References:   v.References,
	}
	for _, d := range v.Descriptions {
		if d.Lang == "en" {
			record.Description = d.Value
			break
		}
	}
	for _, w := range v.Weaknesses {
		for _, d := range w.Description {
			if strings.HasPrefix(d.Value, "CWE-") {
				record.Weaknesses = append(record.Weaknesses, d.Value)
			}
		}
	}
	record.Metrics = readMetrics(v.Metrics)
	return record, nil
}

// readMetrics flattens NVD's per-version metric arrays. The key names
// the CVSS version (cvssMetricV31, cvssMetricV40 …) and anything
// without a score — SSVC decision points, say — is skipped rather than
// rendered as a zero.
func readMetrics(metrics map[string][]json.RawMessage) []Metric {
	var out []Metric
	for key, entries := range metrics {
		if !strings.HasPrefix(key, "cvssMetric") {
			continue
		}
		for _, raw := range entries {
			var m struct {
				Source   string `json:"source"`
				Type     string `json:"type"`
				CVSSData struct {
					Version      string  `json:"version"`
					BaseScore    float64 `json:"baseScore"`
					BaseSeverity string  `json:"baseSeverity"`
					VectorString string  `json:"vectorString"`
				} `json:"cvssData"`
			}
			if json.Unmarshal(raw, &m) != nil || m.CVSSData.BaseScore == 0 {
				continue
			}
			out = append(out, Metric{
				Version:  m.CVSSData.Version,
				Score:    m.CVSSData.BaseScore,
				Severity: m.CVSSData.BaseSeverity,
				Vector:   m.CVSSData.VectorString,
				Source:   m.Source,
				Primary:  m.Type == "Primary",
			})
		}
	}
	// NVD's own analysis first, then the newest standard: the headline
	// score should be the one most tools quote.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Primary != out[j].Primary {
			return out[i].Primary
		}
		return out[i].Version > out[j].Version
	})
	return out
}

func parseTime(value string) int64 {
	if value == "" {
		return 0
	}
	// NVD stamps without a zone, in UTC.
	for _, layout := range []string{"2006-01-02T15:04:05.000", "2006-01-02T15:04:05", time.RFC3339} {
		if t, err := time.Parse(layout, value); err == nil {
			return t.Unix()
		}
	}
	return 0
}
