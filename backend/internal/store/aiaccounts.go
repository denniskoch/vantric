package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// AIAccount is a model provider's own account — the thing that knows
// what is LEFT, which the gateway in front of it cannot.
//
// Key is never serialized; the API exposes hasKey instead. It is a
// SECOND credential for a provider the gateway already holds a key
// for, and deliberately so: OpenRouter's balance needs a management
// key that cannot call completions, and the gateway's inference key
// cannot read the balance.
type AIAccount struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	Key       string    `json:"-"`
	CreatedAt time.Time `json:"createdAt"`
}

const aiAccountCols = `id, name, type, api_key, created_at`

func scanAIAccount(scan func(dest ...any) error) (*AIAccount, error) {
	var a AIAccount
	var created string
	if err := scan(&a.ID, &a.Name, &a.Type, &a.Key, &created); err != nil {
		return nil, err
	}
	a.CreatedAt = parseTime(created)
	return &a, nil
}

func (s *Store) ListAIAccounts(ctx context.Context) ([]AIAccount, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+aiAccountCols+` FROM ai_accounts ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	accounts := []AIAccount{}
	for rows.Next() {
		a, err := scanAIAccount(rows.Scan)
		if err != nil {
			return nil, err
		}
		accounts = append(accounts, *a)
	}
	return accounts, rows.Err()
}

func (s *Store) GetAIAccount(ctx context.Context, id string) (*AIAccount, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+aiAccountCols+` FROM ai_accounts WHERE id = ?`, id)
	a, err := scanAIAccount(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

func (s *Store) CreateAIAccount(ctx context.Context, a *AIAccount) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO ai_accounts (`+aiAccountCols+`) VALUES (?, ?, ?, ?, ?)`,
		a.ID, a.Name, a.Type, a.Key, ts)
	a.CreatedAt = parseTime(ts)
	return err
}

func (s *Store) UpdateAIAccount(ctx context.Context, a *AIAccount) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE ai_accounts SET name = ?, type = ?, api_key = ? WHERE id = ?`,
		a.Name, a.Type, a.Key, a.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteAIAccount(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM ai_accounts WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
