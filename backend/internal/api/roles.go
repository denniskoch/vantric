package api

import (
	"sort"
	"strings"
)

// Roles, per section.
//
// THE UNIT OF ACCESS IS A SECTION, which is what GCP calls a service:
// compute.viewer reads the machines and compute.editor changes them,
// and neither says anything about DNS. The three basic roles are still
// here and still mean what they mean in GCP — they are the same three
// tiers applied to every section at once.
//
// WHY THREE TIERS AND NOT TWO. The line this console already drew, and
// the reason it drew it, survives being scoped: an editor may delete a
// VM, which is destructive and recoverable from a backup, while only an
// admin may add a hypervisor, because a stored root token is a standing
// grant of everything an editor could ever do. Scoping that per section
// means dns.admin can store a Cloudflare token without also being able
// to store a Proxmox one.
//
// NO ROLE MEANS NO SECTION. Reads used to be open to anyone signed in,
// on the reasoning that a viewer who cannot see the lab has no reason to
// have an account. That was true when the only question was "how much
// of it can you change". Once a section can be absent from somebody's
// nav, the nav has to be telling the truth: a section you hold no role
// on is refused by the API as well as hidden, or the hiding is
// decoration and the boundary is imaginary.

// Tier is how much of a section a role grants. Ordered, so a check is a
// comparison rather than a set membership test.
type Tier int

const (
	TierNone Tier = iota
	TierViewer
	TierEditor
	TierAdmin
)

var tierNames = map[Tier]string{
	TierViewer: "viewer",
	TierEditor: "editor",
	TierAdmin:  "admin",
}

func (t Tier) String() string { return tierNames[t] }

func tierFromName(name string) (Tier, bool) {
	for tier, n := range tierNames {
		if n == name {
			return tier, true
		}
	}
	return TierNone, false
}

// Section is one part of the console, and the thing a role is granted
// on. Prefixes are the API routes it owns, under /api/v1.
//
// EVERY ROUTE BELONGS TO EXACTLY ONE SECTION, and a test walks the
// router to prove it. That is the property the old model lacked: its
// owner-only list was hand-maintained strings, and the hypervisor
// rename moved a route out of it without breaking the build or any
// test. A route that matches no section here is refused rather than
// allowed, so the failure direction is a section somebody cannot reach
// rather than one anybody can.
type Section struct {
	ID    string
	Label string
	// Prefixes are matched longest-first, so /database/servers can sit
	// in databases while /databases stays the section id.
	Prefixes []string
	// Credentialed says the section stores a backend credential, so its
	// admin tier means something beyond editor. Where it doesn't, admin
	// and editor grant the same thing and the UI offers two roles rather
	// than three.
	Credentialed bool
	// Route is where the section lives in the BROWSER, which is not
	// always its API prefix — Databases is /databases and /api/v1/database,
	// Devices is /devices and /api/v1/inventory. The overview needs it to
	// work out which section a finding belongs to, since a finding knows
	// the page that shows it.
	Route string
}

// sectionForRoute resolves a UI path to its section, longest match
// first for the same reason sectionFor does.
func sectionForRoute(route string) (Section, bool) {
	best, bestLen := Section{}, -1
	for _, s := range sections {
		if s.Route == "" {
			continue
		}
		if route == s.Route || strings.HasPrefix(route, s.Route+"/") {
			if len(s.Route) > bestLen {
				best, bestLen = s, len(s.Route)
			}
		}
	}
	return best, bestLen >= 0
}

// sections is the authoritative map. The frontend has its own list for
// the nav, and the ids must agree — but this one decides, because the
// frontend's job is what to OFFER and this one's is what to allow.
var sections = []Section{
	{ID: "overview", Label: "Cloud overview", Prefixes: []string{"/overview"}, Route: "/overview"},
	{ID: "security", Label: "Security", Prefixes: []string{
		"/security", "/vulnerabilities", "/kev",
		// The NVD key and the enrichment switch: what a CVE MEANS is a
		// security question, per the section split already documented.
		"/inventory/enrichment", "/inventory/cve",
	}, Credentialed: true, Route: "/security"},
	{ID: "monitoring", Label: "Monitoring", Prefixes: []string{"/monitoring"}, Credentialed: true, Route: "/monitoring"},
	{ID: "compute", Label: "Compute", Prefixes: []string{
		"/instances", "/containers", "/nodes", "/hypervisors", "/hypervisor-types",
		"/datastores", "/disks", "/snapshots", "/backups", "/backup-schedules",
		"/images", "/vm-templates", "/ct-templates", "/cloud-images", "/isos",
		"/bridges", "/machine-types",
	}, Credentialed: true, Route: "/compute"},
	{ID: "docker", Label: "Docker", Prefixes: []string{"/docker"}, Credentialed: true, Route: "/docker"},
	{ID: "devices", Label: "Devices", Prefixes: []string{
		"/inventory", "/installers",
	}, Credentialed: true, Route: "/devices"},
	{ID: "storage", Label: "Object storage", Prefixes: []string{"/storage"}, Credentialed: true, Route: "/storage"},
	{ID: "databases", Label: "Databases", Prefixes: []string{"/database"}, Credentialed: true, Route: "/databases"},
	{ID: "network", Label: "Network", Prefixes: []string{"/network"}, Credentialed: true, Route: "/network"},
	{ID: "dns", Label: "DNS", Prefixes: []string{"/dns"}, Credentialed: true, Route: "/dns"},
	{ID: "identity", Label: "Identity Platform", Prefixes: []string{"/identity"}, Credentialed: true, Route: "/identity"},
	{ID: "ai", Label: "AI gateway", Prefixes: []string{"/ai"}, Credentialed: true, Route: "/ai"},
	{ID: "iam", Label: "IAM & Admin", Prefixes: []string{
		"/iam", "/audit", "/branding",
	}, Credentialed: true, Route: "/iam"},
}

