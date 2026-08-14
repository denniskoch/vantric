package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// NetworkProvider is a configured network controller (UniFi, …).
// Secrets are never serialized; the API exposes hasCredentials.
type NetworkProvider struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Type    string `json:"type"`
	BaseURL string `json:"baseUrl"`
	Site    string `json:"site"`
	// APIKey is preferred where the controller supports one; the
	// username/password pair is the fallback for older ones.
	APIKey      string    `json:"-"`
	Username    string    `json:"username"`
	Password    string    `json:"-"`
	InsecureTLS bool      `json:"insecureTls"`
	CreatedAt   time.Time `json:"createdAt"`
}

const networkProviderCols = `id, name, type, base_url, site, api_key, username, password, insecure_tls, created_at`

func scanNetworkProvider(scan func(dest ...any) error) (*NetworkProvider, error) {
	var p NetworkProvider
	var created string
	var insecure int
	if err := scan(&p.ID, &p.Name, &p.Type, &p.BaseURL, &p.Site, &p.APIKey,
		&p.Username, &p.Password, &insecure, &created); err != nil {
		return nil, err
	}
	p.InsecureTLS = insecure == 1
	p.CreatedAt = parseTime(created)
	return &p, nil
}

func (s *Store) ListNetworkProviders(ctx context.Context) ([]NetworkProvider, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+networkProviderCols+` FROM network_providers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	providers := []NetworkProvider{}
	for rows.Next() {
		p, err := scanNetworkProvider(rows.Scan)
		if err != nil {
			return nil, err
		}
		providers = append(providers, *p)
	}
	return providers, rows.Err()
}

func (s *Store) GetNetworkProvider(ctx context.Context, id string) (*NetworkProvider, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+networkProviderCols+` FROM network_providers WHERE id = ?`, id)
	p, err := scanNetworkProvider(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (s *Store) GetNetworkProviderByName(ctx context.Context, name string) (*NetworkProvider, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+networkProviderCols+` FROM network_providers WHERE name = ?`, name)
	p, err := scanNetworkProvider(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (s *Store) CreateNetworkProvider(ctx context.Context, p *NetworkProvider) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO network_providers (`+networkProviderCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.Name, p.Type, p.BaseURL, p.Site, p.APIKey, p.Username, p.Password,
		boolToInt(p.InsecureTLS), ts)
	p.CreatedAt = parseTime(ts)
	return err
}

func (s *Store) UpdateNetworkProvider(ctx context.Context, p *NetworkProvider) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE network_providers SET name = ?, type = ?, base_url = ?, site = ?,
		        api_key = ?, username = ?, password = ?, insecure_tls = ? WHERE id = ?`,
		p.Name, p.Type, p.BaseURL, p.Site, p.APIKey, p.Username, p.Password,
		boolToInt(p.InsecureTLS), p.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteNetworkProvider(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM network_providers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
