package fleet

import (
	"context"
	"sync"
	"time"

	"vantric/internal/inventory"
)

// OS-level vulnerabilities: the ones that belong to the operating
// system rather than to anything installed on it.
//
// Fleet keeps these apart from a host's software, and the host detail
// endpoint returns only the software. So a machine's own page listed
// every flaw in its packages and none in its OS — which on Linux went
// unnoticed, because the kernel is a package and carries them anyway,
// and on macOS and Windows meant they were simply absent.
//
// That is how a MacBook four minor versions behind showed one
// vulnerability on its page while the estate-wide list counted 403 for
// it, two of them in CISA's exploited catalogue. The page wasn't
// disagreeing with the list; it had never been shown that half.
//
// The catalogue is fetched whole because Fleet offers no per-host way
// in: a host reports its OS as a STRING ("macOS 26.2") with no id, so
// the only route from a machine to its OS vulnerabilities is to hold
// the table and look the name up. It's about a megabyte, it changes
// when someone patches something, and it's cached for that reason.
const osVersionsTTL = 30 * time.Minute

type osVulnCache struct {
	mu        sync.RWMutex
	byName    map[string][]inventory.Vulnerability
	fetchedAt time.Time
}

// osVulnerabilities returns the OS-level CVEs for one reported OS
// version string, refreshing the table when stale.
//
// A failure returns nothing rather than an error: these are additional
// to a host's software vulnerabilities, and losing the page over them
// would trade a partial answer for none.
func (p *Provider) osVulnerabilities(ctx context.Context, osVersion string) []inventory.Vulnerability {
	if osVersion == "" {
		return nil
	}
	p.osVulns.mu.RLock()
	fresh := time.Since(p.osVulns.fetchedAt) < osVersionsTTL && p.osVulns.byName != nil
	byName := p.osVulns.byName
	p.osVulns.mu.RUnlock()

	if !fresh {
		fetched, err := p.fetchOSVulnerabilities(ctx)
		if err != nil {
			// Keep whatever we had; a stale table beats no OS CVEs.
			return byName[osVersion]
		}
		p.osVulns.mu.Lock()
		p.osVulns.byName, p.osVulns.fetchedAt = fetched, time.Now()
		byName = fetched
		p.osVulns.mu.Unlock()
	}
	return byName[osVersion]
}

func (p *Provider) fetchOSVulnerabilities(ctx context.Context) (map[string][]inventory.Vulnerability, error) {
	var out struct {
		OSVersions []struct {
			Name            string `json:"name"`
			Vulnerabilities []struct {
				CVE               string  `json:"cve"`
				CVSSScore         float64 `json:"cvss_score"`
				EPSSProbability   float64 `json:"epss_probability"`
				CISAKnownExploit  bool    `json:"cisa_known_exploit"`
				CVEPublished      string  `json:"cve_published"`
				DetailsLink       string  `json:"details_link"`
				ResolvedInVersion string  `json:"resolved_in_version"`
			} `json:"vulnerabilities"`
		} `json:"os_versions"`
	}
	if err := p.do(ctx, "/os_versions", &out); err != nil {
		return nil, err
	}
	byName := make(map[string][]inventory.Vulnerability, len(out.OSVersions))
	for _, os := range out.OSVersions {
		vulns := make([]inventory.Vulnerability, 0, len(os.Vulnerabilities))
		for _, v := range os.Vulnerabilities {
			vulns = append(vulns, inventory.Vulnerability{
				CVE: v.CVE,
				// The OS stands where a package name would: the row has
				// to say what carries this, and "macOS 26.2" is the
				// honest answer where there is no package to blame.
				Package:           os.Name,
				InstalledVersion:  "",
				OperatingSystem:   true,
				CVSSScore:         v.CVSSScore,
				Severity:          severity(v.CVSSScore),
				EPSS:              v.EPSSProbability,
				KnownExploited:    v.CISAKnownExploit,
				ResolvedInVersion: v.ResolvedInVersion,
				PublishedAt:       parseTime(v.CVEPublished),
				DetailsURL:        v.DetailsLink,
			})
		}
		byName[os.Name] = vulns
	}
	return byName, nil
}
