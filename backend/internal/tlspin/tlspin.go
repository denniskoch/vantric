// Package tlspin verifies a TLS peer by the fingerprint of the exact
// certificate it presents, rather than by a chain back to a CA.
//
// WHY THIS EXISTS. Every backend record in this console carries an
// `insecureTLS` flag, and in a lab most of them have it set — a
// self-signed Proxmox is the normal case, not the exception. That flag
// turns verification OFF ENTIRELY, which means anything on the LAN can
// stand between the console and a hypervisor and collect a root token.
// The flag is honest about being a hole; it is still a hole.
//
// Pinning closes it without a CA. You read the fingerprint off the host
// once, the console stores it, and from then on a substituted
// certificate fails the handshake.
//
// THE CERTIFICATE, NOT THE PUBLIC KEY. Pinning the key would survive a
// renewal that reuses it, which sounds better and mostly isn't: a
// self-hosted certificate is a ten-year self-signed one that nobody
// will ever renew, and the tools that do renew (Proxmox's ACME,
// pvecm updatecerts) generate a fresh key anyway. So the extra
// indirection buys almost nothing here, and "the certificate changed"
// is the event worth being told about regardless.
package tlspin

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// ErrMismatch is a peer whose certificate is not the pinned one.
//
// A DISTINCT ERROR, because it is a distinct finding. A backend that
// is down and a backend presenting the wrong certificate look the same
// from a list of red dots, and only one of them means somebody is
// standing in the middle — so callers can tell them apart and the UI
// can say which happened.
var ErrMismatch = errors.New("tlspin: certificate does not match the pinned fingerprint")

// Fingerprint is the SHA-256 of a certificate's DER bytes, lowercase
// hex with colons — the form `openssl x509 -fingerprint -sha256`
// prints, so what the console shows can be compared against what the
// host says without anybody converting anything.
func Fingerprint(cert *x509.Certificate) string {
	sum := sha256.Sum256(cert.Raw)
	out := make([]string, len(sum))
	for i, b := range sum {
		out[i] = hex.EncodeToString([]byte{b})
	}
	return strings.ToUpper(strings.Join(out, ":"))
}

// Normalize accepts a fingerprint however somebody pasted it — with or
// without colons, any case, wrapped in whitespace — and returns the
// canonical form. A pin that fails because the operator copied it from
// a tool that uses a different separator is a pin they will turn off.
func Normalize(pin string) string {
	// A LABEL CAN CONTAIN HEX. `openssl x509 -fingerprint -sha256`
	// prints "SHA256 Fingerprint=A4:91:…" and people paste the line, not
	// the value — and "SHA256" quietly contributes A, 2, 5 and 6 to the
	// digits, so stripping non-hex characters alone turns a correct
	// paste into a rejected one. The label goes first.
	if _, after, found := strings.Cut(pin, "="); found {
		pin = after
	}
	trimmed := strings.TrimSpace(pin)
	for _, label := range []string{"SHA256:", "sha256:"} {
		if rest, found := strings.CutPrefix(trimmed, label); found {
			pin = rest
			break
		}
	}
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r >= '0' && r <= '9', r >= 'a' && r <= 'f', r >= 'A' && r <= 'F':
			return r
		default:
			return -1
		}
	}, pin)
	if len(cleaned) != sha256.Size*2 {
		return ""
	}
	out := make([]string, sha256.Size)
	for i := 0; i < sha256.Size; i++ {
		out[i] = cleaned[i*2 : i*2+2]
	}
	return strings.ToUpper(strings.Join(out, ":"))
}

// Config returns a TLS config that accepts exactly the pinned
// certificate.
//
// InsecureSkipVerify IS SET ON PURPOSE and is not a hole here: it
// switches off the CHAIN check, which a self-signed certificate could
// never pass, and VerifyPeerCertificate then does a stricter job than
// the chain would. Hostname and expiry go with it, deliberately — a
// pinned certificate is identified by being that certificate, and a
// ten-year self-signed cert issued for "capstan" would otherwise fail
// on a name nobody chose.
func Config(pin string) (*tls.Config, error) {
	want := Normalize(pin)
	if want == "" {
		return nil, fmt.Errorf("tlspin: %q is not a SHA-256 fingerprint", pin)
	}
	return &tls.Config{
		InsecureSkipVerify: true, //nolint:gosec // verified below, more strictly
		VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
			if len(rawCerts) == 0 {
				return ErrMismatch
			}
			// The LEAF only. Whatever a peer chooses to send after its
			// own certificate is its business and none of it is what we
			// pinned.
			leaf, err := x509.ParseCertificate(rawCerts[0])
			if err != nil {
				return fmt.Errorf("tlspin: unparsable certificate: %w", err)
			}
			if Fingerprint(leaf) != want {
				return fmt.Errorf("%w (got %s)", ErrMismatch, Fingerprint(leaf))
			}
			return nil
		},
	}, nil
}

// Peek reads the certificate a host is presenting WITHOUT verifying
// anything, so the console can show a fingerprint for somebody to
// confirm against the host.
//
// THIS IS THE UNSAFE MOMENT AND THE UI HAS TO SAY SO. Trusting what
// comes back here is trust-on-first-use: it is only as good as the
// network being clean right now, which is exactly the assumption
// pinning exists to remove. It is offered because the alternative is
// retyping 64 hex characters, and a fingerprint nobody can obtain is a
// fingerprint nobody will use — but the value belongs beside the
// command that prints the real one, not on its own.
func Peek(address string) (*x509.Certificate, error) {
	conn, err := tls.Dial("tcp", address, &tls.Config{InsecureSkipVerify: true}) //nolint:gosec // that is the point
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	certs := conn.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		return nil, errors.New("tlspin: the host presented no certificate")
	}
	return certs[0], nil
}
