package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"lab-cloud-manager/internal/store"
)

// Signing in through the lab's identity service.
//
// Authorization code flow with PKCE, run entirely on the server: the
// browser never holds a token, and the thing it ends up with is the
// same HttpOnly session cookie a local sign-in produces. Everything
// downstream — disabling an account, signing out, roles — keeps working
// without knowing which door someone came through.
//
// Written against net/http rather than an OIDC library, the way the
// Proxmox, Cloudflare, authentik and UniFi clients here are. The one
// thing that buys a library is ID token signature verification, and
// this flow doesn't need it: identity comes from a direct, TLS-pinned
// call to the provider's userinfo endpoint with an access token we
// just received from its token endpoint. There is no third party in
// the middle to forge anything. (OIDC Core 3.1.3.7 says as much: a
// token fetched straight from the token endpoint over TLS need not
// have its signature checked.)

const (
	// The round trip to the provider and back. Long enough to type a
	// password and answer MFA, short enough that a stale tab can't be
	// replayed tomorrow.
	oidcStateCookie = "lcm_oidc"
	oidcStateTTL    = 10 * time.Minute
	oidcHTTPTimeout = 10 * time.Second
)

// oidcDiscovery is the handful of discovery fields this flow uses.
type oidcDiscovery struct {
	Issuer        string `json:"issuer"`
	AuthzEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint string `json:"token_endpoint"`
	UserInfoURL   string `json:"userinfo_endpoint"`
	EndSessionURL string `json:"end_session_endpoint"`
}

// Discovery is stable configuration, so it's cached per issuer rather
// than fetched on every sign-in.
var (
	discoveryMu    sync.Mutex
	discoveryCache = map[string]*oidcDiscovery{}
)

func discover(ctx context.Context, issuer string) (*oidcDiscovery, error) {
	issuer = normalizeIssuer(issuer)
	discoveryMu.Lock()
	cached, ok := discoveryCache[issuer]
	discoveryMu.Unlock()
	if ok {
		return cached, nil
	}

	url := issuer + discoveryPath
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := (&http.Client{Timeout: oidcHTTPTimeout}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("reaching %s: %w", issuer, err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK {
		// Say who answered, not just that it wasn't a 200. A 404 here is
		// usually something other than the identity provider on the end
		// of that name — split-horizon DNS pointing at a reverse proxy
		// without the vhost, or an access proxy in front of it — and the
		// status alone sends you looking in the wrong place.
		return nil, fmt.Errorf("%s answered %s, not an OpenID configuration%s",
			url, res.Status, describeResponder(res, body))
	}
	var doc oidcDiscovery
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, fmt.Errorf("%s didn't return JSON%s", url, describeResponder(res, body))
	}
	if doc.AuthzEndpoint == "" || doc.TokenEndpoint == "" || doc.UserInfoURL == "" {
		return nil, fmt.Errorf("%s is missing an authorization, token or userinfo endpoint", issuer)
	}

	discoveryMu.Lock()
	discoveryCache[issuer] = &doc
	discoveryMu.Unlock()
	return &doc, nil
}

// normalizeIssuer takes what a person actually pastes.
//
// The discovery URL is the thing you have on screen when you're setting
// this up — it's what the provider shows you and what you curl to check
// — so pasting it into a box labelled "issuer" is the obvious mistake,
// and it produced a 404 on a doubled path that read as if the provider
// were unreachable.
func normalizeIssuer(issuer string) string {
	issuer = strings.TrimSpace(issuer)
	issuer = strings.TrimSuffix(strings.TrimRight(issuer, "/"), discoveryPath)
	return strings.TrimRight(issuer, "/")
}

const discoveryPath = "/.well-known/openid-configuration"

// describeResponder turns "404" into something you can act on: whatever
// the thing on the other end says about itself.
func describeResponder(res *http.Response, body []byte) string {
	var bits []string
	if server := res.Header.Get("Server"); server != "" {
		bits = append(bits, "served by "+server)
	}
	if ct := res.Header.Get("Content-Type"); ct != "" {
		bits = append(bits, ct)
	}
	// A title is the fastest way to recognise someone else's error page.
	if m := titleRe.FindSubmatch(body); m != nil {
		bits = append(bits, strconv.Quote(strings.TrimSpace(string(m[1]))))
	} else if snippet := strings.TrimSpace(string(body)); snippet != "" && len(snippet) < 200 {
		bits = append(bits, strconv.Quote(snippet))
	}
	if len(bits) == 0 {
		return ""
	}
	return " (" + strings.Join(bits, "; ") + ")"
}

var titleRe = regexp.MustCompile(`(?is)<title[^>]*>(.{0,120}?)</title>`)

// forgetDiscovery drops the cache when the provider is reconfigured,
// so pointing at a different issuer takes effect without a restart.
func forgetDiscovery() {
	discoveryMu.Lock()
	discoveryCache = map[string]*oidcDiscovery{}
	discoveryMu.Unlock()
}

// authProviders tells the sign-in page which doors exist. Public by
// necessity — it's read before anyone is signed in — and it says only
// that a provider is configured and what to call it.
func (s *Server) authProviders(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"oidc": nil}
	p, err := s.store.GetOIDCProvider(r.Context())
	if err == nil && p.Enabled && p.Issuer != "" && p.ClientID != "" {
		name := p.Name
		if name == "" {
			name = "single sign-on"
		}
		out["oidc"] = map[string]string{"name": name}
	}
	s.json(w, http.StatusOK, out)
}

