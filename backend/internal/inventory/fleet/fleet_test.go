package fleet

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"vantric/internal/inventory"
)

// Fleet stores the SMBIOS UUID in whatever case osquery reported —
// uppercase from WMI on Windows and IOKit on macOS, lowercase from
// /sys/class/dmi/id/product_uuid on Linux — and its identifier lookup
// is case-sensitive. The hypervisor reports lowercase for all of them.
//
// So this is not a tidiness test. Before the retry, a lowercase lookup
// 404'd on every Windows and macOS guest, and a 404 here means "no such
// host", which the instance page states as "this guest isn't enrolled
// in your inventory service" — a confident wrong answer about a machine
// Fleet was actively reporting on, while the Devices page showed the
// same machine correctly because it compares in Go.
func TestHostByUUIDTriesBothCases(t *testing.T) {
	const lower = "f1d22049-180a-481c-ab84-27bfafd5f13b"
	upper := strings.ToUpper(lower)

	for _, stored := range []string{lower, upper} {
		var asked []string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ident := strings.TrimPrefix(r.URL.Path, "/api/v1/fleet/hosts/identifier/")
			asked = append(asked, ident)
			if ident != stored {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"host":{"id":7,"hostname":"DC1","uuid":"` + stored + `"}}`))
		}))

		p := New(Config{BaseURL: srv.URL, Token: "t"})
		// Always asked in the hypervisor's case, which is lowercase.
		detail, err := p.HostByUUID(context.Background(), lower)
		srv.Close()
		if err != nil {
			t.Fatalf("stored=%s: HostByUUID: %v (asked %v)", stored, err, asked)
		}
		if detail.Host.Hostname != "DC1" {
			t.Errorf("stored=%s: hostname = %q", stored, detail.Host.Hostname)
		}
		// The matching case must not cost a second request.
		if stored == lower && len(asked) != 1 {
			t.Errorf("a hit should take one request, took %d: %v", len(asked), asked)
		}
	}
}

// A miss is still a miss: retrying the other case must not turn "not
// enrolled" into something that never terminates or reports wrongly.
func TestHostByUUIDUnknownStaysNotFound(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	p := New(Config{BaseURL: srv.URL, Token: "t"})
	_, err := p.HostByUUID(context.Background(), "f1d22049-180a-481c-ab84-27bfafd5f13b")
	if !errors.Is(err, inventory.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
	// Lower and upper — the third candidate is a duplicate and is skipped.
	if calls != 2 {
		t.Errorf("tried %d cases, want 2", calls)
	}
}

// An auth failure must not be retried in another case: the second call
// fails identically, and reporting it as "not found" would send someone
// looking for a missing host instead of a bad token.
func TestHostByUUIDDoesNotRetryRealFailures(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	p := New(Config{BaseURL: srv.URL, Token: "t"})
	_, err := p.HostByUUID(context.Background(), "f1d22049-180a-481c-ab84-27bfafd5f13b")
	if err == nil || errors.Is(err, inventory.ErrNotFound) {
		t.Fatalf("err = %v, want a real failure", err)
	}
	if calls != 1 {
		t.Errorf("made %d calls, want 1", calls)
	}
}
