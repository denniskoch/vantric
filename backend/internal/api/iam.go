package api

import (
	"encoding/json"
	"net/http"
	"net/mail"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"lab-cloud-manager/internal/store"
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
}

type roleInfo struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

// Roles are described here rather than in the UI so the vocabulary has
// one home. They are recorded and shown; enforcing them per-endpoint is
// the next piece of work, and the UI says so rather than implying a
// guard that isn't there.
var roleCatalog = []roleInfo{
	{store.RoleOwner, "Owner", "Full control, including managing accounts and backends"},
	{store.RoleEditor, "Editor", "Create and change resources, but not accounts"},
	{store.RoleViewer, "Viewer", "Read-only access to everything"},
}

func (s *Server) listRoles(w http.ResponseWriter, r *http.Request) {
	s.json(w, http.StatusOK, roleCatalog)
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		s.fail(w, err, "listing users")
		return
	}
	s.json(w, http.StatusOK, users)
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
	Email    string `json:"email"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Password string `json:"password"`
	Active   bool   `json:"active"`
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
	// An account with no password can't sign in, which is a fine way to
	// pre-create someone for SSO but a confusing way to create the
	// person you're about to hand a laptop to. Require one here.
	if err := validatePassword(req.Password); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		s.fail(w, err, "hashing password")
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
	s.log.Info("iam user created", "email", user.Email, "role", user.Role)
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
	// Don't let the console lose its last administrator — by demotion or
	// by deactivation. Both are one click, and both are unrecoverable
	// from inside the app.
	if existing.Role == store.RoleOwner && (req.Role != store.RoleOwner || !req.Active) {
		others, err := s.store.CountOwners(r.Context(), id)
		if err != nil {
			s.fail(w, err, "counting owners")
			return
		}
		if others == 0 {
			s.err(w, http.StatusConflict,
				"this is the last active owner; promote someone else first")
			return
		}
	}

	existing.Email = req.Email
	existing.Name = strings.TrimSpace(req.Name)
	existing.Role = req.Role
	wasActive := existing.Active
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
	if user.Role == store.RoleOwner {
		others, err := s.store.CountOwners(r.Context(), id)
		if err != nil {
			s.fail(w, err, "counting owners")
			return
		}
		if others == 0 {
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
	if !store.ValidRole(req.Role) {
		return errValidation("pick a role: owner, editor or viewer")
	}
	return nil
}

type errValidation string

func (e errValidation) Error() string { return string(e) }