// oidcStart sends the browser to the provider.
func (s *Server) oidcStart(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetOIDCProvider(r.Context())
	if err != nil || !p.Enabled {
		s.redirectToSignIn(w, r, "single sign-on isn't configured")
		return
	}
	doc, err := discover(r.Context(), p.Issuer)
	if err != nil {
		s.log.Error("oidc discovery", "issuer", p.Issuer, "error", err)
		s.redirectToSignIn(w, r, err.Error())
		return
	}

	state, err := randomToken()
	if err != nil {
		s.redirectToSignIn(w, r, "could not start sign-in")
		return
	}
	verifier, err := randomToken()
	if err != nil {
		s.redirectToSignIn(w, r, "could not start sign-in")
		return
	}
	// State and verifier ride in a short-lived cookie rather than server
	// memory, so a restart mid-sign-in costs a retry rather than a
	// mysterious failure, and nothing has to be swept later.
	http.SetCookie(w, &http.Cookie{
		Name:     oidcStateCookie,
		Value:    state + ":" + verifier,
		Path:     "/api/v1/auth/oidc",
		MaxAge:   int(oidcStateTTL.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode, // must survive the redirect back
		Secure:   isTLS(r),
	})

	challenge := sha256.Sum256([]byte(verifier))
	query := url.Values{
		"response_type":         {"code"},
		"client_id":             {p.ClientID},
		"redirect_uri":          {s.oidcRedirectURI(r)},
		"scope":                 {p.Scopes},
		"state":                 {state},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(challenge[:])},
		"code_challenge_method": {"S256"},
	}
	http.Redirect(w, r, doc.AuthzEndpoint+"?"+query.Encode(), http.StatusFound)
}

// oidcCallback finishes the round trip: exchange the code, ask who
// this is, and turn that into one of this console's own sessions.
func (s *Server) oidcCallback(w http.ResponseWriter, r *http.Request) {
	// Clear the state cookie whatever happens next.
	defer http.SetCookie(w, &http.Cookie{
		Name: oidcStateCookie, Value: "", Path: "/api/v1/auth/oidc",
		MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isTLS(r),
	})

	if provErr := r.URL.Query().Get("error"); provErr != "" {
		// The provider's own words are more useful than ours here.
		detail := r.URL.Query().Get("error_description")
		if detail == "" {
			detail = provErr
		}
		s.redirectToSignIn(w, r, detail)
		return
	}

	cookie, err := r.Cookie(oidcStateCookie)
	if err != nil {
		s.redirectToSignIn(w, r, "that sign-in took too long — try again")
		return
	}
	state, verifier, ok := strings.Cut(cookie.Value, ":")
	if !ok || state == "" || state != r.URL.Query().Get("state") {
		// A mismatch is what CSRF looks like, so it isn't explained away.
		s.log.Warn("oidc state mismatch")
		s.redirectToSignIn(w, r, "that sign-in couldn't be verified — try again")
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		s.redirectToSignIn(w, r, "the provider returned no authorization code")
		return
	}

	p, err := s.store.GetOIDCProvider(r.Context())
	if err != nil || !p.Enabled {
		s.redirectToSignIn(w, r, "single sign-on isn't configured")
		return
	}
	doc, err := discover(r.Context(), p.Issuer)
	if err != nil {
		s.redirectToSignIn(w, r, err.Error())
		return
	}

	claims, err := s.exchangeAndIdentify(r.Context(), p, doc, code, verifier, s.oidcRedirectURI(r))
	if err != nil {
		s.log.Error("oidc sign-in", "error", err)
		s.redirectToSignIn(w, r, err.Error())
		return
	}
	if claims.Email == "" {
		s.redirectToSignIn(w, r,
			"the provider didn't return an email address — add the email scope to this application")
		return
	}

	user, err := s.linkOIDCUser(r.Context(), p, claims)
	if err != nil {
		s.redirectToSignIn(w, r, err.Error())
		return
	}

	token, err := sessionToken()
	if err != nil {
		s.redirectToSignIn(w, r, "could not start a session")
		return
	}
	expires := time.Now().Add(sessionTTL)
	if err := s.store.CreateSession(r.Context(), token, user.ID, expires); err != nil {
		s.redirectToSignIn(w, r, "could not start a session")
		return
	}
	_ = s.store.TouchUserLogin(r.Context(), user.ID)
	s.setSessionCookie(w, r, token, expires)
	s.log.Info("sign-in via oidc", "email", user.Email, "role", user.Role)
	http.Redirect(w, r, "/", http.StatusFound)
}

