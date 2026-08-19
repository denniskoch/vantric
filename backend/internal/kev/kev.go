// Package kev reads CISA's Known Exploited Vulnerabilities catalogue —
// the list of CVEs someone is actually using against real systems.
//
// It is a client and a cache rather than a provider, for the same
// reason internal/nvd is: this is a PUBLIC REFERENCE, not a tool in the
// lab. No account, no credential, nothing to configure, and one file
// that anybody can fetch.
//
// Why it isn't taken from the inventory service, which has a field for
// it: that field is gated behind a paid tier and arrives empty here, so
// a column wired to it would read "no" for every CVE in the estate —
// the most confident kind of wrong answer, on the one question where
// "no" means "don't worry about this one". The catalogue is the
// authority anyway; asking it directly is both cheaper and truer.
//
// Why the whole file rather than NVD's per-CVE cisaExploitAdd: the
// catalogue is one request for everything, so it is complete the moment
// it lands. NVD's copy is just as good but arrives one CVE at a time,
// as the enricher works through the estate, which would mean a badge
// that fills in gradually and can't be trusted until it stops.
package kev

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// Feed is CISA's published catalogue. Unauthenticated, and about 1.6 MB.
const Feed = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"

// refreshAfter is how long a fetched catalogue is trusted. CISA
// publishes daily; half a day keeps it current without making the page
// wait on a network call it usually doesn't need.
const refreshAfter = 12 * time.Hour

// Entry is one catalogue record. The name is the reason to show any of
// this — "Apache Log4j2 Remote Code Execution Vulnerability" says in
// six words what a CVE id says in none.
type Entry struct {
	CVE               string `json:"cve"`
	VendorProject     string `json:"vendorProject"`
	Product           string `json:"product"`
	VulnerabilityName string `json:"vulnerabilityName"`
	// DateAdded and DueDate are the catalogue's own dates, unix seconds.
	// DueDate is the federal remediation deadline: not binding on a home
	// lab, and a useful sense of how urgent CISA thought this was.
	DateAdded int64 `json:"dateAdded"`
	DueDate   int64 `json:"dueDate"`
	// KnownRansomware is CISA's own "Known" / "Unknown" reduced to a
	// bool: whether this has been seen in ransomware campaigns.
	KnownRansomware bool   `json:"knownRansomware"`
	RequiredAction  string `json:"requiredAction"`
}

type Client struct {
	http *http.Client

	mu        sync.RWMutex
	entries   map[string]Entry
	fetchedAt time.Time
	// lastErr is kept so a caller can say why the catalogue is empty
	// rather than implying nothing is exploited.
	lastErr error
}

func New() *Client {
	return &Client{
		http:    &http.Client{Timeout: 30 * time.Second},
		entries: map[string]Entry{},
	}
}

// Catalogue returns the whole catalogue keyed by CVE, refreshing it
// when stale.
//
// A failure is NEVER fatal and never empties what we have: the last
// good copy keeps being used, because a day-old answer about which
// flaws are being exploited is worth incomparably more than no answer.
// The error comes back alongside so a page can say the list may be
// stale, and the caller can ignore it — every one of them should still
// render.
func (c *Client) Catalogue(ctx context.Context) (map[string]Entry, error) {
	c.mu.RLock()
	fresh := time.Since(c.fetchedAt) < refreshAfter && len(c.entries) > 0
	entries := c.entries
	c.mu.RUnlock()
	if fresh {
		return entries, nil
	}

	fetched, ferr := c.fetch(ctx)
	c.mu.Lock()
	defer c.mu.Unlock()
	if ferr != nil {
		c.lastErr = ferr
		// Keep whatever we had. An empty map here means we have never
		// succeeded, which is a different thing from "nothing is
		// exploited" and is why the error travels with it.
		return c.entries, ferr
	}
	c.entries, c.fetchedAt, c.lastErr = fetched, time.Now(), nil
	return c.entries, nil
}

func (c *Client) fetch(ctx context.Context) (map[string]Entry, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, Feed, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, &statusError{resp.StatusCode}
	}
	var body struct {
		Vulnerabilities []struct {
			CVEID             string `json:"cveID"`
			VendorProject     string `json:"vendorProject"`
			Product           string `json:"product"`
			VulnerabilityName string `json:"vulnerabilityName"`
			DateAdded         string `json:"dateAdded"`
			DueDate           string `json:"dueDate"`
			RequiredAction    string `json:"requiredAction"`
			// CISA writes "Known" or "Unknown" here, not a boolean.
			KnownRansomwareCampaignUse string `json:"knownRansomwareCampaignUse"`
		} `json:"vulnerabilities"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	out := make(map[string]Entry, len(body.Vulnerabilities))
	for _, v := range body.Vulnerabilities {
		out[v.CVEID] = Entry{
			CVE:               v.CVEID,
			VendorProject:     v.VendorProject,
			Product:           v.Product,
			VulnerabilityName: v.VulnerabilityName,
			DateAdded:         parseDay(v.DateAdded),
			DueDate:           parseDay(v.DueDate),
			KnownRansomware:   v.KnownRansomwareCampaignUse == "Known",
			RequiredAction:    v.RequiredAction,
		}
	}
	return out, nil
}

// parseDay reads the catalogue's plain dates (2021-12-10). A date that
// won't parse becomes 0, which the UI renders as absent rather than as
// 1970.
func parseDay(s string) int64 {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return 0
	}
	return t.Unix()
}

type statusError struct{ code int }

func (e *statusError) Error() string {
	return "cisa kev: catalogue request failed with status " + http.StatusText(e.code)
}
