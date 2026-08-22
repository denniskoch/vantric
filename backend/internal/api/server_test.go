package api

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"vantric/internal/ai"
	"vantric/internal/aiaccount"
	"vantric/internal/database"
	"vantric/internal/dns"
	"vantric/internal/hypervisor"
	"vantric/internal/identity"
	"vantric/internal/inventory"
	"vantric/internal/monitoring"
	"vantric/internal/network"
	"vantric/internal/storage"
	"vantric/internal/store"
)

// Every other test in this package builds &Server{} with the two or
// three fields it needs, which is why a field added to the struct and
// forgotten in New() passed the whole suite and then panicked on the
// first request: signIns was nil, and sign-in — the one endpoint that
// must work before anything else can — answered 500.
//
// So one test goes through the real constructor and the real router.
func TestNewServerAnswersOnTheRoutesThatRunBeforeASession(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open("sqlite", filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	srv := New(st,
		hypervisor.NewRegistry(), dns.NewRegistry(), database.NewRegistry(),
		identity.NewRegistry(), network.NewRegistry(), inventory.NewRegistry(),
		storage.NewRegistry(), ai.NewRegistry(), aiaccount.NewRegistry(),
		monitoring.NewRegistry(),
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		"", dir, "", "", SSHOptions{}, "guacd:4822")
	router := srv.Router()

	cases := []struct {
		name, method, path, body string
		want                     int
	}{
		{"a wrong sign-in is refused, not fumbled", http.MethodPost, "/api/v1/auth/login",
			`{"email":"nobody@example.com","password":"wrong"}`, http.StatusUnauthorized},
		{"who am I, with no session", http.MethodGet, "/api/v1/auth/me", "", http.StatusUnauthorized},
		{"anything else needs a session", http.MethodGet, "/api/v1/instances", "", http.StatusUnauthorized},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			if w.Code != c.want {
				t.Errorf("%s %s: status %d, want %d — body %q",
					c.method, c.path, w.Code, c.want, w.Body.String())
			}
		})
	}

	// And the limiter is reachable at all, which is the specific thing
	// that was nil.
	if locked, _ := srv.signIns.locked("addr:198.51.100.1"); locked {
		t.Error("a fresh limiter reports a lockout")
	}
}
