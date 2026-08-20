package api

import (
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
)

// The origin check this replaces was two substring tests, and the two
// cases that matter are exactly the ones a substring test waves through:
// a domain that merely ENDS with the console's, and one that merely
// CONTAINS "localhost". Both are registrable today. Neither was
// exploitable — SameSite=Lax on the session cookie is what actually
// stops a cross-site handshake — which is precisely why it needs a test
// rather than a reader's confidence.
func TestSameOrigin(t *testing.T) {
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))

	cases := []struct {
		name    string
		siteURL string
		host    string // what the request was addressed to
		origin  string // what the browser said
		allowed bool
	}{
		{"no origin is not a browser", "", "vantric.example.com", "", true},
		{"same host", "", "vantric.example.com", "https://vantric.example.com", true},
		{"same host, different case", "", "vantric.example.com", "https://VANTRIC.example.com", true},

		// HasSuffix(origin, r.Host)
		{"a domain ending with ours", "", "vantric.example.com", "https://evilvantric.example.com", false},
		{"a subdomain we never served", "", "vantric.example.com", "https://x.vantric.example.com.attacker.test", false},

		// Contains(origin, "localhost")
		{"localhost as a label", "", "vantric.example.com", "https://localhost.attacker.example", false},
		{"localhost in a path", "", "vantric.example.com", "https://attacker.example/localhost", false},

		{"an unrelated site", "", "vantric.example.com", "https://attacker.example", false},
		{"a port that isn't ours", "", "vantric.example.com", "https://vantric.example.com:8443", false},
		{"an unparseable origin", "", "vantric.example.com", "null", false},
		{"an empty-host origin", "", "vantric.example.com", "https://", false},

		// make dev: the page is on 5173, the API on 8080.
		{"the dev server", "", "localhost:8080", "http://localhost:5173", true},
		{"the dev server by address", "", "localhost:8080", "http://127.0.0.1:5173", true},

		// Behind the tunnel the request is addressed to whatever
		// cloudflared dialled, so r.Host alone would refuse every real
		// handshake. This is the case siteOrigin exists for.
		{"through the tunnel", "https://vantric.example.com", "app:8080",
			"https://vantric.example.com", true},
		{"through the tunnel, an impostor", "https://vantric.example.com", "app:8080",
			"https://vantric.example.com.attacker.test", false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := &Server{log: quiet, siteURL: c.siteURL}
			r := httptest.NewRequest("GET", "/api/v1/instances/web-1/ssh", nil)
			r.Host = c.host
			if c.origin != "" {
				r.Header.Set("Origin", c.origin)
			}
			if got := s.sameOrigin(r); got != c.allowed {
				t.Errorf("origin %q against host %q: got %v, want %v",
					c.origin, c.host, got, c.allowed)
			}
		})
	}
}
