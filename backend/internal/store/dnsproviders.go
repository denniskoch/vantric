package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// DNSProvider is a configured DNS account (Cloudflare, …). Token is
// never serialized; the API exposes hasToken instead.
type DNSProvider struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	Token     string    `json:"-"`
	AccountID string    `json:"accountId"`
	CreatedAt time.Time `json:"createdAt"`
}

const dnsProviderCols = `id, name, type, token, account_id, created_at`

func scanDNSProvider(scan func(dest ...any) error) (*DNSProvider, error) {
	var p DNSProvider
	var created string
	if err := scan(&p.ID, &p.Name, &p.Type, &p.Token, &p.AccountID, &created); err != nil {
		return nil, err
	}
	p.CreatedAt = parseTime(created)
	return &p, nil
}

func (s *Store) ListDNSProviders(ctx context.Context) ([]DNSProvider, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+dnsProviderCols+` FROM dns_providers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	providers := []DNSProvider{}
	for rows.Next() {
		p, err := scanDNSProvider(rows.Scan)
		if err != nil {
			return nil, err
		}
		providers = append(providers, *p)
	}
	return providers, rows.Err()
}

func (s *Store) GetDNSProvider(ctx context.Context, id string) (*DNSProvider, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+dnsProviderCols+` FROM dns_providers WHERE id = ?`, id)
	p, err := scanDNSProvider(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (s *Store) GetDNSProviderByName(ctx context.Context, name string) (*DNSProvider, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+dnsProviderCols+` FROM dns_providers WHERE name = ?`, name)
	p, err := scanDNSProvider(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (s *Store) CreateDNSProvider(ctx context.Context, p *DNSProvider) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO dns_providers (`+dnsProviderCols+`) VALUES (?, ?, ?, ?, ?, ?)`,
		p.ID, p.Name, p.Type, p.Token, p.AccountID, ts)
	p.CreatedAt = parseTime(ts)
	return err
}

func (s *Store) UpdateDNSProvider(ctx context.Context, p *DNSProvider) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE dns_providers SET name = ?, type = ?, token = ?, account_id = ? WHERE id = ?`,
		p.Name, p.Type, p.Token, p.AccountID, p.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteDNSProvider(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM dns_providers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
