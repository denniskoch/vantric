package api

import (
	"errors"
	"net/http"
	"sort"

	"vantric/internal/inventory"
	"vantric/internal/kev"
)

// The Security overview.
//
// It answers one question — what should I deal with first — and it
// leads with the intersection nothing else computes: vulnerabilities
// CISA says are being exploited RIGHT NOW that are also present on
// machines in this estate.
//
// Either half alone is noise. CISA's catalogue is 1,670 CVEs, almost
// none of which you run. Your estate is four thousand CVEs, almost all
// of which nobody is exploiting. The overlap is small on purpose: in
// this lab it is three, and three is a list somebody actually works
// through on a Tuesday.
//
// No score, no grade, no total. A number that moves when you connect
// another backend measures the console rather than the lab, and a
// security page that can be improved by disconnecting something is
// worse than none.

// exploitedFinding is one CVE that is both catalogued and present.
type exploitedFinding struct {
	CVE string `json:"cve"`
	// Name is CISA's, which says what the flaw is in a way a CVE id
	// never will.
	Name    string `json:"name"`
	Product string `json:"product"`
	// Hosts is how many machines here carry it.
	Hosts     int     `json:"hosts"`
	Severity  string  `json:"severity"`
	CVSSScore float64 `json:"cvssScore"`
	// AddedAt is when CISA catalogued it; unix seconds.
	AddedAt int64 `json:"addedAt"`
	// Ransomware is CISA's flag for use in ransomware campaigns.
	Ransomware bool `json:"ransomware"`
}

type securityOverviewResponse struct {
	// Configured is false when no inventory service is connected, which
	// is why the page would otherwise be empty — a different thing from
	// having nothing to report.
	Configured bool `json:"configured"`
	// Supported is false where the service can't produce an estate-wide
	// list at all (Fleet gates it behind a paid tier).
	Supported bool               `json:"supported"`
	Exploited []exploitedFinding `json:"exploited"`
	// Tracked is how many CVEs the service knows about here, so the
	// short list above has a denominator and doesn't read as the whole
	// picture.
	Tracked int `json:"tracked"`
	// Catalogued is the size of CISA's catalogue, for the same reason.
	Catalogued int    `json:"catalogued"`
	Error      string `json:"error,omitempty"`
}

func (s *Server) securityOverview(w http.ResponseWriter, r *http.Request) {
	out := securityOverviewResponse{Exploited: []exploitedFinding{}}
	provider, ok := s.inventoryRegistry.Any()
	if !ok {
		s.json(w, http.StatusOK, out)
		return
	}
	out.Configured, out.Supported = true, true

	vulns, err := provider.Vulnerabilities(r.Context())
	if errors.Is(err, inventory.ErrUnsupported) {
		out.Supported = false
		s.json(w, http.StatusOK, out)
		return
	}
	if err != nil {
		out.Error = err.Error()
		s.json(w, http.StatusOK, out)
		return
	}
	out.Tracked = len(vulns)

	catalogue, err := s.kev.Catalogue(r.Context())
	if err != nil {
		// Without the catalogue there is no intersection to show, and
		// an empty list would read as "nothing is being exploited" —
		// the one wrong answer this page must not give. So it says why.
		s.log.Warn("kev catalogue unavailable", "error", err)
		out.Error = "CISA's catalogue couldn't be read, so exploited vulnerabilities can't be identified: " + err.Error()
		s.json(w, http.StatusOK, out)
		return
	}
	out.Catalogued = len(catalogue)

	// Scores come from the console's own cache, where the enricher puts
	// them — Fleet carries none on this tier.
	scores, _ := s.store.CVEScores(r.Context())
	for _, v := range vulns {
		entry, listed := catalogue[v.CVE]
		if !listed {
			continue
		}
		f := exploitedFinding{
			CVE:        v.CVE,
			Name:       entry.VulnerabilityName,
			Product:    productOf(entry),
			Hosts:      v.Hosts,
			Severity:   v.Severity,
			CVSSScore:  v.CVSSScore,
			AddedAt:    entry.DateAdded,
			Ransomware: entry.KnownRansomware,
		}
		if c, ok := scores[v.CVE]; ok && f.CVSSScore == 0 {
			f.CVSSScore, f.Severity = c.Score, c.Severity
		}
		out.Exploited = append(out.Exploited, f)
	}
	// Most machines first: the same flaw on eight hosts is a bigger
	// morning than on one.
	sort.SliceStable(out.Exploited, func(i, j int) bool {
		if out.Exploited[i].Hosts != out.Exploited[j].Hosts {
			return out.Exploited[i].Hosts > out.Exploited[j].Hosts
		}
		return out.Exploited[i].CVE < out.Exploited[j].CVE
	})
	s.json(w, http.StatusOK, out)
}

// productOf is CISA's own naming of what carries the flaw, which is
// more useful than either field alone: "Google Chromium WebP" rather
// than "Google" or "Chromium WebP".
func productOf(e kev.Entry) string {
	switch {
	case e.VendorProject != "" && e.Product != "":
		return e.VendorProject + " " + e.Product
	case e.Product != "":
		return e.Product
	default:
		return e.VendorProject
	}
}