// SectionByID looks one up. Used by the API that reports somebody's
// roles, so the UI can name them.
func SectionByID(id string) (Section, bool) {
	for _, s := range sections {
		if s.ID == id {
			return s, true
		}
	}
	return Section{}, false
}

// Sections returns the list, for the endpoint the role editor reads.
func Sections() []Section { return sections }

// sectionFor resolves an API path to the section that owns it.
//
// Longest prefix wins, so a section can own a path that sits under
// another section's word — /inventory/enrichment is Security's while
// /inventory/hosts is Devices'.
func sectionFor(path string) (Section, bool) {
	rest, ok := strings.CutPrefix(path, "/api/v1")
	if !ok {
		return Section{}, false
	}
	best, bestLen := Section{}, -1
	for _, s := range sections {
		for _, prefix := range s.Prefixes {
			if rest == prefix || strings.HasPrefix(rest, prefix+"/") {
				if len(prefix) > bestLen {
					best, bestLen = s, len(prefix)
				}
			}
		}
	}
	return best, bestLen >= 0
}

// Role names are either a basic role — "owner", "editor", "viewer",
// which apply to every section — or "<section>.<tier>".
const (
	roleOwner  = "owner"
	roleEditor = "editor"
	roleViewer = "viewer"
)

var basicTiers = map[string]Tier{
	roleOwner:  TierAdmin,
	roleEditor: TierEditor,
	roleViewer: TierViewer,
}

// ValidRole reports whether a string names a role this console has. The
// API refuses anything else rather than storing a binding that grants
// nothing and looks like it grants something.
func ValidRole(role string) bool {
	if _, ok := basicTiers[role]; ok {
		return true
	}
	id, tierName, found := strings.Cut(role, ".")
	if !found {
		return false
	}
	if _, ok := SectionByID(id); !ok {
		return false
	}
	_, ok := tierFromName(tierName)
	return ok
}

// AllRoles lists every role that can be granted, basic ones first and
// then each section's, for the role picker.
func AllRoles() []string {
	roles := []string{roleOwner, roleEditor, roleViewer}
	for _, s := range sections {
		tiers := []Tier{TierViewer, TierEditor}
		if s.Credentialed {
			tiers = append(tiers, TierAdmin)
		}
		for _, t := range tiers {
			roles = append(roles, s.ID+"."+t.String())
		}
	}
	return roles
}

// grants collapses a set of role bindings into the tier held on each
// section. A basic role applies to every section, and the highest of
// whatever applies wins — holding both viewer and compute.admin means
// admin on compute and viewer everywhere else, which is how somebody
// gets read of the lab plus one area they run.
func grants(roles []string) map[string]Tier {
	held := map[string]Tier{}
	raise := func(id string, tier Tier) {
		if tier > held[id] {
			held[id] = tier
		}
	}
	for _, role := range roles {
		if tier, ok := basicTiers[role]; ok {
			for _, s := range sections {
				raise(s.ID, tier)
			}
			continue
		}
		id, tierName, found := strings.Cut(role, ".")
		if !found {
			continue
		}
		tier, ok := tierFromName(tierName)
		if !ok {
			continue
		}
		if _, known := SectionByID(id); !known {
			continue
		}
		raise(id, tier)
	}
	return held
}

// sortRoles puts basic roles first and then sections in nav order, so a
// listing reads the same everywhere it appears.
func sortRoles(roles []string) {
	order := map[string]int{}
	for i, r := range AllRoles() {
		order[r] = i
	}
	sort.Slice(roles, func(i, j int) bool {
		oi, oj := order[roles[i]], order[roles[j]]
		if oi != oj {
			return oi < oj
		}
		return roles[i] < roles[j]
	})
}
