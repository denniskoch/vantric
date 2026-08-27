package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// IAM: who may use this console. Deliberately separate from the
// Identity Platform section, which manages the lab's identity service
// — these accounts govern access to this app and nothing else.

// Roles, in GCP's basic-role shape. One role per user for now; the
// binding model (member → several roles, scoped to a resource) is what
// this grows into if it ever needs to.
const (
	RoleOwner  = "owner"
	RoleEditor = "editor"
	RoleViewer = "viewer"
)

// Roles lists them most-privileged first, the order the UI shows.
var Roles = []string{RoleOwner, RoleEditor, RoleViewer}

func ValidRole(role string) bool {
	for _, r := range Roles {
		if r == role {
			return true
		}
	}
	return false
}

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
	// PasswordHash never leaves the backend. An empty hash means this
	// account has no local password and can't sign in locally.
	PasswordHash string `json:"-"`
	HasPassword  bool   `json:"hasPassword"`
	Active       bool   `json:"active"`
	// SSHPrivateKey never leaves the backend. SSHPublicKey is what you
	// deploy to a guest; SSHKeyImported records that the user brought
	// their own rather than letting the console generate one.
	SSHPrivateKey  string    `json:"-"`
	SSHPublicKey   string    `json:"sshPublicKey"`
	SSHKeyImported bool      `json:"sshKeyImported"`
	LastLoginAt    string    `json:"lastLoginAt"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

const userColumns = `id, email, name, role, password_hash, active, last_login_at, created_at, updated_at, ssh_private_key, ssh_public_key, ssh_key_imported`

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	var u User
	var active, imported int
	var created, updated string
	if err := row.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.PasswordHash,
		&active, &u.LastLoginAt, &created, &updated,
		&u.SSHPrivateKey, &u.SSHPublicKey, &imported); err != nil {
		return nil, err
	}
	u.Active = active == 1
	u.SSHKeyImported = imported == 1
	u.HasPassword = u.PasswordHash != ""
	u.CreatedAt, _ = time.Parse(time.RFC3339, created)
	u.UpdatedAt, _ = time.Parse(time.RFC3339, updated)
	return &u, nil
}

func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+userColumns+` FROM iam_users ORDER BY email`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, *u)
	}
	return users, rows.Err()
}

func (s *Store) GetUser(ctx context.Context, id string) (*User, error) {
	u, err := scanUser(s.db.QueryRowContext(ctx,
		`SELECT `+userColumns+` FROM iam_users WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return u, err
}

// GetUserByEmail is the sign-in lookup. Email is the login name.
func (s *Store) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	u, err := scanUser(s.db.QueryRowContext(ctx,
		`SELECT `+userColumns+` FROM iam_users WHERE email = ?`, email))
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return u, err
}

func (s *Store) CreateUser(ctx context.Context, u *User) error {
	now := time.Now().UTC().Format(time.RFC3339)
	active := 0
	if u.Active {
		active = 1
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO iam_users (`+userColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		u.ID, u.Email, u.Name, u.Role, u.PasswordHash, active, "", now, now, "", "", 0)
	return err
}

// UpdateUser writes the editable fields. The password hash is left
// alone unless it's non-empty, so saving a profile can't blank it.
func (s *Store) UpdateUser(ctx context.Context, u *User) error {
	now := time.Now().UTC().Format(time.RFC3339)
	active := 0
	if u.Active {
		active = 1
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE iam_users SET email = ?, name = ?, role = ?, active = ?,
		 password_hash = CASE WHEN ? = '' THEN password_hash ELSE ? END,
		 updated_at = ? WHERE id = ?`,
		u.Email, u.Name, u.Role, active, u.PasswordHash, u.PasswordHash, now, u.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteUser removes the account and every session it holds, so a
// deleted person is signed out everywhere in the same breath.
func (s *Store) DeleteUser(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `DELETE FROM iam_sessions WHERE user_id = ?`, id); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM iam_users WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM iam_users`).Scan(&n)
	return n, err
}

// CountOwners guards the last way in: the console must keep at least
// one active owner, or nobody can administer it.
func (s *Store) CountOwners(ctx context.Context, excludeID string) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM iam_users WHERE role = ? AND active = 1 AND id != ?`,
		RoleOwner, excludeID).Scan(&n)
	return n, err
}

func (s *Store) TouchUserLogin(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE iam_users SET last_login_at = ? WHERE id = ?`,
		time.Now().UTC().Format(time.RFC3339), id)
	return err
}

// Role bindings.
//
// A person holds a SET of roles. The old single column could say
// "editor" and nothing else; this can say "viewer" and "compute.admin",
// which is somebody who watches the lab and runs one part of it.

// UserRoles lists what an account holds, in no particular order.
func (s *Store) UserRoles(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT role FROM iam_role_bindings WHERE user_id = ? ORDER BY role`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	roles := []string{}
	for rows.Next() {
		var role string
		if err := rows.Scan(&role); err != nil {
			return nil, err
		}
		roles = append(roles, role)
	}
	return roles, rows.Err()
}

// RolesByUser is every binding at once, for the account listing — one
// query rather than one per row.
func (s *Store) RolesByUser(ctx context.Context) (map[string][]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT user_id, role FROM iam_role_bindings ORDER BY user_id, role`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byUser := map[string][]string{}
	for rows.Next() {
		var id, role string
		if err := rows.Scan(&id, &role); err != nil {
			return nil, err
		}
		byUser[id] = append(byUser[id], role)
	}
	return byUser, rows.Err()
}

// SetUserRoles replaces an account's bindings.
//
// REPLACES, IN ONE TRANSACTION. Granting is how access is lowered as
// well as raised — the same rule database grants follow — and a
// half-applied change is an account holding neither what it had nor
// what was asked for.
func (s *Store) SetUserRoles(ctx context.Context, userID string, roles []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM iam_role_bindings WHERE user_id = ?`, userID); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, role := range roles {
		if role == "" || seen[role] {
			continue
		}
		seen[role] = true
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO iam_role_bindings (user_id, role) VALUES (?, ?)`,
			userID, role); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// CountUsersWithRole is how the console refuses to lose its last owner.
// It counts ACTIVE accounts, since a disabled one is not a way back in.
func (s *Store) CountUsersWithRole(ctx context.Context, role string) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM iam_role_bindings b
		  JOIN iam_users u ON u.id = b.user_id
		 WHERE b.role = ? AND u.active = 1`, role).Scan(&n)
	return n, err
}

