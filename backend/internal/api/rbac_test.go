package api

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"vantric/internal/store"
)

// The hypervisor rename moved /servers to /hypervisors and left
// ownerOnly pointing at the old spelling, which matched nothing — an
// editor could add a hypervisor credential for as long as that stood,
// and nothing failed to build or run. These are strings compared against
// route paths, so the only thing that catches a drift is a test that
// names the paths it expects to be covered.
func TestOwnerOnlyCoversEveryCredentialRoute(t *testing.T) {
	// Every route that stores or replaces a credential for a backend, or
	// changes who can sign in. Add a backend, add its line here.
	owner := []string{
		"/api/v1/hypervisors",
		"/api/v1/hypervisors/abc",
		"/api/v1/dns/providers",
		"/api/v1/dns/providers/abc",
		"/api/v1/database/servers",
		"/api/v1/database/servers/abc",
		"/api/v1/identity/providers/abc",
		"/api/v1/network/providers/abc",
		"/api/v1/inventory/providers/abc",
		"/api/v1/storage/providers",
		"/api/v1/storage/providers/abc",
		"/api/v1/ai/gateways",
		"/api/v1/ai/gateways/abc",
		"/api/v1/ai/accounts",
		"/api/v1/ai/accounts/abc",
		// Connecting an upstream provider means storing its vendor key
		// at the gateway, keys included.
		"/api/v1/ai/providers",
		"/api/v1/ai/providers/openai",
		"/api/v1/ai/providers/openai/keys",
		"/api/v1/ai/providers/openai/keys/abc",
		"/api/v1/monitoring/providers",
		"/api/v1/monitoring/providers/abc",
		"/api/v1/iam/users",
		"/api/v1/iam/users/abc/password",
		"/api/v1/iam/oidc",
		"/api/v1/inventory/enrichment/key",
		"/api/v1/installers/token/rotate",
	}
	for _, path := range owner {
		if !isOwnerOnly(path) {
			t.Errorf("%s is a credential route but no owner-only entry matches it", path)
		}
	}

	// And the other half of the rule: a resource INSIDE a backend is an
	// editor's to change. A prefix match made all of these owner-only,
	// which contradicted both the role doc and the list's own comment.
	editor := []string{
		// Issuing a caller's credential and capping what it may spend
		// are USING a connected backend, which is an editor's to do —
		// the same rule that makes an object store's access keys
		// editor work while the store's own credential is an owner's.
		"/api/v1/ai/virtual-keys",
		"/api/v1/ai/virtual-keys/abc",
		"/api/v1/ai/limits",
		"/api/v1/ai/limits/abc",
		"/api/v1/ai/limits/abc/reset",
		"/api/v1/database/servers/abc/databases",
		"/api/v1/database/servers/abc/users",
		"/api/v1/database/servers/abc/users/bob/password",
		// Disabling an account and moving which hosts it may connect
		// from are the same kind of act as changing its password:
		// using a connected backend, which is an editor's.
		"/api/v1/database/servers/abc/users/bob/enabled",
		"/api/v1/database/servers/abc/users/bob/host",
		"/api/v1/database/servers/abc/databases/app/access",
		"/api/v1/storage/buckets",
		"/api/v1/storage/buckets/lab-backups/quota",
		"/api/v1/storage/users",
		"/api/v1/storage/users/backups/policy",
		"/api/v1/dns/zones/example.com/records",
		// Reading the gateway's log is a read like any other; only the
		// gateway record itself is an owner's.
		"/api/v1/ai/requests",
		"/api/v1/instances",
		"/api/v1/identity/users",
	}
	for _, path := range editor {
		if isOwnerOnly(path) {
			t.Errorf("%s is a resource inside a backend and should be an editor's to change", path)
		}
	}
}

func isOwnerOnly(path string) bool {
	for _, prefix := range ownerOnly {
		if ownerOnlyMatch(prefix, path) {
			return true
		}
	}
	return false
}

