package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/mail"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/store"
)

// IAM & Admin: this console's own accounts and roles.
//
// Not to be confused with the Identity Platform section, which manages
// the lab's identity service. These accounts decide who gets into this
// app; those decide who gets into everything else.

func (s *Server) iamRoutes(r chi.Router) {
	r.Get("/iam/roles", s.listRoles)
	r.Get("/iam/users", s.listUsers)
	r.Post("/iam/users", s.createUser)
	r.Get("/iam/users/{id}", s.getUser)
	r.Put("/iam/users/{id}", s.updateUser)
	r.Delete("/iam/users/{id}", s.deleteUser)
	r.Put("/iam/users/{id}/password", s.setUserPassword)
	r.Get("/iam/users/{id}/roles", s.getUserRoles)
	r.Put("/iam/users/{id}/roles", s.setUserRoles)
	// NOT UNDER /iam. This says what the CALLER holds, which is about
	// them rather than about administering accounts — filed under the
	// IAM section it was unreadable by everyone who isn't an IAM admin,
	// which is to say it broke the nav for exactly the people the nav
	// exists to narrow.
	r.Get("/sections", s.listSections)
	r.Get("/iam/oidc", s.getOIDC)
	r.Put("/iam/oidc", s.saveOIDC)
	r.Delete("/iam/oidc", s.deleteOIDC)
}

type roleInfo struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

// Roles are described here rather than in the UI so the vocabulary has
// one home. ENFORCEMENT IS IN rbac.go, as middleware — this list is the
// words, not the guard.
//
// This comment said the opposite for a while: that enforcement was "the
// next piece of work". It understated the code, which is the safer
// direction to be wrong in and still the wrong direction, because the
// reader it misleads is the one deciding whether their new endpoint
// needs a check of its own.
// roleCatalog is what the role picker renders: the basic roles, then
// each section's, with a sentence saying what the tier means there.
//
// BUILT FROM THE SECTIONS RATHER THAN LISTED, so a section added to
// roles.go appears here without anybody remembering to. A hand-written
// catalog is the same drift the old ownerOnly list had.
type roleCatalogEntry struct {
	Role  string `json:"role"`
	Label string `json:"label"`
	Help  string `json:"help"`
	// Section is empty for a basic role, which applies to all of them.
	Section string `json:"section"`
	Tier    string `json:"tier"`
}

func titleCase(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func buildRoleCatalog() []roleCatalogEntry {
	tierHelp := map[Tier]string{
		TierViewer: "Read %s and change nothing",
		TierEditor: "Create and change %s, but not its stored credentials",
		TierAdmin:  "Everything in %s, including the credentials it connects with",
	}
	catalog := []roleCatalogEntry{
		{roleOwner, "Owner", "Every section, including credentials and who can sign in", "", "admin"},
		{roleEditor, "Editor", "Create and change resources in every section, but no credentials", "", "editor"},
		{roleViewer, "Viewer", "Read every section and change nothing", "", "viewer"},
	}
	for _, sec := range sections {
		tiers := []Tier{TierViewer, TierEditor}
		if sec.Credentialed {
			tiers = append(tiers, TierAdmin)
		}
		for _, t := range tiers {
			catalog = append(catalog, roleCatalogEntry{
				Role:    sec.ID + "." + t.String(),
				Label:   sec.Label + " " + titleCase(t.String()),
				Help:    fmt.Sprintf(tierHelp[t], sec.Label),
				Section: sec.ID,
				Tier:    t.String(),
			})
		}
	}
	return catalog
}

func (s *Server) listRoles(w http.ResponseWriter, r *http.Request) {
	s.json(w, http.StatusOK, buildRoleCatalog())
}

// listSections is what the nav needs: which sections exist, and which
// of them this caller holds anything on. The frontend hides the rest —
// and the API refuses them either way, so the hiding is a courtesy
// rather than the boundary.
func (s *Server) listSections(w http.ResponseWriter, r *http.Request) {
	held := grants(rolesFrom(r.Context()))
	type view struct {
		ID    string `json:"id"`
		Label string `json:"label"`
		Tier  string `json:"tier"`
	}
	out := []view{}
	for _, sec := range sections {
		tier := held[sec.ID]
		if tier == TierNone {
			continue
		}
		out = append(out, view{sec.ID, sec.Label, tier.String()})
	}
	s.json(w, http.StatusOK, out)
}

// userRoles reports one account's bindings.
func (s *Server) getUserRoles(w http.ResponseWriter, r *http.Request) {
	roles, err := s.store.UserRoles(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "reading roles")
		return
	}
	sortRoles(roles)
	s.json(w, http.StatusOK, roles)
}

