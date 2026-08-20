package api

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The audit log is described as the record that exists nowhere else, and
// X-Forwarded-For was believed from whoever sent it. Anyone reaching the
// console directly could therefore write any address they liked into it,
// and any address-based rate limit would have inherited the same hole.
func TestClientAddrBelievesOnlyTrustedProxies(t *testing.T) {
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))

	cases := []struct {
		name    string
		trusted string
		peer    string
		headers map[string]string
		want    string
	}{
		{
			name: "nothing trusted: the peer is the answer",
			peer: "192.168.80.44:51000",
			headers: map[string]string{
				"X-Forwarded-For": "10.9.9.9",
			},
			want: "192.168.80.44",
		},
		{
			name: "nothing trusted, no headers",
			peer: "192.168.80.44:51000",
			want: "192.168.80.44",
		},
		{
			name:    "a trusted proxy is believed",
			trusted: "172.18.0.0/16",
			peer:    "172.18.0.5:44000",
			headers: map[string]string{"X-Forwarded-For": "203.0.113.7"},
			want:    "203.0.113.7",
		},
		{
			name:    "an untrusted peer inside no range at all",
			trusted: "172.18.0.0/16",
			peer:    "192.168.80.44:51000",
			headers: map[string]string{"X-Forwarded-For": "203.0.113.7"},
			want:    "192.168.80.44",
		},
		{
			// Each hop APPENDS, so the leftmost entry is whatever the
			// client sent. Taking it is the common mistake and the one
			// that leaves the header forgeable through a real proxy.
			name:    "a client-injected entry does not win",
			trusted: "172.18.0.0/16",
			peer:    "172.18.0.5:44000",
			headers: map[string]string{"X-Forwarded-For": "1.2.3.4, 203.0.113.7"},
			want:    "203.0.113.7",
		},
		{
			// Cloudflare overwrites this one on every request, so it
			// survives a client that sends its own.
			name:    "Cloudflare's header wins where it exists",
			trusted: "172.18.0.0/16",
			peer:    "172.18.0.5:44000",
			headers: map[string]string{
				"CF-Connecting-IP": "203.0.113.7",
				"X-Forwarded-For":  "1.2.3.4",
			},
			want: "203.0.113.7",
		},
		{
			name:    "a bare address is a valid trusted entry",
			trusted: "10.0.0.1",
			peer:    "10.0.0.1:9000",
			headers: map[string]string{"X-Forwarded-For": "203.0.113.7"},
			want:    "203.0.113.7",
		},
		{
			name:    "an unparseable trusted entry is ignored, not fatal",
			trusted: "not-an-address",
			peer:    "192.168.80.44:51000",
			headers: map[string]string{"X-Forwarded-For": "203.0.113.7"},
			want:    "192.168.80.44",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := &Server{log: quiet, trustedProxies: parseTrustedProxies(c.trusted, quiet)}
			r := httptest.NewRequest("POST", "/api/v1/auth/login", nil)
			r.RemoteAddr = c.peer
			for k, v := range c.headers {
				r.Header.Set(k, v)
			}
			var got string
			s.realIP(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				got = clientAddr(r)
			})).ServeHTTP(httptest.NewRecorder(), r)
			if got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}
}
