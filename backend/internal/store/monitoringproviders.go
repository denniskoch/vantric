package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// MonitoringProvider is a configured monitoring service (Zabbix, …) —
// the thing that knows what is on fire.
// Token is never serialized; the API exposes hasToken instead.
type MonitoringProvider struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Type        string    `json:"type"`
	BaseURL     string    `json:"baseUrl"`
	Token       string    `json:"-"`
	InsecureTLS bool      `json:"insecureTls"`
	CreatedAt   time.Time `json:"createdAt"`
}

const monitoringProviderCols = `id, name, type, base_url, token, insecure_tls, created_at`

func scanMonitoringProvider(scan func(dest ...any) error) (*MonitoringProvider, error) {
	var p MonitoringProvider
	var created string
	var insecure int
	if err := scan(&p.ID, &p.Name, &p.Type, &p.BaseURL, &p.Token, &insecure, &created); err != nil {
		return nil, err
	}
	p.InsecureTLS = insecure == 1
	p.CreatedAt = parseTime(created)
	return &p, nil
}

func (s *Store) ListMonitoringProviders(ctx context.Context) ([]MonitoringProvider, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+monitoringProviderCols+` FROM monitoring_providers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	providers := []MonitoringProvider{}
	for rows.Next() {
		p, err := scanMonitoringProvider(rows.Scan)
		if err != nil {
			return nil, err
		}
		providers = append(providers, *p)
	}
	return providers, rows.Err()
}

func (s *Store) GetMonitoringProvider(ctx context.Context, id string) (*MonitoringProvider, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+monitoringProviderCols+` FROM monitoring_providers WHERE id = ?`, id)
	p, err := scanMonitoringProvider(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (s *Store) GetMonitoringProviderByName(ctx context.Context, name string) (*MonitoringProvider, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+monitoringProviderCols+` FROM monitoring_providers WHERE name = ?`, name)
	p, err := scanMonitoringProvider(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (s *Store) CreateMonitoringProvider(ctx context.Context, p *MonitoringProvider) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO monitoring_providers (`+monitoringProviderCols+`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.Name, p.Type, p.BaseURL, p.Token, boolToInt(p.InsecureTLS), ts)
	p.CreatedAt = parseTime(ts)
	return err
}

func (s *Store) UpdateMonitoringProvider(ctx context.Context, p *MonitoringProvider) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE monitoring_providers SET name = ?, type = ?, base_url = ?, token = ?,
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

func (s *Store) DeleteMonitoringProvider(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM monitoring_providers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