// The string matcher above is not the permission model — requireRole is,
// and the two can disagree. They did: requireRole returned early for any
// method that wasn't POST/PUT/PATCH/DELETE, so every check below it was
// unreachable from a GET. That was correct while every GET was a read,
// and stopped being correct the day GET /instances/{n}/ssh landed: a
// viewer could open a shell on every guest in the lab, and a test over
// ownerOnly could never have seen it, because ownerOnly was never
// consulted.
//
// So this runs the real middleware.
func TestRequireRoleGuardsTheMiddleware(t *testing.T) {
	s := &Server{log: slog.New(slog.NewTextHandler(io.Discard, nil))}

	cases := []struct {
		role, method, path string
		allowed            bool
	}{
		// A read is a read, for everyone.
		{roleViewer, http.MethodGet, "/api/v1/instances", true},
		{roleViewer, http.MethodGet, "/api/v1/instances/web-1/describe", true},
		{roleViewer, http.MethodGet, "/api/v1/instances/web-1/metrics", true},
		{roleViewer, http.MethodGet, "/api/v1/instances/web-1/backups", true},

		// A GET that reaches INSIDE a guest is not a read. This is
		// finding 01, and the reason this test exists.
		{roleViewer, http.MethodGet, "/api/v1/instances/web-1/ssh", false},
		{roleViewer, http.MethodGet, "/api/v1/instances/web-1/sftp/download", false},
		{roleEditor, http.MethodGet, "/api/v1/instances/web-1/ssh", true},
		{roleEditor, http.MethodGet, "/api/v1/instances/web-1/sftp/download", true},
		{roleOwner, http.MethodGet, "/api/v1/instances/web-1/ssh", true},

		// The account's own key is self-service and must not be caught
		// by a suffix match on "/ssh".
		{roleViewer, http.MethodGet, "/api/v1/ssh-key", true},
		{roleViewer, http.MethodPut, "/api/v1/ssh-key", true},
		{roleViewer, http.MethodPost, "/api/v1/auth/password", true},

		// Ordinary mutations: an editor's, not a viewer's.
		{roleViewer, http.MethodPost, "/api/v1/instances", false},
		{roleViewer, http.MethodDelete, "/api/v1/instances/web-1", false},
		{roleEditor, http.MethodPost, "/api/v1/instances", true},

		// Credentials stay owner-only.
		{roleEditor, http.MethodPost, "/api/v1/hypervisors", false},
		{roleEditor, http.MethodPost, "/api/v1/iam/users", false},
		{roleOwner, http.MethodPost, "/api/v1/hypervisors", true},
		// ...and a resource inside a backend does not.
		{roleEditor, http.MethodPost, "/api/v1/storage/users", true},
	}

	for _, c := range cases {
		reached := false
		next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true })
		r := httptest.NewRequest(c.method, c.path, nil)
		ctx := context.WithValue(r.Context(), ctxUserKey{},
			&store.User{Email: "someone@example.com"})
		ctx = context.WithValue(ctx, ctxRolesKey{}, []string{c.role})
		r = r.WithContext(ctx)
		w := httptest.NewRecorder()

		s.requireRole(next).ServeHTTP(w, r)

		if reached != c.allowed {
			verb := "refused"
			if reached {
				verb = "allowed"
			}
			t.Errorf("%s %s as %s: %s, wanted the opposite", c.method, c.path, c.role, verb)
		}
		if !c.allowed && w.Code != http.StatusForbidden {
			t.Errorf("%s %s as %s: refused with %d, wanted 403", c.method, c.path, c.role, w.Code)
		}
	}
}