// setUserRoles replaces an account's bindings.
func (s *Server) setUserRoles(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Roles []string `json:"roles"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	for _, role := range req.Roles {
		if !ValidRole(role) {
			// Refused rather than dropped: a binding silently discarded
			// is an account that looks granted and isn't.
			s.err(w, http.StatusBadRequest, "no such role: "+role)
			return
		}
	}
	id := chi.URLParam(r, "id")
	target, err := s.store.GetUser(r.Context(), id)
	if err != nil {
		s.fail(w, err, "user")
		return
	}

	// THE CONSOLE CANNOT LOSE ITS LAST OWNER. The check is on the
	// binding rather than a column now, and still only counts ACTIVE
	// accounts, since a disabled one is not a way back in.
	hadOwner := false
	for _, role := range mustRoles(r.Context(), s, id) {
		if role == roleOwner {
			hadOwner = true
		}
	}
	keepsOwner := slices.Contains(req.Roles, roleOwner)
	if hadOwner && !keepsOwner && target.Active {
		owners, err := s.store.CountUsersWithRole(r.Context(), roleOwner)
		if err != nil {
			s.fail(w, err, "counting owners")
			return
		}
		if owners <= 1 {
			s.err(w, http.StatusBadRequest,
				"this is the last owner — grant owner to another account first")
			return
		}
	}

	if err := s.store.SetUserRoles(r.Context(), id, req.Roles); err != nil {
		s.fail(w, err, "saving roles")
		return
	}
	s.log.Info("roles changed", "account", target.Email, "roles", req.Roles)
	w.WriteHeader(http.StatusNoContent)
}

func mustRoles(ctx context.Context, s *Server, id string) []string {
	roles, err := s.store.UserRoles(ctx, id)
	if err != nil {
		return nil
	}
	return roles
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		s.fail(w, err, "listing users")
		return
	}
	byUser, err := s.store.RolesByUser(r.Context())
	if err != nil {
		s.fail(w, err, "listing roles")
		return
	}
	type view struct {
		store.User
		Roles []string `json:"roles"`
	}
	out := make([]view, 0, len(users))
	for _, u := range users {
		roles := byUser[u.ID]
		sortRoles(roles)
		out = append(out, view{User: u, Roles: roles})
	}
	s.json(w, http.StatusOK, out)
}

func (s *Server) getUser(w http.ResponseWriter, r *http.Request) {
	user, err := s.store.GetUser(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "user")
		return
	}
	s.json(w, http.StatusOK, user)
}

type userRequest struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	// Roles is the set this account holds. The old single `role` is
	// still accepted so an older client (or a bootstrap config) keeps
	// working; it means the same thing as one basic binding.
	Roles    []string `json:"roles"`
	Role     string   `json:"role"`
	Password string   `json:"password"`
	Active   bool     `json:"active"`
}

// requestedRoles folds the two spellings into one set and checks it.
func requestedRoles(req userRequest) ([]string, error) {
	roles := req.Roles
	if len(roles) == 0 && req.Role != "" {
		roles = []string{req.Role}
	}
	for _, role := range roles {
		if !ValidRole(role) {
			return nil, fmt.Errorf("no such role: %s", role)
		}
	}
	return roles, nil
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var req userRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if err := validateUser(req); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	// An empty password means an account that exists only to be matched
	// by single sign-on — which is how you let someone in without
	// letting in everyone the directory knows. The form says so; it
	// isn't something to discover by locking a colleague out.
	var hash string
	if req.Password != "" {
		if err := validatePassword(req.Password); err != nil {
			s.err(w, http.StatusBadRequest, err.Error())
			return
		}
		var err error
		if hash, err = hashPassword(req.Password); err != nil {
			s.fail(w, err, "hashing password")
			return
		}
	}
	roles, err := requestedRoles(req)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	user := &store.User{
		ID:           uuid.NewString(),
		Email:        req.Email,
		Name:         strings.TrimSpace(req.Name),
		Role:         req.Role,
		PasswordHash: hash,
		Active:       req.Active,
	}
	if err := s.store.CreateUser(r.Context(), user); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			s.err(w, http.StatusConflict, "an account with that email already exists")
			return
		}
		s.fail(w, err, "creating user")
		return
	}
	if err := s.store.SetUserRoles(r.Context(), user.ID, roles); err != nil {
		s.fail(w, err, "granting roles")
		return
	}
	s.log.Info("iam user created", "email", user.Email, "roles", roles)
	s.json(w, http.StatusCreated, user)
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	existing, err := s.store.GetUser(r.Context(), id)
	if err != nil {
		s.fail(w, err, "user")
		return
	}
	var req userRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if err := validateUser(req); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	// You can't disable the account you're signed in as, which is what
	// the form already says on the switch it greys out — and the API
	// didn't check, so anything that wasn't that form could do it. The
	// last-owner guard below doesn't catch it: with a colleague who is
	// also an owner it passes, the sessions are deleted, and the click
	// signs you out. Deleting yourself was refused all along; this is
	// the other half of the same sentence.
	//
	// Demotion is deliberately still allowed. Standing down when there
	// is another owner is a real thing to want, and the guard below
	// already refuses it when you are the last one.
	if me := userFrom(r.Context()); me != nil && me.ID == id && !req.Active {
		s.err(w, http.StatusConflict,
			"you can't disable the account you're signed in as")
		return
	}
	// Don't let the console lose its last administrator — by demotion or
	// by deactivation. Both are one click, and both are unrecoverable
	// from inside the app.
	//
	// THE CHECK IS ON THE BINDING NOW, not on a column. An account is an
	// owner because it holds the owner role, and roles are edited on
	// their own endpoint — so what this still has to catch is the other
	// half: deactivating the last one.
	roles, err := requestedRoles(req)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	held := mustRoles(r.Context(), s, id)
	wasOwner := slices.Contains(held, roleOwner)
	// An update that names no roles is not a request to remove them —
	// this form edits the name, email and whether the account is on.
	staysOwner := wasOwner
	if len(roles) > 0 {
		staysOwner = slices.Contains(roles, roleOwner)
	}
	if wasOwner && (!staysOwner || !req.Active) {
		others, err := s.store.CountUsersWithRole(r.Context(), roleOwner)
		if err != nil {
			s.fail(w, err, "counting owners")
			return
		}
		if others <= 1 {
			s.err(w, http.StatusConflict,
				"this is the last active owner; promote someone else first")
			return
		}
	}

	existing.Email = req.Email
	existing.Name = strings.TrimSpace(req.Name)
	existing.Role = req.Role
	wasActive := existing.Active
	if len(roles) > 0 {
		if err := s.store.SetUserRoles(r.Context(), id, roles); err != nil {
			s.fail(w, err, "saving roles")
			return
		}
	}
	existing.Active = req.Active
	existing.PasswordHash = "" // left alone by UpdateUser
	if err := s.store.UpdateUser(r.Context(), existing); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			s.err(w, http.StatusConflict, "an account with that email already exists")
			return
		}
		s.fail(w, err, "updating user")
		return
	}
	if wasActive && !existing.Active {
		// Disabling has to take effect now, not when their session runs out.
		_ = s.store.DeleteUserSessions(r.Context(), id)
	}
	s.json(w, http.StatusOK, existing)
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if me := userFrom(r.Context()); me != nil && me.ID == id {
		s.err(w, http.StatusConflict, "you can't delete the account you're signed in as")
		return
	}
	user, err := s.store.GetUser(r.Context(), id)
	if err != nil {
		s.fail(w, err, "user")
		return
	}
	if slices.Contains(mustRoles(r.Context(), s, id), roleOwner) {
		others, err := s.store.CountUsersWithRole(r.Context(), roleOwner)
		if err != nil {
			s.fail(w, err, "counting owners")
			return
		}
		if others <= 1 {
			s.err(w, http.StatusConflict,
				"this is the last active owner; promote someone else first")
			return
		}
	}
	if err := s.store.DeleteUser(r.Context(), id); err != nil {
		s.fail(w, err, "deleting user")
		return
	}
	s.log.Info("iam user deleted", "email", user.Email)
	w.WriteHeader(http.StatusNoContent)
}

// setUserPassword is an administrator resetting someone else's
// password — no current password, because the point is that they've
// lost it. Their sessions end with it.
func (s *Server) setUserPassword(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user, err := s.store.GetUser(r.Context(), id)
	if err != nil {
		s.fail(w, err, "user")
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := validatePassword(req.Password); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		s.fail(w, err, "hashing password")
		return
	}
	user.PasswordHash = hash
	if err := s.store.UpdateUser(r.Context(), user); err != nil {
		s.fail(w, err, "updating password")
		return
	}
	_ = s.store.DeleteUserSessions(r.Context(), id)
	s.log.Info("iam password reset", "email", user.Email)
	w.WriteHeader(http.StatusNoContent)
}

func validateUser(req userRequest) error {
	if req.Email == "" {
		return errValidation("an email address is required")
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		return errValidation("that doesn't look like an email address")
	}
	// The roles themselves are checked by requestedRoles, which knows
	// the section model. NOTHING IS REQUIRED HERE: an account with no
	// roles can sign in and see nothing, which is a real thing to want
	// for somebody on their way out, and the form warns rather than
	// refuses.
	if _, err := requestedRoles(req); err != nil {
		return errValidation(err.Error())
	}
	return nil
}

type errValidation string

func (e errValidation) Error() string { return string(e) }

// --- single sign-on configuration ---
//
// One provider, managed like every other backend credential in this
// app: a form, a write-only secret, and a check against the real
// service before it's stored.

type oidcRequest struct {
	Name         string `json:"name"`
	Issuer       string `json:"issuer"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	Scopes       string `json:"scopes"`
	AutoCreate   bool   `json:"autoCreate"`
	DefaultRole  string `json:"defaultRole"`
	Enabled      bool   `json:"enabled"`
}

