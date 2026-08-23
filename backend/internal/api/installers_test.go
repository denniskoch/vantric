package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"vantric/internal/store"
)

// The installer download token is a CREDENTIAL: a fleetd package carries
// the enrollment secret, so whoever has the token can enrol a host into
// your Fleet instance. Rotating it was owner-only — ownerOnly gates
// mutations — while GET /installers handed it to anyone signed in,
// including the role whose whole promise is that it can't change
// anything.
func TestListInstallersWithholdsTheTokenFromNonOwners(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open("sqlite", filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	s := &Server{
		store:   st,
		dataDir: dir,
		log:     slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	list := func(role string) installersResponse {
		t.Helper()
		r := httptest.NewRequest("GET", "/api/v1/installers", nil)
		r = r.WithContext(context.WithValue(r.Context(), ctxUserKey{},
			&store.User{Email: "someone@example.com", Role: role}))
		w := httptest.NewRecorder()
		s.listInstallers(w, r)
		if w.Code != 200 {
			t.Fatalf("as %s: status %d, want 200 — the listing itself stays open",
				roleLabel(role), w.Code)
		}
		var out installersResponse
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}

	if got := list(roleViewer).Token; got != "" {
		t.Errorf("a viewer was given the download token: %q", got)
	}

	// And the token is MINTED on first use, so a viewer opening the page
	// must not be what brings the credential into existence.
	if _, err := st.GetSetting(context.Background(), installerTokenKey); err == nil {
		t.Error("a viewer's listing minted the download token")
	}

	// An editor enrols machines, which is what the token is for.
	for _, role := range []string{roleEditor, roleOwner} {
		if list(role).Token == "" {
			t.Errorf("%s was not given the download token", roleLabel(role))
		}
	}
}
