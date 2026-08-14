package api

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"lab-cloud-manager/internal/store"
)

// Local authentication: an email and a password checked against this
// console's own account table.
//
// It is the FALLBACK, and it is meant to stay. Signing in through the
// lab's identity provider is the better door, but a console that can
// only be reached through another service is a console you can't reach
// when that service is what's broken — which is exactly when you want
// it. So local accounts are first, and SSO joins them later.

const (
	sessionCookie = "lcm_session"
	sessionTTL    = 12 * time.Hour
	// bcrypt's default cost is cheap enough to feel instant and dear
	// enough to make an offline guess expensive.
	bcryptCost = bcrypt.DefaultCost
)

// ctxUserKey carries the signed-in account down the request.
type ctxUserKey struct{}

// userFrom returns the account this request is authenticated as, if
// any. Handlers use it to answer "who is this" — not "may they",
// which is a question the role model doesn't enforce yet.
func userFrom(ctx context.Context) *store.User {
	u, _ := ctx.Value(ctxUserKey{}).(*store.User)
	return u
}

// requireAuth rejects anything without a valid session.
//
// Failures are 401 with nothing else said: which half of a wrong
// email/password pair was wrong is information an attacker wants and a
// user doesn't need.
func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := s.sessionUser(r)
		if user == nil {
			s.err(w, http.StatusUnauthorized, "sign in to continue")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxUserKey{}, user)))
	})
}

// sessionUser resolves the request's cookie, returning nil when it's
// missing, expired, or belongs to an account that's been disabled or
// deleted since.
func (s *Server) sessionUser(r *http.Request) *store.User {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return nil
	}
	user, err := s.store.UserBySession(r.Context(), cookie.Value)
	if err != nil {
		return nil
	}
	return user
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	user, err := s.store.GetUserByEmail(r.Context(), req.Email)
	if err != nil || !user.Active || user.PasswordHash == "" {
		// Compare against a throwaway hash anyway, so a missing account
		// doesn't answer faster than a wrong password and become a way
		// to enumerate who exists.
		_ = bcrypt.CompareHashAndPassword(
			[]byte("$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"),
			[]byte(req.Password))
		s.err(w, http.StatusUnauthorized, "that email and password don't match an account")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)) != nil {
		s.log.Warn("failed sign-in", "email", req.Email)
		s.err(w, http.StatusUnauthorized, "that email and password don't match an account")
		return
	}

	token, err := sessionToken()
	if err != nil {
		s.fail(w, err, "starting session")
		return
	}
	expires := time.Now().Add(sessionTTL)
	if err := s.store.CreateSession(r.Context(), token, user.ID, expires); err != nil {
		s.fail(w, err, "starting session")
		return
	}
	_ = s.store.TouchUserLogin(r.Context(), user.ID)
	s.setSessionCookie(w, r, token, expires)
	s.log.Info("sign-in", "email", user.Email, "role", user.Role)
	s.json(w, http.StatusOK, user)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookie); err == nil && cookie.Value != "" {
		_ = s.store.DeleteSession(r.Context(), cookie.Value)
	}
	s.clearSessionCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

// currentUser answers "who am I" for the shell. It's the one endpoint
// outside the authenticated group, because the app has to be able to
// ask before it knows.
func (s *Server) currentUser(w http.ResponseWriter, r *http.Request) {
	user := s.sessionUser(r)
	if user == nil {
		s.err(w, http.StatusUnauthorized, "not signed in")
		return
	}
	s.json(w, http.StatusOK, user)
}

// changeOwnPassword lets whoever is signed in rotate their own
// password, which needs the current one — a borrowed session shouldn't
// be able to lock the owner out of their own console.
func (s *Server) changeOwnPassword(w http.ResponseWriter, r *http.Request) {
	user := userFrom(r.Context())
	if user == nil {
		s.err(w, http.StatusUnauthorized, "sign in to continue")
		return
	}
	var req struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.CurrentPassword)) != nil {
		s.err(w, http.StatusUnauthorized, "that isn't your current password")
		return
	}
	if err := validatePassword(req.NewPassword); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := hashPassword(req.NewPassword)
	if err != nil {
		s.fail(w, err, "hashing password")
		return
	}
	user.PasswordHash = hash
	if err := s.store.UpdateUser(r.Context(), user); err != nil {
		s.fail(w, err, "updating password")
		return
	}
	// A new password ends every session but this one.
	_ = s.store.DeleteUserSessions(r.Context(), user.ID)
	s.clearSessionCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true, // no script reads this, so XSS can't lift it
		SameSite: http.SameSiteLaxMode,
		Secure:   isTLS(r),
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isTLS(r),
	})
}

// isTLS marks the cookie Secure only when the connection can carry it.
// A lab console is often plain http on the LAN, and a Secure cookie
// over http is simply never sent — an unexplainable sign-in loop.
func isTLS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func sessionToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func hashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(hash), err
}

// EnsureBootstrapUser creates the first owner so a fresh console can be
// signed into at all. It runs only when the account table is empty:
// after that, accounts are managed in IAM & Admin, and config is
// ignored — the same rule the seeded hypervisor follows.
//
// With no password configured it generates one and logs it once. That
// is the only time a password is ever written to the log, and it beats
// the alternatives: a well-known default nobody changes, or a console
// that can't be opened.
func EnsureBootstrapUser(ctx context.Context, st *store.Store, log logger, email, password string) error {
	n, err := st.CountUsers(ctx)
	if err != nil || n > 0 {
		return err
	}
	if email == "" {
		email = "lab@localhost"
	}
	generated := password == ""
	if generated {
		if password, err = generatePassword(); err != nil {
			return err
		}
	} else if err := validatePassword(password); err != nil {
		return err
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	user := &store.User{
		ID:           uuid.NewString(),
		Email:        strings.ToLower(strings.TrimSpace(email)),
		Name:         "Lab administrator",
		Role:         store.RoleOwner,
		PasswordHash: hash,
		Active:       true,
	}
	if err := st.CreateUser(ctx, user); err != nil {
		return err
	}
	if generated {
		log.Info("created the first owner account — sign in and change this password",
			"email", user.Email, "password", password)
	} else {
		log.Info("created the first owner account", "email", user.Email)
	}
	return nil
}

// logger is the slice of *slog.Logger this package needs, so the
// bootstrap can be called from main without importing more.
type logger interface {
	Info(msg string, args ...any)
}

// generatePassword makes a long random one. Base64 of 18 bytes is 24
// characters of real entropy — nobody types it twice, and nobody has to.
func generatePassword() (string, error) {
	buf := make([]byte, 18)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// validatePassword states the one rule worth having. Length beats
// character classes: it's what actually costs an attacker time, and
// composition rules mostly produce Password1!.
func validatePassword(password string) error {
	if len([]rune(password)) < 12 {
		return errors.New("password must be at least 12 characters")
	}
	return nil
}