// oidcView is the provider plus the redirect URI THIS SERVER will send.
// Computed here rather than in the browser, because behind a tunnel the
// two can disagree — and the one the provider must be told is this one.
type oidcView struct {
	*store.OIDCProvider
	RedirectURI string `json:"redirectUri"`
	// SiteURLSet says the address came from VANTRIC_SITE_URL rather than
	// being guessed from the request, which is what you want to see
	// when the console sits behind something.
	SiteURLSet bool `json:"siteUrlSet"`
}

func (s *Server) oidcView(r *http.Request, p *store.OIDCProvider) oidcView {
	if p == nil {
		p = &store.OIDCProvider{Scopes: "openid profile email", DefaultRole: store.RoleViewer}
	}
	return oidcView{
		OIDCProvider: p,
		RedirectURI:  s.oidcRedirectURI(r),
		SiteURLSet:   s.siteURL != "",
	}
}

func (s *Server) getOIDC(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetOIDCProvider(r.Context())
	if err == store.ErrNotFound {
		// Not configured yet, but the page still needs the redirect URI
		// to set up the application at the other end.
		s.json(w, http.StatusOK, s.oidcView(r, nil))
		return
	}
	if err != nil {
		s.fail(w, err, "sign-on provider")
		return
	}
	s.json(w, http.StatusOK, s.oidcView(r, p))
}

