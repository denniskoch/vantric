package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// StorageProvider is a registered S3-compatible object store. The secret
// key is never serialized; the API exposes hasSecret instead, the same
// rule every other credential here follows.
type StorageProvider struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	BaseURL   string `json:"baseUrl"`
	AccessKey string `json:"accessKey"`
	SecretKey string `json:"-"`
	// Region is what SigV4 signs against. An object store outside a
	// cloud has no region, but the signature needs one.
	Region      string    `json:"region"`
	InsecureTLS bool      `json:"insecureTls"`
	CreatedAt   time.Time `json:"createdAt"`
}

const storageProviderCols = `id, name, type, base_url, access_key, secret_key, region, insecure_tls, created_at`

func scanStorageProvider(scan func(dest ...any) error) (*StorageProvider, error) {
	var p StorageProvider
	var insecure int
	var created string
	err := scan(&p.ID, &p.Name, &p.Type, &p.BaseURL, &p.AccessKey, &p.SecretKey,
		&p.Region, &insecure, &created)
	if err != nil {
		return nil, err
	}
	p.InsecureTLS = insecure != 0
	p.CreatedAt = parseTime(created)
	return &p, nil
}

func (s *Store) ListStorageProviders(ctx context.Context) ([]StorageProvider, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+storageProviderCols+` FROM storage_providers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	providers := []StorageProvider{}
	for rows.Next() {
		p, err := scanStorageProvider(rows.Scan)
		if err != nil {
			return nil, err
		}
		providers = append(providers, *p)
	}
	return providers, rows.Err()
}

func (s *Store) GetStorageProvider(ctx context.Context, id string) (*StorageProvider, error) {
	p, err := scanStorageProvider(s.db.QueryRowContext(ctx,
		`SELECT `+storageProviderCols+` FROM storage_providers WHERE id = ?`, id).Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (s *Store) GetStorageProviderByName(ctx context.Context, name string) (*StorageProvider, error) {
	p, err := scanStorageProvider(s.db.QueryRowContext(ctx,
		`SELECT `+storageProviderCols+` FROM storage_providers WHERE name = ?`, name).Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (s *Store) CreateStorageProvider(ctx context.Context, p *StorageProvider) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO storage_providers (`+storageProviderCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.Name, p.Type, p.BaseURL, p.AccessKey, p.SecretKey, p.Region,
		boolInt(p.InsecureTLS), ts)
	p.CreatedAt = parseTime(ts)
	return err
}

func (s *Store) UpdateStorageProvider(ctx context.Context, p *StorageProvider) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE storage_providers SET name = ?, type = ?, base_url = ?, access_key = ?,
		 secret_key = ?, region = ?, insecure_tls = ? WHERE id = ?`,
		p.Name, p.Type, p.BaseURL, p.AccessKey, p.SecretKey, p.Region,
		boolInt(p.InsecureTLS), p.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteStorageProvider(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM storage_providers WHERE id = ?`, id)
	return err
}
