package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// AIGateway is a configured AI gateway (Bifrost, …) — the thing every
// model call in the lab passes through, and therefore the only thing
// that has seen all of them.
//
// Token is never serialized; the API exposes hasToken instead. Unlike
// every other backend record here it is genuinely OPTIONAL: Bifrost
// ships with its management API open, so a gateway on the LAN usually
// has no credential to store.
type AIGateway struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Type        string    `json:"type"`
	BaseURL     string    `json:"baseUrl"`
	Token       string    `json:"-"`
	InsecureTLS bool      `json:"insecureTls"`
	CreatedAt   time.Time `json:"createdAt"`
}

const aiGatewayCols = `id, name, type, base_url, token, insecure_tls, created_at`

func scanAIGateway(scan func(dest ...any) error) (*AIGateway, error) {
	var g AIGateway
	var created string
	var insecure int
	if err := scan(&g.ID, &g.Name, &g.Type, &g.BaseURL, &g.Token, &insecure, &created); err != nil {
		return nil, err
	}
	g.InsecureTLS = insecure == 1
	g.CreatedAt = parseTime(created)
	return &g, nil
}

func (s *Store) ListAIGateways(ctx context.Context) ([]AIGateway, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+aiGatewayCols+` FROM ai_gateways ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	gateways := []AIGateway{}
	for rows.Next() {
		g, err := scanAIGateway(rows.Scan)
		if err != nil {
			return nil, err
		}
		gateways = append(gateways, *g)
	}
	return gateways, rows.Err()
}

func (s *Store) GetAIGateway(ctx context.Context, id string) (*AIGateway, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+aiGatewayCols+` FROM ai_gateways WHERE id = ?`, id)
	g, err := scanAIGateway(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return g, err
}

func (s *Store) CreateAIGateway(ctx context.Context, g *AIGateway) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO ai_gateways (`+aiGatewayCols+`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		g.ID, g.Name, g.Type, g.BaseURL, g.Token, boolToInt(g.InsecureTLS), ts)
	g.CreatedAt = parseTime(ts)
	return err
}

func (s *Store) UpdateAIGateway(ctx context.Context, g *AIGateway) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE ai_gateways SET name = ?, type = ?, base_url = ?, token = ?,
		        insecure_tls = ? WHERE id = ?`,
		g.Name, g.Type, g.BaseURL, g.Token, boolToInt(g.InsecureTLS), g.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteAIGateway(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM ai_gateways WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
