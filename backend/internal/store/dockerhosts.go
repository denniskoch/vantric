package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// DockerHost is a Docker daemon this console can reach.
//
// THE RECORD IS THE TRANSPORT. One driver speaks the Engine API; what
// differs between capstan, a socket proxy and Docker's own TLS listener
// is a token and how the certificate is trusted, and both are fields
// here rather than separate types.
type DockerHost struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	BaseURL string `json:"baseUrl"`
	// Token is write-only in every direction, like every other stored
	// credential. Optional: a socket proxy on a private network has
	// none.
	Token string `json:"-"`
	// Fingerprint is the SHA-256 of the certificate this host must
	// present. Preferred over InsecureTLS, and the reason that flag can
	// stay off: a self-signed certificate you have pinned is verified,
	// where one you have merely allowed is not.
	Fingerprint string    `json:"fingerprint"`
	InsecureTLS bool      `json:"insecureTls"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

const dockerHostCols = `id, name, base_url, token, fingerprint, insecure_tls, created_at, updated_at`

func scanDockerHost(scan func(dest ...any) error) (*DockerHost, error) {
	var h DockerHost
	var insecure int
	var created, updated string
	if err := scan(&h.ID, &h.Name, &h.BaseURL, &h.Token, &h.Fingerprint,
		&insecure, &created, &updated); err != nil {
		return nil, err
	}
	h.InsecureTLS = insecure == 1
	h.CreatedAt = parseTime(created)
	h.UpdatedAt = parseTime(updated)
	return &h, nil
}

func (s *Store) ListDockerHosts(ctx context.Context) ([]DockerHost, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+dockerHostCols+` FROM docker_hosts ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DockerHost{}
	for rows.Next() {
		host, err := scanDockerHost(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, *host)
	}
	return out, rows.Err()
}

func (s *Store) DockerHost(ctx context.Context, id string) (*DockerHost, error) {
	host, err := scanDockerHost(s.db.QueryRowContext(ctx,
		`SELECT `+dockerHostCols+` FROM docker_hosts WHERE id = ?`, id).Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return host, err
}

func (s *Store) CreateDockerHost(ctx context.Context, host *DockerHost) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO docker_hosts (`+dockerHostCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		host.ID, host.Name, host.BaseURL, host.Token, host.Fingerprint,
		boolInt(host.InsecureTLS), ts, ts)
	host.CreatedAt = parseTime(ts)
	host.UpdatedAt = host.CreatedAt
	return err
}

// UpdateDockerHost saves the fields a form can change. BLANK KEEPS the
// token, the rule every credential in this console follows: it is never
// readable, so an empty field is all an unchanged form can send.
func (s *Store) UpdateDockerHost(ctx context.Context, host *DockerHost) error {
	ts := now()
	query := `UPDATE docker_hosts SET name = ?, base_url = ?, fingerprint = ?,
	          insecure_tls = ?, updated_at = ?`
	args := []any{host.Name, host.BaseURL, host.Fingerprint, boolInt(host.InsecureTLS), ts}
	if host.Token != "" {
		query += `, token = ?`
		args = append(args, host.Token)
	}
	query += ` WHERE id = ?`
	args = append(args, host.ID)

	res, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	host.UpdatedAt = parseTime(ts)
	return nil
}

func (s *Store) DeleteDockerHost(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM docker_hosts WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