// Sessions.

func (s *Store) CreateSession(ctx context.Context, token, userID string, expires time.Time) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO iam_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		token, userID, time.Now().UTC().Format(time.RFC3339), expires.UTC().Format(time.RFC3339))
	return err
}

// UserBySession resolves a cookie to its account, refusing expired
// sessions and disabled accounts. Expired rows are swept here rather
// than on a timer: the only thing that has to be true is that they
// stop working.
func (s *Store) UserBySession(ctx context.Context, token string) (*User, error) {
	u, _, err := s.SessionUser(ctx, token)
	return u, err
}

// SessionUser also reports when the session expires, so the caller can
// renew one that is running out. A zero time means there is no session
// to renew.
func (s *Store) SessionUser(ctx context.Context, token string) (*User, time.Time, error) {
	var userID, expires string
	err := s.db.QueryRowContext(ctx,
		`SELECT user_id, expires_at FROM iam_sessions WHERE token = ?`, token).
		Scan(&userID, &expires)
	if err == sql.ErrNoRows {
		return nil, time.Time{}, ErrNotFound
	}
	if err != nil {
		return nil, time.Time{}, err
	}
	at, perr := time.Parse(time.RFC3339, expires)
	if perr == nil && time.Now().After(at) {
		_, _ = s.db.ExecContext(ctx, `DELETE FROM iam_sessions WHERE token = ?`, token)
		return nil, time.Time{}, ErrNotFound
	}
	u, err := s.GetUser(ctx, userID)
	if err != nil {
		return nil, time.Time{}, err
	}
	if !u.Active {
		return nil, time.Time{}, ErrNotFound
	}
	return u, at, nil
}

// ExtendSession pushes a session's expiry out, so using the console
// keeps you signed in.
//
// A HARD DEADLINE LOGS YOU OUT MID-SENTENCE. The TTL was absolute from
// the moment you signed in, so a console somebody works in all day
// dropped them at an arbitrary hour with no warning and no relation to
// whether they were using it — which reads as the session being flaky
// rather than as a policy.
//
// The caller renews only past the halfway mark rather than on every
// request, because the instance list polls every three seconds and a
// write per request would be thousands of pointless updates an hour.
func (s *Store) ExtendSession(ctx context.Context, token string, expires time.Time) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE iam_sessions SET expires_at = ? WHERE token = ?`,
		expires.UTC().Format(time.RFC3339), token)
	return err
}

// PruneSessions drops rows whose session has expired.
//
// EXPIRING IS NOT THE SAME AS BEING SWEPT. UserBySession deletes an
// expired row when that token is PRESENTED, which sounds like enough
// and isn't: a session that runs out while you are away is never
// presented again, because the browser dropped the cookie at the same
// moment. So the rows accumulate — fifty-one of them here, going back
// a fortnight, none of which could ever be swept by being asked for.
//
// Nothing about auth depends on this; an expired row is refused either
// way. It exists so the table does not grow forever.
func (s *Store) PruneSessions(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM iam_sessions WHERE expires_at < ?`,
		time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM iam_sessions WHERE token = ?`, token)
	return err
}

// DeleteUserSessions signs an account out everywhere — what disabling
// it, or changing its password, has to mean.
func (s *Store) DeleteUserSessions(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM iam_sessions WHERE user_id = ?`, userID)
	return err
}