func (s *Server) saveOIDC(w http.ResponseWriter, r *http.Request) {
	var req oidcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Issuer = normalizeIssuer(req.Issuer)
	if msg := issuerSchemeError(req.Issuer); msg != "" {
		s.err(w, http.StatusBadRequest, msg)
		return
	}
	if strings.TrimSpace(req.ClientID) == "" {
		s.err(w, http.StatusBadRequest, "a client ID is required")
		return
	}
	if req.Scopes == "" {
		req.Scopes = "openid profile email"
	}
	if req.DefaultRole == "" {
		req.DefaultRole = store.RoleViewer
	}
	if !store.ValidRole(req.DefaultRole) {
		s.err(w, http.StatusBadRequest, "pick a role: owner, editor or viewer")
		return
	}
	// Check the issuer answers before storing it, the same way a
	// hypervisor or a DNS token is checked — a saved provider should be
	// one that works, not one you find out about at the sign-in page.
	forgetDiscovery()
	if _, err := discover(r.Context(), req.Issuer); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}

	p := &store.OIDCProvider{
		ID:           newID(),
		Name:         strings.TrimSpace(req.Name),
		Issuer:       req.Issuer,
		ClientID:     strings.TrimSpace(req.ClientID),
		ClientSecret: req.ClientSecret,
		Scopes:       req.Scopes,
		AutoCreate:   req.AutoCreate,
		DefaultRole:  req.DefaultRole,
		Enabled:      req.Enabled,
	}
	if err := s.store.SaveOIDCProvider(r.Context(), p); err != nil {
		s.fail(w, err, "saving the sign-on provider")
		return
	}
	s.log.Info("oidc provider saved", "issuer", p.Issuer, "enabled", p.Enabled,
		"autoCreate", p.AutoCreate)
	p.HasSecret = p.ClientSecret != ""
	s.json(w, http.StatusOK, s.oidcView(r, p))
}

func (s *Server) deleteOIDC(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteOIDCProvider(r.Context()); err != nil {
		s.fail(w, err, "removing the sign-on provider")
		return
	}
	forgetDiscovery()
	w.WriteHeader(http.StatusNoContent)
}

// newID is uuid.NewString, named here so the OIDC code doesn't import
// uuid for one call.
func newID() string { return uuid.NewString() }
