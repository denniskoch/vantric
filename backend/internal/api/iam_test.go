package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"vantric/internal/store"
)

// The form already greys out this switch and says "You can't disable the
// account you're signed in as". The API didn't check, so anything that
// wasn't that form could — and the frontend deciding what to OFFER is
// worth nothing on its own, which is the rule this app states about
// every other permission.
//
// The last-owner guard doesn't cover it: with a second owner on file it
// passes, the sessions are deleted, and the click signs you out.
func TestUpdateUserRefusesToDisableYourself(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open("sqlite", filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ctx := context.Background()

	me := &store.User{
		ID: "me", Email: "me@example.com", Name: "Me",
		Role: store.RoleOwner, Active: true, PasswordHash: "x",
	}
	colleague := &store.User{
		ID: "them", Email: "them@example.com", Name: "Them",
		Role: store.RoleOwner, Active: true, PasswordHash: "x",
	}
	for _, u := range []*store.User{me, colleague} {
		if err := st.CreateUser(ctx, u); err != nil {
			t.Fatal(err)
		}
	}

	s := &Server{store: st, log: slog.New(slog.NewTextHandler(io.Discard, nil))}

	update := func(targetID string, body string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(http.MethodPut,
			"/api/v1/iam/users/"+targetID, strings.NewReader(body))
		routeCtx := chi.NewRouteContext()
		routeCtx.URLParams.Add("id", targetID)
		ctx := context.WithValue(r.Context(), chi.RouteCtxKey, routeCtx)
		ctx = context.WithValue(ctx, ctxUserKey{}, me)
		w := httptest.NewRecorder()
		s.updateUser(w, r.WithContext(ctx))
		return w
	}

	w := update("me", `{"email":"me@example.com","name":"Me","role":"owner","active":false}`)
	if w.Code != http.StatusConflict {
		t.Errorf("disabling yourself: status %d, want 409 — body %q", w.Code, w.Body.String())
	}
	if after, err := st.GetUser(ctx, "me"); err != nil || !after.Active {
		t.Error("the account was disabled anyway")
	}

	// The neighbouring cases still work: editing yourself without
	// disabling, and disabling somebody else.
	if w := update("me", `{"email":"me@example.com","name":"Renamed","role":"owner","active":true}`); w.Code != http.StatusOK {
		t.Errorf("editing your own account: status %d, want 200 — body %q", w.Code, w.Body.String())
	}
	if w := update("them", `{"email":"them@example.com","name":"Them","role":"editor","active":false}`); w.Code != http.StatusOK {
		t.Errorf("disabling a colleague: status %d, want 200 — body %q", w.Code, w.Body.String())
	}
}

// The operations feed spelled this key "serverId", left over from the
// rename. The frontend's own Operation type declares hypervisorId, so
// the field never arrived at all — free to fix, and wrong to leave.
func TestOperationCarriesHypervisorID(t *testing.T) {
	encoded, err := json.Marshal(Operation{ID: "op", HypervisorID: "hv"})
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if _, stale := decoded["serverId"]; stale {
		t.Error("an operation still serialises the pre-rename serverId")
	}
	if decoded["hypervisorId"] != "hv" {
		t.Errorf("hypervisorId is %v, want \"hv\"", decoded["hypervisorId"])
	}
}
