package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// InventoryProvider is a configured device inventory service (FleetDM,
// …) — the thing that knows what is installed inside the guests.
// Token is never serialized; the API exposes hasToken instead.
type InventoryProvider struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Type        string    `json:"type"`
	BaseURL     string    `json:"baseUrl"`
	Token       string    `json:"-"`
	InsecureTLS bool      `json:"insecureTls"`
	CreatedAt   time.Time `json:"createdAt"`
}

const inventoryProviderCols = `id, name, type, base_url, token, insecure_tls, created_at`

func scanInventoryProvider(scan func(dest ...any) error) (*InventoryProvider, error) {
	var p InventoryProvider
	var created string
	var insecure int
	if err := scan(&p.ID, &p.Name, &p.Type, &p.BaseURL, &p.Token, &insecure, &created); err != nil {
		return nil, err
	}
	p.InsecureTLS = insecure == 1
	p.CreatedAt = parseTime(created)
	return &p, nil
}

func (s *Store) ListInventoryProviders(ctx context.Context) ([]InventoryProvider, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+inventoryProviderCols+` FROM inventory_providers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	providers := []InventoryProvider{}
	for rows.Next() {
		p, err := scanInventoryProvider(rows.Scan)
		if err != nil {
			return nil, err
		}
		providers = append(providers, *p)
	}
	return providers, rows.Err()
}

func (s *Store) GetInventoryProvider(ctx context.Context, id string) (*InventoryProvider, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+inventoryProviderCols+` FROM inventory_providers WHERE id = ?`, id)
	p, err := scanInventoryProvider(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (s *Store) GetInventoryProviderByName(ctx context.Context, name string) (*InventoryProvider, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+inventoryProviderCols+` FROM inventory_providers WHERE name = ?`, name)
	p, err := scanInventoryProvider(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (s *Store) CreateInventoryProvider(ctx context.Context, p *InventoryProvider) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO inventory_providers (`+inventoryProviderCols+`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.Name, p.Type, p.BaseURL, p.Token, boolToInt(p.InsecureTLS), ts)
	p.CreatedAt = parseTime(ts)
	return err
}

func (s *Store) UpdateInventoryProvider(ctx context.Context, p *InventoryProvider) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE inventory_providers SET name = ?, type = ?, base_url = ?, token = ?,
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

func (s *Store) DeleteInventoryProvider(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM inventory_providers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