// EVERY ROUTE BELONGS TO A SECTION, and this is what makes that true
// rather than intended.
//
// The old model's weak point was a hand-maintained list of strings: the
// hypervisor rename moved /servers to /hypervisors and left the old
// spelling matching nothing, so an editor could store a root token and
// nothing failed to build. A list can only be checked against the paths
// somebody remembered to write down.
//
// This walks the ACTUAL router. A route added tomorrow under a prefix
// no section claims fails here, which is the only way a permission
// model stays closed as the API grows. The failure direction is safe
// either way — requireRole refuses an unclassified path — but an
// unreachable page found in CI beats one found by a user.
func TestEveryRouteBelongsToASection(t *testing.T) {
	s := &Server{log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	mux, ok := s.Router().(chi.Routes)
	if !ok {
		t.Fatal("the router is no longer a chi.Routes; this test needs it to walk")
	}

	// Reachable without a session at all, so they are outside the
	// section model by design rather than by omission.
	open := []string{
		"/api/v1/auth/", "/api/v1/branding", "/api/v1/branding/logo",
	}
	// The caller's own account, key and tiles, and the console's own
	// chrome.
	selfServed := append(append([]string{}, selfService...), shellRoutes...)

	var unclassified []string
	err := chi.Walk(mux, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		path := strings.TrimSuffix(route, "/*")
		for _, p := range open {
			if strings.HasPrefix(path, p) {
				return nil
			}
		}
		for _, p := range selfServed {
			if strings.HasPrefix(path, p) {
				return nil
			}
		}
		if _, known := sectionFor(path); !known {
			unclassified = append(unclassified, method+" "+path)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking the router: %v", err)
	}
	for _, route := range unclassified {
		t.Errorf("%s belongs to no section — add its prefix to sections in roles.go", route)
	}
}

// The tiers, per section, are the whole point of the model: holding
// compute.editor must not move anything in DNS.
func TestSectionRolesDoNotLeakAcrossSections(t *testing.T) {
	s := &Server{log: slog.New(slog.NewTextHandler(io.Discard, nil))}

	cases := []struct {
		name    string
		roles   []string
		method  string
		path    string
		allowed bool
	}{
		{"compute.editor creates an instance", []string{"compute.editor"},
			http.MethodPost, "/api/v1/instances", true},
		{"compute.editor cannot touch DNS", []string{"compute.editor"},
			http.MethodPost, "/api/v1/dns/zones/example.com/records", false},
		{"compute.editor cannot even READ DNS", []string{"compute.editor"},
			http.MethodGet, "/api/v1/dns/zones", false},
		{"compute.editor cannot add a hypervisor", []string{"compute.editor"},
			http.MethodPost, "/api/v1/hypervisors", false},
		{"compute.admin can", []string{"compute.admin"},
			http.MethodPost, "/api/v1/hypervisors", true},
		{"compute.admin still cannot add a DNS provider", []string{"compute.admin"},
			http.MethodPost, "/api/v1/dns/providers", false},
		{"dns.admin can", []string{"dns.admin"},
			http.MethodPost, "/api/v1/dns/providers", true},

		// The combination the model exists for: watch everything, run
		// one part of it.
		{"viewer + compute.admin reads DNS", []string{"viewer", "compute.admin"},
			http.MethodGet, "/api/v1/dns/zones", true},
		{"viewer + compute.admin cannot write DNS", []string{"viewer", "compute.admin"},
			http.MethodPost, "/api/v1/dns/zones/example.com/records", false},
		{"viewer + compute.admin adds a hypervisor", []string{"viewer", "compute.admin"},
			http.MethodPost, "/api/v1/hypervisors", true},

		// A section nobody granted is not readable, which is what makes
		// hiding it from the nav a boundary rather than decoration.
		{"no roles reads nothing", nil, http.MethodGet, "/api/v1/instances", false},
		{"no roles still changes their own password", nil,
			http.MethodPost, "/api/v1/auth/password", true},

		// IAM is its own section, so running Compute is not a way to
		// grant yourself more of it.
		{"compute.admin cannot create accounts", []string{"compute.admin"},
			http.MethodPost, "/api/v1/iam/users", false},
		{"iam.admin can", []string{"iam.admin"},
			http.MethodPost, "/api/v1/iam/users", true},
	}

	for _, c := range cases {
		reached := false
		next := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true })
		r := httptest.NewRequest(c.method, c.path, nil)
		ctx := context.WithValue(r.Context(), ctxUserKey{}, &store.User{Email: "someone@example.com"})
		ctx = context.WithValue(ctx, ctxRolesKey{}, c.roles)
		w := httptest.NewRecorder()
		s.requireRole(next).ServeHTTP(w, r.WithContext(ctx))
		if reached != c.allowed {
			t.Errorf("%s: allowed=%v, wanted %v", c.name, reached, c.allowed)
		}
	}
}
