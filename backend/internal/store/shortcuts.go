package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Shortcut is a link somebody put on their own front page.
//
// PERSONAL, not shared. Every row belongs to one account and every
// query here is scoped by it — which is the whole security model, so
// there is deliberately no lookup that takes an id without also taking
// the owner. A shortcut is somebody's arrangement of their own working
// day; two people with the same lab will not want the same tiles, and
// a shared list would end up being nobody's.
type Shortcut struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	Description string `json:"description"`
	// Icon is the file's basename under <dataDir>/shortcut-icons, or
	// empty where the tile draws a monogram instead. The bytes are a
	// file for the same reasons the installers are: backup is `cp` and
	// there is no blob column to export anything from.
	Icon string `json:"icon"`
	// Position is the tile's place in the grid. Dense and zero-based
	// after any reorder, because the whole list is rewritten at once.
	Position  int       `json:"position"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

const shortcutCols = `id, name, url, description, icon, position, created_at, updated_at`

func scanShortcut(scan func(dest ...any) error) (*Shortcut, error) {
	var s Shortcut
	var created, updated string
	if err := scan(&s.ID, &s.Name, &s.URL, &s.Description, &s.Icon, &s.Position,
		&created, &updated); err != nil {
		return nil, err
	}
	s.CreatedAt = parseTime(created)
	s.UpdatedAt = parseTime(updated)
	return &s, nil
}

// Shortcuts lists one account's tiles in the order they were arranged.
// Position ties are broken by creation time, so a row written before
// the first drag still lands somewhere stable.
func (s *Store) Shortcuts(ctx context.Context, userID string) ([]Shortcut, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+shortcutCols+` FROM user_shortcuts WHERE user_id = ?
		 ORDER BY position, created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Shortcut{}
	for rows.Next() {
		item, err := scanShortcut(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, *item)
	}
	return out, rows.Err()
}

// Shortcut reads one, and takes the owner as well as the id: a
// shortcut that belongs to somebody else must be indistinguishable
// from one that doesn't exist.
func (s *Store) Shortcut(ctx context.Context, userID, id string) (*Shortcut, error) {
	item, err := scanShortcut(s.db.QueryRowContext(ctx,
		`SELECT `+shortcutCols+` FROM user_shortcuts WHERE id = ? AND user_id = ?`,
		id, userID).Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return item, err
}

// CreateShortcut appends a tile to the end of the account's grid.
func (s *Store) CreateShortcut(ctx context.Context, userID string, item *Shortcut) error {
	ts := now()
	var next int
	// COALESCE, because MAX over no rows is NULL rather than zero.
	if err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(position) + 1, 0) FROM user_shortcuts WHERE user_id = ?`,
		userID).Scan(&next); err != nil {
		return err
	}
	item.Position = next
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO user_shortcuts (`+shortcutCols+`, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID, item.Name, item.URL, item.Description, item.Icon, item.Position, ts, ts, userID)
	item.CreatedAt = parseTime(ts)
	item.UpdatedAt = item.CreatedAt
	return err
}

// UpdateShortcut writes the fields a form can change. The icon and the
// position are not among them: both have their own call, because both
// are set by an action rather than by saving a form.
func (s *Store) UpdateShortcut(ctx context.Context, userID string, item *Shortcut) error {
	ts := now()
	res, err := s.db.ExecContext(ctx,
		`UPDATE user_shortcuts SET name = ?, url = ?, description = ?, updated_at = ?
		 WHERE id = ? AND user_id = ?`,
		item.Name, item.URL, item.Description, ts, item.ID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	item.UpdatedAt = parseTime(ts)
	return nil
}

// SetShortcutIcon records which file the tile draws, or clears it.
func (s *Store) SetShortcutIcon(ctx context.Context, userID, id, icon string) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE user_shortcuts SET icon = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		icon, now(), id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteShortcut(ctx context.Context, userID, id string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM user_shortcuts WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetShortcutOrder rewrites the whole arrangement in one transaction.
//
// Whole, rather than a position per moved tile: dragging one tile
// changes the index of every tile it passed, so a partial write is how
// two rows end up claiming the same slot. Ids that aren't the caller's
// simply match nothing, and any row the list omits keeps its old
// position and sorts after the rewritten ones.
func (s *Store) SetShortcutOrder(ctx context.Context, userID string, ids []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	ts := now()
	for i, id := range ids {
		if _, err := tx.ExecContext(ctx,
			`UPDATE user_shortcuts SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
			i, ts, id, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
