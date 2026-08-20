package api

import (
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// Where a request came from, and who is allowed to say so.
//
// chi's middleware.RealIP rewrote r.RemoteAddr from X-Forwarded-For
// whenever the header was present, and clientAddr read the header
// directly for the audit log. Neither asked whether the request had come
// through a proxy at all — so anyone reaching the console directly could
// name their own address, and the audit log is the one record of who did
// what that exists nowhere else. It would also have defeated any
// address-based rate limit built on top of it.
//
// The rule is now: BELIEVE A FORWARDING HEADER ONLY FROM A PEER YOU HAVE
// NAMED. Unset means trust nothing, which is correct on a laptop and on
// the LAN — the address recorded is the one that actually opened the
// connection, and no header can change it.
//
// X-Forwarded-Proto is deliberately NOT gated this way (see isTLS).
// Forging it only changes whether that caller's own session cookie is
// marked Secure, which can lock the forger out of their own session and
// does nothing to anybody else.

// parseTrustedProxies reads the config string into prefixes. A bare
// address becomes a single-host prefix. Anything unparseable is dropped
// with a warning rather than failing startup: a console that won't boot
// over a typo in an optional setting is worse than one that boots
// trusting less than you meant.
func parseTrustedProxies(list string, log *slog.Logger) []netip.Prefix {
	var out []netip.Prefix
	for _, entry := range strings.Split(list, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if prefix, err := netip.ParsePrefix(entry); err == nil {
			out = append(out, prefix)
			continue
		}
		if addr, err := netip.ParseAddr(entry); err == nil {
			out = append(out, netip.PrefixFrom(addr, addr.BitLen()))
			continue
		}
		log.Warn("trusted proxies: ignoring an entry that isn't an address or CIDR",
			"entry", entry)
	}
	return out
}

// trusted reports whether a peer address may speak for someone else.
func (s *Server) trusted(addr string) bool {
	if len(s.trustedProxies) == 0 {
		return false
	}
	ip, err := netip.ParseAddr(addr)
	if err != nil {
		return false
	}
	ip = ip.Unmap()
	for _, prefix := range s.trustedProxies {
		if prefix.Contains(ip) {
			return true
		}
	}
	return false
}

// realIP rewrites RemoteAddr from the forwarding headers, but only when
// the peer is one this console was told to believe. It replaces chi's
// middleware.RealIP, which could not be told anything.
func (s *Server) realIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if forwarded := s.forwardedFor(r); forwarded != "" {
			r.RemoteAddr = forwarded
		}
		next.ServeHTTP(w, r)
	})
}

// forwardedFor is the client address a trusted proxy is reporting, or ""
// when there is no trusted proxy in front.
//
// Two headers, in the order that survives a forgery:
//
// CF-Connecting-IP is set by Cloudflare and OVERWRITTEN on every
// request, so a client cannot inject one. This deployment publishes
// through a Cloudflare tunnel, which is exactly the case where the other
// header cannot be read simply.
//
// X-Forwarded-For is a list each hop APPENDS to, so the leftmost entry —
// the one everybody reaches for as "the client" — is whatever the client
// sent, if it sent anything. The rightmost is the address the nearest
// proxy actually observed, and is the only entry no client can choose.
// Behind one reverse proxy that is the client; behind several it is the
// hop before, which is a smaller lie than trusting the caller.
func (s *Server) forwardedFor(r *http.Request) string {
	peer, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		peer = r.RemoteAddr
	}
	if !s.trusted(peer) {
		return ""
	}
	if cf := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); cf != "" {
		return cf
	}
	entries := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(entries) - 1; i >= 0; i-- {
		if entry := strings.TrimSpace(entries[i]); entry != "" {
			return entry
		}
	}
	return ""
}
