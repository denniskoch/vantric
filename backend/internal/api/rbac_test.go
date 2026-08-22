package api

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

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
		"/api/v1/database/servers/abc/databases",
		"/api/v1/database/servers/abc/users",
		"/api/v1/database/servers/abc/users/bob/password",
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
		r = r.WithContext(context.WithValue(r.Context(), ctxUserKey{},
			&store.User{Email: "someone@example.com", Role: c.role}))
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
