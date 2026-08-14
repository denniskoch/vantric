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
	`CREATE TABLE IF NOT EXISTS servers (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL UNIQUE,
		type TEXT NOT NULL,
		base_url TEXT NOT NULL DEFAULT '',
		token_id TEXT NOT NULL DEFAULT '',
		secret TEXT NOT NULL DEFAULT '',
		insecure_tls INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS instances (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL UNIQUE,
		server_id TEXT NOT NULL REFERENCES servers(id),
		zone TEXT NOT NULL,
		machine_type TEXT NOT NULL,
		cpus INTEGER NOT NULL,
		memory_mb INTEGER NOT NULL,
		disk_gb INTEGER NOT NULL,
		image_id TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL,
		driver_id TEXT NOT NULL DEFAULT '',
		internal_ip TEXT NOT NULL DEFAULT '',
		external_ip TEXT NOT NULL DEFAULT '',
		net_bridge TEXT NOT NULL DEFAULT '',
		vlan_tag INTEGER NOT NULL DEFAULT 0,
		description TEXT NOT NULL DEFAULT '',
		protected INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS containers (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL UNIQUE,
		server_id TEXT NOT NULL REFERENCES servers(id),
		zone TEXT NOT NULL,
		cpus INTEGER NOT NULL,
		memory_mb INTEGER NOT NULL,
		disk_gb INTEGER NOT NULL,
		status TEXT NOT NULL,
		driver_id TEXT NOT NULL DEFAULT '',
		internal_ip TEXT NOT NULL DEFAULT '',
		description TEXT NOT NULL DEFAULT '',
		protected INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS dns_providers (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL UNIQUE,
		type TEXT NOT NULL,
		token TEXT NOT NULL DEFAULT '',
		account_id TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS database_servers (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL UNIQUE,
		type TEXT NOT NULL,
		host TEXT NOT NULL,
		port INTEGER NOT NULL,
		username TEXT NOT NULL DEFAULT '',
		password TEXT NOT NULL DEFAULT '',
		dbname TEXT NOT NULL DEFAULT '',
		ssl_mode TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS identity_providers (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL UNIQUE,
		type TEXT NOT NULL,
		base_url TEXT NOT NULL DEFAULT '',
		token TEXT NOT NULL DEFAULT '',
		insecure_tls INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS machine_types (
		name TEXT PRIMARY KEY,
		description TEXT NOT NULL DEFAULT '',
		cpus INTEGER NOT NULL,
		memory_mb INTEGER NOT NULL,
		created_at TEXT NOT NULL
	)`,
}

func (s *Store) migrate() error {
	for _, m := range migrations {
		if _, err := s.db.Exec(m); err != nil {
			return fmt.Errorf("store: migration failed: %w", err)
		}
	}
	return nil
}