// oidcClaims is what this console needs to know about a person.
type oidcClaims struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Username string `json:"preferred_username"`
	Verified *bool  `json:"email_verified"`
}

// exchangeAndIdentify trades the code for a token and asks the
// provider who it belongs to.
func (s *Server) exchangeAndIdentify(
	ctx context.Context,
	p *store.OIDCProvider,
	doc *oidcDiscovery,
	code, verifier, redirectURI string,
) (*oidcClaims, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"client_id":     {p.ClientID},
		"code_verifier": {verifier},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, doc.TokenEndpoint,
		strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if p.ClientSecret != "" {
		// Confidential client: basic auth is the form every provider
		// accepts, where client_secret_post is not universal.
		req.SetBasicAuth(url.QueryEscape(p.ClientID), url.QueryEscape(p.ClientSecret))
	}

	client := &http.Client{Timeout: oidcHTTPTimeout}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("exchanging the authorization code: %w", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("the provider refused the authorization code (%s): %s",
			res.Status, strings.TrimSpace(string(body)))
	}
	var token struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
	}
	if err := json.Unmarshal(body, &token); err != nil {
		return nil, fmt.Errorf("reading the token response: %w", err)
	}
	if token.AccessToken == "" {
		return nil, fmt.Errorf("the provider returned no access token")
	}

	// Identity comes from userinfo rather than the ID token: it's one
	// call to the same provider over the same TLS connection, and it
	// avoids hand-rolling JWT verification.
	infoReq, err := http.NewRequestWithContext(ctx, http.MethodGet, doc.UserInfoURL, nil)
	if err != nil {
		return nil, err
	}
	infoReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	infoRes, err := client.Do(infoReq)
	if err != nil {
		return nil, fmt.Errorf("asking the provider who this is: %w", err)
	}
	defer infoRes.Body.Close()
	if infoRes.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("the provider's userinfo endpoint answered %s", infoRes.Status)
	}
	var claims oidcClaims
	if err := json.NewDecoder(io.LimitReader(infoRes.Body, 1<<20)).Decode(&claims); err != nil {
		return nil, fmt.Errorf("reading the userinfo response: %w", err)
	}
	claims.Email = strings.ToLower(strings.TrimSpace(claims.Email))
	return &claims, nil
}

// linkOIDCUser matches the person to one of this console's accounts.
//
// Email is the join, because it's already this app's login name and
// the SSH username. Being in the directory is NOT by itself a way in:
// unless auto-create is on, an account has to exist here first.
func (s *Server) linkOIDCUser(
	ctx context.Context, p *store.OIDCProvider, claims *oidcClaims,
) (*store.User, error) {
	if claims.Verified != nil && !*claims.Verified {
		return nil, fmt.Errorf("%s isn't a verified address at the provider", claims.Email)
	}

	user, err := s.store.GetUserByEmail(ctx, claims.Email)
	switch {
	case err == nil:
		if !user.Active {
			return nil, fmt.Errorf("the account for %s is disabled here", claims.Email)
		}
		return user, nil
	case err != store.ErrNotFound:
		return nil, err
	}

	if !p.AutoCreate {
		return nil, fmt.Errorf(
			"%s signed in successfully, but has no account on this console — ask an owner to add it",
			claims.Email)
	}
	role := p.DefaultRole
	if !store.ValidRole(role) {
		role = store.RoleViewer
	}
	name := claims.Name
	if name == "" {
		name = claims.Username
	}
	// No password hash: this account exists only through the provider,
	// which is exactly the shape the local-accounts table left room for.
	user = &store.User{
		ID:     newID(),
		Email:  claims.Email,
		Name:   name,
		Role:   role,
		Active: true,
	}
	if err := s.store.CreateUser(ctx, user); err != nil {
		return nil, fmt.Errorf("creating an account for %s: %w", claims.Email, err)
	}
	s.log.Info("oidc account created", "email", user.Email, "role", user.Role)
	return user, nil
}

// oidcRedirectURI is where the provider sends the browser back. It has
// to match the application's configuration exactly, so it's derived
// from the request rather than configured twice.
func (s *Server) oidcRedirectURI(r *http.Request) string {
	scheme := "http"
	if isTLS(r) {
		scheme = "https"
	}
	host := r.Host
	if forwarded := r.Header.Get("X-Forwarded-Host"); forwarded != "" {
		host = forwarded
	}
	return scheme + "://" + host + "/api/v1/auth/oidc/callback"
}

// redirectToSignIn returns the browser to the page it came from with
// something readable. These are redirects, not JSON, because the
// browser is following links at this point — an API error body would
// render as a blank page with text on it.
func (s *Server) redirectToSignIn(w http.ResponseWriter, r *http.Request, message string) {
	http.Redirect(w, r, "/signin?error="+url.QueryEscape(message), http.StatusFound)
}

func randomToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
