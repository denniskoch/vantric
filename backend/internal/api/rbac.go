package api

import (
	"net/http"
	"strings"
)

// Roles, enforced.
//
// The three are GCP's basic roles and mean what they mean there:
//
//	viewer  reads everything and changes nothing
//	editor  everything a viewer can, plus the resources — instances,
//	        containers, records, databases, templates, installers
//	owner   everything, plus who can sign in and what this console is
//	        connected to
//
// The line between editor and owner is deliberately drawn at
// CREDENTIALS AND ACCESS rather than at "dangerous". An editor can
// delete a VM, which is destructive and recoverable from backup; only
// an owner can add a hypervisor, because a stored root token is a
// standing grant of everything an editor could ever do, and only an
// owner can create an account, because that is how the set of editors
// changes.
//
// ENFORCEMENT IS MIDDLEWARE, for the same reason auditing is: a check
// inside each handler is a check the next handler forgets, and a
// permission model with a hole is a permission model that isn't one.
// Reads are unrestricted for anyone signed in — this console shows a
// lab's state, and a viewer who can't see it has no reason to have an
// account. WITH ONE EXCEPTION, and it is a verb problem rather than a
// role one: two routes are GETs that reach inside a guest instead of
// describing it. See guestAccess.

const (
	roleOwner  = "owner"
	roleEditor = "editor"
	roleViewer = "viewer"
)

// ownerOnly are the route prefixes where a mutation needs an owner.
// Credentials for a backend, accounts that can sign in, and the
// settings that govern both.
// A PREFIX HERE IS A ROUTE PATH, AND RENAMING A ROUTE MOVES IT OUT OF
// THIS LIST WITHOUT BREAKING THE BUILD. That already happened once: the
// hypervisor rename moved /servers to /hypervisors and left the old
// spelling sitting here, matching nothing — so for as long as that
// stood, an editor could add a hypervisor credential. There is a test
// (rbac_test.go) that walks the registered routes and fails when a
// credential route isn't covered, because a string that silently stops
// matching is not something to leave to a reader's eye.
var ownerOnly = []string{
	"/api/v1/iam/",             // accounts, roles, SSO
	"/api/v1/hypervisors",      // hypervisor credentials
	"/api/v1/dns/providers",    // and the rest of the backends
	"/api/v1/database/servers", // (the servers themselves, not what's in them)
	"/api/v1/identity/providers",
	"/api/v1/network/providers",
	"/api/v1/inventory/providers",
	"/api/v1/storage/providers",
	"/api/v1/ai/gateways",
	"/api/v1/ai/accounts",
	"/api/v1/monitoring/providers",
	"/api/v1/inventory/enrichment/", // an API key
	"/api/v1/installers/token/",     // the download token
}

// ownerOnlyMatch decides whether a path is one of the owner-only ones,
// and the two forms of entry are the point.
//
// An entry ENDING IN "/" owns everything beneath it — /api/v1/iam/ has
// to cover /iam/users/{id}/password, and every route under it is about
// accounts. An entry that does NOT end in "/" is a COLLECTION AND ITS
// MEMBERS ONLY: the credential record itself, not the resources inside
// the backend it reaches.
//
// That distinction was missing, and a plain prefix match made
// /api/v1/database/servers own everything below it — so creating a
// database, adding a database user and granting access were all
// owner-only, while the comment beside the list said "the servers
// themselves, not what's in them" and the role doc promised editors
// could change databases. Connecting a backend is an owner's decision;
// using one is an editor's.
func ownerOnlyMatch(prefix, path string) bool {
	if strings.HasSuffix(prefix, "/") {
		return strings.HasPrefix(path, prefix)
	}
	if path == prefix {
		return true
	}
	rest, ok := strings.CutPrefix(path, prefix+"/")
	// One more segment is the record's id. Anything deeper is a resource
	// inside that backend.
	return ok && rest != "" && !strings.Contains(rest, "/")
}

// selfService are the mutations anybody signed in may make, because
// they act on the caller's own account. A viewer who cannot change
// their own password or rotate their own key can't use the console at
// all, which would make the role pointless rather than restricted.
var selfService = []string{
	"/api/v1/auth/password",
	"/api/v1/ssh-key",
	"/api/v1/favorites",
	// Somebody's own tiles. A prefix rather than an exact path, so the
	// icon and the ordering come with it.
	"/api/v1/shortcuts",
}

// guestAccess are the GETs THAT ARE NOT READS, and they are the reason
// privilege can't be derived from the HTTP verb.
//
// The rule above — "reads are unrestricted for anyone signed in" — was
// true when every GET returned a description of something. It stopped
// being true when the console grew a way INTO a guest: a websocket
// shell and a file pull are both GETs, and both do far more than any
// mutation in this API. A viewer, the role whose whole promise is that
// it changes nothing, could open a root-capable session on every guest
// in the lab.
//
// So these are matched by SUFFIX under the instance subtree rather than
// by the subtree itself, because the rest of it — describe, metrics,
// os-info, inventory, backups — really is reading, and a viewer is
// meant to have it.
var guestAccess = []string{
	"/ssh",           // interactive PTY
	"/sftp/download", // arbitrary file read
}

// isGuestAccess reports whether a path reaches inside a guest rather
// than describing one.
func isGuestAccess(path string) bool {
	if !strings.HasPrefix(path, "/api/v1/instances/") {
		return false
	}
	for _, suffix := range guestAccess {
		if strings.HasSuffix(path, suffix) {
			return true
		}
	}
	return false
}

// requireRole refuses mutations the signed-in account isn't entitled
// to make. Mounted inside the authenticated group, so there is always
// an actor.
func (s *Server) requireRole(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		default:
			// A verb is not a privilege level: see guestAccess.
			if !isGuestAccess(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
		}
		user := userFrom(r.Context())
		if user == nil {
			// requireAuth runs first, so this can't happen — but a
			// permission check that assumes its way past a nil is one
			// refactor away from a hole.
			s.err(w, http.StatusForbidden, "not signed in")
			return
		}
		path := r.URL.Path
		for _, prefix := range selfService {
			if strings.HasPrefix(path, prefix) {
				next.ServeHTTP(w, r)
				return
			}
		}
		if user.Role == roleOwner {
			next.ServeHTTP(w, r)
			return
		}
		for _, prefix := range ownerOnly {
			if ownerOnlyMatch(prefix, path) {
				s.log.Warn("refused: needs an owner",
					"account", user.Email, "role", user.Role, "path", path)
				s.err(w, http.StatusForbidden,
					"that needs an owner — this account is "+roleLabel(user.Role)+
						". Credentials, accounts and sign-on settings are owner-only.")
				return
			}
		}
		if user.Role == roleViewer {
			s.log.Warn("refused: read-only account",
				"account", user.Email, "path", path)
			s.err(w, http.StatusForbidden,
				"this account can view but not change anything — ask an owner for the editor role")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func roleLabel(role string) string {
	switch role {
	case roleEditor:
		return "an editor"
	case roleViewer:
		return "a viewer"
	default:
		return role
	}
}
