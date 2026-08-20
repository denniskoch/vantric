package api

import "net/http"

// Response headers, as depth rather than as a fix for anything.
//
// The frontend is clean on its own account — no dangerouslySetInnerHTML,
// no eval, nothing read out of localStorage but a terminal theme — so
// none of this is standing between an attacker and anything today. It is
// here because the cost is four headers and the thing it covers is the
// mistake nobody plans to make.
//
// The policy can be this strict because the app already earns it: every
// asset is served from this origin, the brand marks are inline SVG
// rather than CDN images, and the built index.html carries no inline
// script. Two relaxations are real and worth naming:
//
//	style-src 'unsafe-inline'  MUI injects its styles at runtime through
//	                           emotion. Removing it means adopting a
//	                           nonce and threading it through the style
//	                           engine, which buys little against a page
//	                           with no injection point.
//	img/font-src data:         icons and fonts inlined by the bundler.
//
// connect-src 'self' covers the SSH websocket: CSP3 matches ws:// and
// wss:// on the page's own origin under 'self', which is the one thing
// in here worth checking rather than assuming — see the note in the
// commit, it was checked against the built app.
//
// In development this is served to API responses only: Vite serves the
// page on :5173 and sets no policy, so `make dev` is unaffected either
// way.
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data:; " +
	"font-src 'self' data:; " +
	"connect-src 'self'; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"form-action 'self'; " +
	"frame-ancestors 'none'"

// securityHeaders sets them on everything this server answers.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		// Don't let a browser decide a response is HTML because it
		// looks like it — an uploaded installer is served as an octet
		// stream and should stay one.
		h.Set("X-Content-Type-Options", "nosniff")
		// frame-ancestors above is the modern spelling; this is the one
		// older browsers read.
		h.Set("X-Frame-Options", "DENY")
		// A console URL can name an instance, a database or a CVE.
		// Don't post that to whatever somebody clicks through to.
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}
