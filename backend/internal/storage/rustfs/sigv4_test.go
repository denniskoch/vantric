package rustfs

import (
	"net/http"
	"net/url"
	"testing"
)

// The canonical query is one of the two places a SigV4 bug hides, and it
// hides well: the request is well-formed, the credential is right, and
// the store answers SignatureDoesNotMatch — which reads as a wrong
// secret. So the encoding is pinned here rather than discovered against
// a live store with a policy that happens to have a space in its name.
func TestEncodeQuery(t *testing.T) {
	cases := []struct {
		name string
		in   url.Values
		want string
	}{
		{"empty", url.Values{}, ""},
		{"sorted by key", url.Values{"b": {"2"}, "a": {"1"}}, "a=1&b=2"},
		{
			// The one url.Values.Encode gets wrong for this purpose: it
			// writes "+" here.
			"space is %20 and never +",
			url.Values{"policyName": {"read only"}},
			"policyName=read%20only",
		},
		{
			// A literal plus must survive as %2B, or it would decode back
			// as a space on the far side.
			"plus is escaped",
			url.Values{"token": {"a+b"}},
			"token=a%2Bb",
		},
		{
			// Unreserved characters stay bare — escaping "~" is the other
			// classic mismatch with AWS's rules.
			"unreserved stay bare",
			url.Values{"k": {"aZ0-_.~"}},
			"k=aZ0-_.~",
		},
		{
			// Continuation tokens are base64 and routinely carry "/" and
			// "=", both of which have to be escaped in a query value.
			"base64 token",
			url.Values{"continuation-token": {"a/b=="}},
			"continuation-token=a%2Fb%3D%3D",
		},
		{"empty value keeps its =", url.Values{"acl": {""}}, "acl="},
	}
	for _, c := range cases {
		if got := encodeQuery(c.in); got != c.want {
			t.Errorf("%s: encodeQuery = %q, want %q", c.name, got, c.want)
		}
	}
}

// What is SIGNED has to match what is SENT. The URL is built by
// encodeQuery and the signature is derived by re-parsing that URL, so
// this checks the round trip rather than the encoder alone — a decode
// that turned "%20" back into something re-encoded as "+" would leave
// both halves individually reasonable and the pair broken.
func TestCanonicalQueryRoundTrip(t *testing.T) {
	values := url.Values{
		"policyName":  {"read only"},
		"userOrGroup": {"backups+2026"},
		"isGroup":     {"false"},
	}
	raw := encodeQuery(values)
	req, err := http.NewRequest(http.MethodPut, "http://example.invalid/x?"+raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := canonicalQuery(req); got != raw {
		t.Errorf("canonicalQuery = %q, but the URL carries %q", got, raw)
	}
}

// The exact strings this store returns for a missing access key, copied
// from it rather than from the docs. String matching is the only way to
// classify three of these four — see missingUser — so the strings are
// pinned here, and the policy case is pinned alongside them because
// reporting that as a missing key is the failure mode worth preventing.
func TestMissingUser(t *testing.T) {
	yes := []string{
		"user 'no-such' does not exist",
		"failed to set user status: user 'no-such' does not exist",
		"failed to query temporary user state: user 'no-such' does not exist",
		"user not found",
	}
	for _, m := range yes {
		if !missingUser(m) {
			t.Errorf("missingUser(%q) = false, want true", m)
		}
	}
	no := []string{
		"policy does not exist",
		"failed to create user: invalid secret key length",
		"failed to create user: invalid access key length",
		"invalid account status: banana",
	}
	for _, m := range no {
		if missingUser(m) {
			t.Errorf("missingUser(%q) = true, want false", m)
		}
	}
}