// SetUserSSHKey stores an account's key pair. imported marks a key the
// user supplied themselves, which the UI says out loud — replacing it
// is not something to discover later.
func (s *Store) SetUserSSHKey(ctx context.Context, id, private, public string, imported bool) error {
	flag := 0
	if imported {
		flag = 1
	}
	_, err := s.db.ExecContext(ctx,
		`UPDATE iam_users SET ssh_private_key = ?, ssh_public_key = ?, ssh_key_imported = ?,
		 updated_at = ? WHERE id = ?`,
		private, public, flag, time.Now().UTC().Format(time.RFC3339), id)
	return err
}

// Signing in through the lab's identity service.
//
// One provider, stored as one row: a lab has one identity service, and
// the local accounts above stay as the fallback door for when it's the
// thing that's broken.

type OIDCProvider struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Issuer is the base URL; discovery hangs off it.
	Issuer   string `json:"issuer"`
	ClientID string `json:"clientId"`
	// ClientSecret never leaves the backend.
	ClientSecret string `json:"-"`
	HasSecret    bool   `json:"hasSecret"`
	Scopes       string `json:"scopes"`
	// AutoCreate makes an account for anyone the provider vouches for.
	// Off by default: being in the directory shouldn't by itself be a
	// way into the console that runs the lab.
	AutoCreate  bool      `json:"autoCreate"`
	DefaultRole string    `json:"defaultRole"`
	Enabled     bool      `json:"enabled"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

const oidcColumns = `id, name, issuer, client_id, client_secret, scopes, auto_create,
	default_role, enabled, created_at, updated_at`

// GetOIDCProvider returns the configured provider, or ErrNotFound when
// sign-in is local-only.
func (s *Store) GetOIDCProvider(ctx context.Context) (*OIDCProvider, error) {
	var p OIDCProvider
	var autoCreate, enabled int
	var created, updated string
	err := s.db.QueryRowContext(ctx,
		`SELECT `+oidcColumns+` FROM auth_oidc LIMIT 1`).
		Scan(&p.ID, &p.Name, &p.Issuer, &p.ClientID, &p.ClientSecret, &p.Scopes,
			&autoCreate, &p.DefaultRole, &enabled, &created, &updated)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.AutoCreate = autoCreate == 1
	p.Enabled = enabled == 1
	p.HasSecret = p.ClientSecret != ""
	p.CreatedAt, _ = time.Parse(time.RFC3339, created)
	p.UpdatedAt, _ = time.Parse(time.RFC3339, updated)
	return &p, nil
}

// SaveOIDCProvider writes the single row, creating it the first time.
// An empty secret keeps the stored one, the way every other credential
// form in this app behaves.
func (s *Store) SaveOIDCProvider(ctx context.Context, p *OIDCProvider) error {
	now := time.Now().UTC().Format(time.RFC3339)
	autoCreate, enabled := 0, 0
	if p.AutoCreate {
		autoCreate = 1
	}
	if p.Enabled {
		enabled = 1
	}
	existing, err := s.GetOIDCProvider(ctx)
	if err != nil && err != ErrNotFound {
		return err
	}
	if err == ErrNotFound {
		_, err := s.db.ExecContext(ctx,
			`INSERT INTO auth_oidc (`+oidcColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			p.ID, p.Name, p.Issuer, p.ClientID, p.ClientSecret, p.Scopes,
			autoCreate, p.DefaultRole, enabled, now, now)
		return err
	}
	if p.ClientSecret == "" {
		p.ClientSecret = existing.ClientSecret
	}
	_, err = s.db.ExecContext(ctx,
		`UPDATE auth_oidc SET name = ?, issuer = ?, client_id = ?, client_secret = ?,
		 scopes = ?, auto_create = ?, default_role = ?, enabled = ?, updated_at = ?
		 WHERE id = ?`,
		p.Name, p.Issuer, p.ClientID, p.ClientSecret, p.Scopes,
		autoCreate, p.DefaultRole, enabled, now, existing.ID)
	p.ID = existing.ID
	return err
}

func (s *Store) DeleteOIDCProvider(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM auth_oidc`)
	return err
}

// Favorites are the sections a person pinned to the top of the global
// menu, stored on the account rather than in the browser: the console
// is one place you sign in to from more than one machine, and a
// favourite that doesn't follow you is a favourite you set twice.
//
// A JSON array of section ids. Not a join table — this is at most a
// dozen strings, nobody queries across them, and the alternative is a
// second table to keep in step with a list the frontend owns anyway.
// Unknown ids are harmless: a section that no longer exists simply
// doesn't render, which is the right outcome after a rename.
func (s *Store) Favorites(ctx context.Context, userID string) ([]string, error) {
	var raw string
	err := s.db.QueryRowContext(ctx,
		`SELECT favorites FROM iam_users WHERE id = ?`, userID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(raw) == "" {
		return []string{}, nil
	}
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		// A row we can't read is not a reason to fail the page it sits
		// behind; an empty list is the honest answer.
		return []string{}, nil
	}
	return ids, nil
}

func (s *Store) SetFavorites(ctx context.Context, userID string, ids []string) error {
	if ids == nil {
		ids = []string{}
	}
	raw, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx,
		`UPDATE iam_users SET favorites = ?, updated_at = ? WHERE id = ?`,
		string(raw), now(), userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
