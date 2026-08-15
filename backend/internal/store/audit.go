package store

import (
	"context"
	"strings"
	"time"
)

// The audit log: who did what, in a console that reaches every backend
// through a single shared credential.
//
// Proxmox's own task log can only ever say `root@pam!lcm`, because that
// is the token this app authenticates with — and that's the correct
// design for a service account. It means the mapping from an action to
// a PERSON exists nowhere but here, so this is the only place it can be
// recorded.
//
// The shape is deliberately flat and sink-shaped: one row is one event
// with a timestamp, an actor, a verb, a target and an outcome. That is
// what ships to OpenSearch or Graylog later without a rewrite —
// phase one keeps it in SQLite because the console already is a SQLite
// file, and a log nobody can read without standing up a cluster is a
// log nobody reads.

type AuditEntry struct {
	ID string `json:"id"`
	// At is unix seconds.
	At         int64  `json:"at"`
	ActorID    string `json:"actorId"`
	ActorEmail string `json:"actorEmail"`
	Method     string `json:"method"`
	Path       string `json:"path"`
	Action     string `json:"action"`
	Resource   string `json:"resource"`
	Status     int    `json:"status"`
	Error      string `json:"error,omitempty"`
	DurationMS int64  `json:"durationMs"`
	RemoteAddr string `json:"remoteAddr"`
	// Payload is the request body, with anything secret-looking
	// replaced. Kept because "who changed this to what" is most of the
	// value, and shown behind an expander because most of the time you
	// only want the verb.
	Payload string `json:"payload,omitempty"`
}

func (s *Store) AppendAudit(ctx context.Context, e *AuditEntry) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO audit_log
		   (id, at, actor_id, actor_email, method, path, action, resource,
		    status, error, duration_ms, remote_addr, payload)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.ID, e.At, e.ActorID, e.ActorEmail, e.Method, e.Path, e.Action, e.Resource,
		e.Status, e.Error, e.DurationMS, e.RemoteAddr, e.Payload)
	return err
}

// ListAudit returns the newest entries first, optionally narrowed to
// one actor or one resource — the two questions people actually bring
// to an audit log.
func (s *Store) ListAudit(ctx context.Context, actor, resource string, limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 2000 {
		limit = 500
	}
	query := `SELECT id, at, actor_id, actor_email, method, path, action, resource,
	                 status, error, duration_ms, remote_addr, payload
	          FROM audit_log`
	args := []any{}
	where := []string{}
	if actor != "" {
		where = append(where, "actor_email = ?")
		args = append(args, actor)
	}
	if resource != "" {
		where = append(where, "resource LIKE ?")
		args = append(args, "%"+resource+"%")
	}
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY at DESC, rowid DESC LIMIT ?"
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ID, &e.At, &e.ActorID, &e.ActorEmail, &e.Method, &e.Path,
			&e.Action, &e.Resource, &e.Status, &e.Error, &e.DurationMS,
			&e.RemoteAddr, &e.Payload); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// PruneAudit drops entries older than the retention window. A log that
// grows forever eventually makes the backup unwieldy, and a lab's
// interesting window is weeks rather than years.
func (s *Store) PruneAudit(ctx context.Context, keep time.Duration) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM audit_log WHERE at < ?`, time.Now().Add(-keep).Unix())
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
