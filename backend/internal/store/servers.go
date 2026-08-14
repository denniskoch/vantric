package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Server is a registered virtualization host (hypervisor endpoint).
// Secret is never serialized; API responses use a sanitized view.
type Server struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Type        string    `json:"type"` // "proxmox" or "mock"
	BaseURL     string    `json:"baseUrl"`
	TokenID     string    `json:"tokenId"`
	Secret      string    `json:"-"`
	InsecureTLS bool      `json:"insecureTls"`
	CreatedAt   time.Time `json:"createdAt"`
}

const serverCols = `id, name, type, base_url, token_id, secret, insecure_tls, created_at`

func scanServer(scan func(dest ...any) error) (*Server, error) {
	var s Server
	var insecure int
	var created string
	err := scan(&s.ID, &s.Name, &s.Type, &s.BaseURL, &s.TokenID, &s.Secret, &insecure, &created)
	if err != nil {
		return nil, err
	}
	s.InsecureTLS = insecure != 0
	s.CreatedAt = parseTime(created)
	return &s, nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (s *Store) ListServers(ctx context.Context) ([]Server, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+serverCols+` FROM servers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	servers := []Server{}
	for rows.Next() {
		sv, err := scanServer(rows.Scan)
		if err != nil {
			return nil, err
		}
		servers = append(servers, *sv)
	}
	return servers, rows.Err()
}

func (s *Store) GetServer(ctx context.Context, id string) (*Server, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+serverCols+` FROM servers WHERE id = ?`, id)
	sv, err := scanServer(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return sv, err
}

func (s *Store) GetServerByName(ctx context.Context, name string) (*Server, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+serverCols+` FROM servers WHERE name = ?`, name)
	sv, err := scanServer(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return sv, err
}

func (s *Store) CreateServer(ctx context.Context, sv *Server) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO servers (`+serverCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		sv.ID, sv.Name, sv.Type, sv.BaseURL, sv.TokenID, sv.Secret, boolInt(sv.InsecureTLS), ts)
	sv.CreatedAt = parseTime(ts)
	return err
}

func (s *Store) UpdateServer(ctx context.Context, sv *Server) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE servers SET name = ?, type = ?, base_url = ?, token_id = ?, secret = ?, insecure_tls = ?
		 WHERE id = ?`,
		sv.Name, sv.Type, sv.BaseURL, sv.TokenID, sv.Secret, boolInt(sv.InsecureTLS), sv.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteServer forgets a hypervisor and the guests recorded against it.
//
// Those records are a MIRROR of what the driver reports, not the guests
// themselves — nothing here reaches the hypervisor, and every VM and
// container on it keeps running. Re-add the server and the reconciler
// adopts them all back. The alternative, refusing until the guests are
// gone, would mean destroying a lab to disconnect a credential.
func (s *Store) DeleteServer(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, table := range []string{"containers", "instances"} {
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM `+table+` WHERE server_id = ?`, id); err != nil {
			return err
		}
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM servers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

func (s *Store) CountServers(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM servers`).Scan(&n)
	return n, err
}

