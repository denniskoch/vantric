// Package store persists app state. SQL is kept portable between SQLite
// (development default) and PostgreSQL: TEXT keys, RFC3339 timestamps,
// no engine-specific column types.
package store

import (
	"database/sql"
	"fmt"
	"strings"

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
	`CREATE TABLE IF NOT EXISTS network_providers (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL UNIQUE,
		type TEXT NOT NULL,
		base_url TEXT NOT NULL DEFAULT '',
		site TEXT NOT NULL DEFAULT 'default',
		api_key TEXT NOT NULL DEFAULT '',
		username TEXT NOT NULL DEFAULT '',
		password TEXT NOT NULL DEFAULT '',
		insecure_tls INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL
	)`,
	// This console's own accounts — distinct from the identity provider
	// it manages. password_hash is empty for an account that signs in
	// some other way, which is what SSO will look like when it lands.
	`CREATE TABLE IF NOT EXISTS iam_users (
		id TEXT PRIMARY KEY,
		email TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL DEFAULT '',
		role TEXT NOT NULL,
		password_hash TEXT NOT NULL DEFAULT '',
		active INTEGER NOT NULL DEFAULT 1,
		last_login_at TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	// Signing in through the lab's identity service. One row: a lab has
	// one identity provider, and making every page pass an id it can't
	// get wrong is noise. Local accounts stay the fallback door.
	`CREATE TABLE IF NOT EXISTS auth_oidc (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL DEFAULT '',
		issuer TEXT NOT NULL,
		client_id TEXT NOT NULL,
		client_secret TEXT NOT NULL DEFAULT '',
		scopes TEXT NOT NULL DEFAULT 'openid profile email',
		auto_create INTEGER NOT NULL DEFAULT 0,
		default_role TEXT NOT NULL DEFAULT 'viewer',
		enabled INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	// Sessions live server-side so signing out, or disabling an account,
	// takes effect immediately — which a self-contained token can't do.
	`CREATE TABLE IF NOT EXISTS iam_sessions (
		token TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES iam_users(id),
		created_at TEXT NOT NULL,
		expires_at TEXT NOT NULL
	)`,
}

func (s *Store) migrate() error {
	for _, m := range migrations {
		if _, err := s.db.Exec(m); err != nil {
			return fmt.Errorf("store: migration failed: %w", err)
		}
	}
	// Columns added after a table shipped. SQLite has no
	// ADD COLUMN IF NOT EXISTS, and re-adding one is the expected
	// outcome on every boot after the first — so that error alone is
	// not a failure.
	for _, m := range columnMigrations {
		// "duplicate column" is an ADD that already ran; "no such column"
		// is a DROP that already ran. Both are the expected outcome on
		// every boot after the first.
		if _, err := s.db.Exec(m); err != nil &&
			!strings.Contains(err.Error(), "duplicate column") &&
			!strings.Contains(err.Error(), "no such column") {
			return fmt.Errorf("store: migration failed: %w", err)
		}
	}
	return nil
}

// Machine types were a GCP analogue that didn't earn its keep in a lab
// where you size a VM by typing the numbers you want. Existing
// databases drop the column and the catalog; fresh ones never make
// them, so both of these are "already done" on most boots.
var columnMigrations = []string{
	`ALTER TABLE instances DROP COLUMN machine_type`,
	`DROP TABLE IF EXISTS machine_types`,
	`ALTER TABLE instances ADD COLUMN os_type TEXT NOT NULL DEFAULT ''`,
	// Each account signs in to guests with its own key, so a guest's
	// auth log names a person. Generated on first use; the public half
	// is stored beside it rather than derived on every read.
	`ALTER TABLE iam_users ADD COLUMN ssh_private_key TEXT NOT NULL DEFAULT ''`,
	`ALTER TABLE iam_users ADD COLUMN ssh_public_key TEXT NOT NULL DEFAULT ''`,
	`ALTER TABLE iam_users ADD COLUMN ssh_key_imported INTEGER NOT NULL DEFAULT 0`,
}
