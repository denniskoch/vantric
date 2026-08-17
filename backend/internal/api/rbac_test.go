package api

import "testing"

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
