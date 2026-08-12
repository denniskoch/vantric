// Package store persists app state. SQL is kept portable between SQLite
// (development default) and PostgreSQL: TEXT keys, RFC3339 timestamps,
// no engine-specific column types.
package store

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
	// dialect is "sqlite" or "postgres"; used where SQL must differ.
	dialect string
}

// Open connects and migrates. driver is "sqlite" (dsn = file path) or,
// later, "postgres" (dsn = connection string).
func Open(driver, dsn string) (*Store, error) {
	switch driver {
	case "sqlite":
		db, err := sql.Open("sqlite", dsn+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)")
		if err != nil {
			return nil, err
		}
		// modernc/sqlite allows one writer; serialize access.
		db.SetMaxOpenConns(1)
		s := &Store{db: db, dialect: "sqlite"}
		return s, s.migrate()
	default:
		return nil, fmt.Errorf("store: unsupported driver %q (postgres support planned)", driver)
	}
}

func (s *Store) Close() error { return s.db.Close() }

var migrations = []string{
	`CREATE TABLE IF NOT EXISTS projects (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL UNIQUE,
		display_name TEXT NOT NULL,
		created_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS instances (
		id TEXT PRIMARY KEY,
		project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		zone TEXT NOT NULL,
		machine_type TEXT NOT NULL,
		cpus INTEGER NOT NULL,
		memory_mb INTEGER NOT NULL,
		disk_gb INTEGER NOT NULL,
		image_id TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL,
		driver TEXT NOT NULL,
		driver_id TEXT NOT NULL DEFAULT '',
		internal_ip TEXT NOT NULL DEFAULT '',
		external_ip TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		UNIQUE (project_id, name)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_instances_project ON instances(project_id)`,
}

func (s *Store) migrate() error {
	for _, m := range migrations {
		if _, err := s.db.Exec(m); err != nil {
			return fmt.Errorf("store: migration failed: %w", err)
		}
	}
	return nil
}
