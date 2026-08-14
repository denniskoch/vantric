package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// IdentityProvider is a configured identity backend (authentik, …).
// Token is never serialized; the API exposes hasToken instead.
type IdentityProvider struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Type        string    `json:"type"`
	BaseURL     string    `json:"baseUrl"`
	Token       string    `json:"-"`
	InsecureTLS bool      `json:"insecureTls"`
	CreatedAt   time.Time `json:"createdAt"`
}

const identityProviderCols = `id, name, type, base_url, token, insecure_tls, created_at`

func scanIdentityProvider(scan func(dest ...any) error) (*IdentityProvider, error) {
	var p IdentityProvider
	var created string
	var insecure int
	if err := scan(&p.ID, &p.Name, &p.Type, &p.BaseURL, &p.Token, &insecure, &created); err != nil {
		return nil, err
	}
	p.InsecureTLS = insecure == 1
	p.CreatedAt = parseTime(created)
	return &p, nil
}

func (s *Store) ListIdentityProviders(ctx context.Context) ([]IdentityProvider, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+identityProviderCols+` FROM identity_providers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	providers := []IdentityProvider{}
	for rows.Next() {
		p, err := scanIdentityProvider(rows.Scan)
		if err != nil {
			return nil, err
		}
		providers = append(providers, *p)
	}
	return providers, rows.Err()
}

func (s *Store) GetIdentityProvider(ctx context.Context, id string) (*IdentityProvider, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+identityProviderCols+` FROM identity_providers WHERE id = ?`, id)
	p, err := scanIdentityProvider(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (s *Store) GetIdentityProviderByName(ctx context.Context, name string) (*IdentityProvider, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+identityProviderCols+` FROM identity_providers WHERE name = ?`, name)
	p, err := scanIdentityProvider(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (s *Store) CreateIdentityProvider(ctx context.Context, p *IdentityProvider) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO identity_providers (`+identityProviderCols+`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.Name, p.Type, p.BaseURL, p.Token, boolToInt(p.InsecureTLS), ts)
	p.CreatedAt = parseTime(ts)
	return err
}

func (s *Store) UpdateIdentityProvider(ctx context.Context, p *IdentityProvider) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE identity_providers SET name = ?, type = ?, base_url = ?, token = ?,
		        insecure_tls = ? WHERE id = ?`,
		p.Name, p.Type, p.BaseURL, p.Token, boolToInt(p.InsecureTLS), p.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteIdentityProvider(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM identity_providers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
