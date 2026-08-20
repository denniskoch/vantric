package api

import "testing"

// The OIDC flow deliberately does not verify the ID token signature,
// because identity comes from a direct TLS call to the userinfo
// endpoint. That reasoning is right and rests entirely on the TLS: over
// http, anyone on the path can answer as any user and nothing is left to
// catch it. Nothing checked the scheme, at save time or at use time.
func TestIssuerMustBeHTTPS(t *testing.T) {
	cases := []struct {
		issuer string
		ok     bool
	}{
		{"https://auth.example.com", true},
		{"https://auth.example.com:9443", true},
		{"http://auth.example.com", false},
		{"http://192.168.80.10:9000", false},
		{"HTTP://auth.example.com", false},
		{"ftp://auth.example.com", false},
		{"auth.example.com", false},
		// Nothing is on the path to your own machine, and refusing this
		// would block a local provider for no gain.
		{"http://localhost:9000", true},
		{"http://127.0.0.1:9000", true},
	}
	for _, c := range cases {
		msg := issuerSchemeError(c.issuer)
		if (msg == "") != c.ok {
			t.Errorf("%q: error %q, wanted ok=%v", c.issuer, msg, c.ok)
		}
	}
}
