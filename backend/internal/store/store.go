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
	`CREATE TABLE IF NOT EXISTS hypervisors (
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
		hypervisor_id TEXT NOT NULL REFERENCES hypervisors(id),
		node TEXT NOT NULL,
		cpus INTEGER NOT NULL,
		memory_mb INTEGER NOT NULL,
		disk_gb INTEGER NOT NULL,
		image_id TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL,
		driver_id TEXT NOT NULL DEFAULT '',
		internal_ip TEXT NOT NULL DEFAULT '',
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
		hypervisor_id TEXT NOT NULL REFERENCES hypervisors(id),
		node TEXT NOT NULL,
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
		base_url TEXT NOT NULL DEFAULT '',
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
	// A public reference, cached. See internal/store/cves.go for why
	// this one local copy is allowed where others aren't.
	`CREATE TABLE IF NOT EXISTS cve_cache (
		id TEXT PRIMARY KEY,
		description TEXT NOT NULL DEFAULT '',
		published INTEGER NOT NULL DEFAULT 0,
		last_modified INTEGER NOT NULL DEFAULT 0,
		score REAL NOT NULL DEFAULT 0,
		severity TEXT NOT NULL DEFAULT '',
		metrics TEXT NOT NULL DEFAULT '',
		weaknesses TEXT NOT NULL DEFAULT '',
		references_json TEXT NOT NULL DEFAULT '',
		fetched_at INTEGER NOT NULL DEFAULT 0,
		missing INTEGER NOT NULL DEFAULT 0
	)`,
	// Who did what. See internal/store/audit.go — the mapping from an
	// action to a person exists nowhere else, because every backend is
	// reached through one shared credential.
	`CREATE TABLE IF NOT EXISTS audit_log (
		id TEXT PRIMARY KEY,
		at INTEGER NOT NULL,
		actor_id TEXT NOT NULL DEFAULT '',
		actor_email TEXT NOT NULL DEFAULT '',
		method TEXT NOT NULL DEFAULT '',
		path TEXT NOT NULL DEFAULT '',
		action TEXT NOT NULL DEFAULT '',
		resource TEXT NOT NULL DEFAULT '',
		status INTEGER NOT NULL DEFAULT 0,
		error TEXT NOT NULL DEFAULT '',
		duration_ms INTEGER NOT NULL DEFAULT 0,
		remote_addr TEXT NOT NULL DEFAULT '',
		payload TEXT NOT NULL DEFAULT ''
	)`,
	`CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (at DESC)`,
	// The console's own settings, as opposed to a backend's credentials.
	// One row per key so a new one needs no migration.
	`CREATE TABLE IF NOT EXISTS app_settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS inventory_providers (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL UNIQUE,
		type TEXT NOT NULL,
		base_url TEXT NOT NULL DEFAULT '',
		token TEXT NOT NULL DEFAULT '',
		insecure_tls INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL
	)`,
	// S3-compatible object stores. Several are supported for the same
	// reason several hypervisors are: a lab may run one for backups and
	// another for whatever it serves.
	`CREATE TABLE IF NOT EXISTS storage_providers (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL UNIQUE,
		type TEXT NOT NULL,
		base_url TEXT NOT NULL DEFAULT '',
		access_key TEXT NOT NULL DEFAULT '',
		secret_key TEXT NOT NULL DEFAULT '',
		region TEXT NOT NULL DEFAULT '',
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
	// Address ranges and what they're for. The console owns the ones
	// typed in here (source 'manual') because a lab without an IPAM has
	// nowhere else to write them down; a range discovered from a
	// controller carries that controller as its source and is read-only.
	`CREATE TABLE IF NOT EXISTS subnets (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		source TEXT NOT NULL DEFAULT 'manual',
		source_id TEXT NOT NULL DEFAULT '',
		stack_type TEXT NOT NULL DEFAULT 'IPv4',
		vlan INTEGER NOT NULL DEFAULT 0,
		ipv4_range TEXT NOT NULL DEFAULT '',
		ipv4_gateway TEXT NOT NULL DEFAULT '',
		dhcp_start TEXT NOT NULL DEFAULT '',
		dhcp_stop TEXT NOT NULL DEFAULT '',
		description TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	// Names are NOT unique: a multi-site controller calls two different
	// networks "Default", and a range is what identifies a subnet
	// anyway. What must not repeat is the same upstream object imported
	// twice, which is what makes re-importing safe to do at any time.
	`CREATE UNIQUE INDEX IF NOT EXISTS subnets_source ON subnets (source, source_id)
	 WHERE source_id != ''`,
	// What is known about individual addresses. Deliberately NOT a row
	// per address: a /20 is 4096 of them and a /16 is 65k, nearly all
	// with nothing to say. The address list is generated from the
	// prefix; this table holds only the ones somebody has recorded
	// something about. ON DELETE CASCADE is real here — the pragma is
	// set in Open — so removing a subnet takes its records with it.
	`CREATE TABLE IF NOT EXISTS ip_addresses (
		id TEXT PRIMARY KEY,
		subnet_id TEXT NOT NULL REFERENCES subnets(id) ON DELETE CASCADE,
		address TEXT NOT NULL,
		hostname TEXT NOT NULL DEFAULT '',
		mac TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'assigned',
		description TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS ip_addresses_unique
	 ON ip_addresses (subnet_id, address)`,
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
	// Renames run FIRST. A CREATE TABLE IF NOT EXISTS under the new
	// name would otherwise make an empty table beside the populated old
	// one, and the rename would then fail against a name already taken.
	for _, m := range renameMigrations {
		// "no such table"/"no such column" is a rename that already ran,
		// or a fresh database that never had the old name — both are the
		// expected outcome on every boot but the one that migrates.
		if _, err := s.db.Exec(m); err != nil &&
			!strings.Contains(err.Error(), "no such table") &&
			!strings.Contains(err.Error(), "no such column") &&
			!strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("store: migration failed: %w", err)
		}
	}
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
// A placement target is a NODE — the machine a guest runs on. It was
// "zone", borrowed from a cloud where a zone is a datacenter holding
// thousands of machines rather than the one box this names.
// A hypervisor record was a "server", which is vague and was already
// three things here — a virtualization host, a database server, and
// this app's own HTTP server. The UI has always called it a hypervisor.
var renameMigrations = []string{
	`ALTER TABLE instances RENAME COLUMN zone TO node`,
	`ALTER TABLE containers RENAME COLUMN zone TO node`,
	`ALTER TABLE servers RENAME TO hypervisors`,
	`ALTER TABLE instances RENAME COLUMN server_id TO hypervisor_id`,
	`ALTER TABLE containers RENAME COLUMN server_id TO hypervisor_id`,
}

var columnMigrations = []string{
	// VLAN arrived a commit after the subnets table did; a database
	// created in between has the table without it.
	`ALTER TABLE subnets ADD COLUMN vlan INTEGER NOT NULL DEFAULT 0`,
	`ALTER TABLE instances DROP COLUMN machine_type`,
	`DROP TABLE IF EXISTS machine_types`,
	`ALTER TABLE instances ADD COLUMN os_type TEXT NOT NULL DEFAULT ''`,
	// The guest's own identity, for correlating with tools that run
	// inside it. Filled in beside os_type on the reconciler's slow beat.
	`ALTER TABLE instances ADD COLUMN uuid TEXT NOT NULL DEFAULT ''`,
	// Empty on almost every guest until somebody sets one; inventory
	// tools key on it, so the console reports whether it's there.
	`ALTER TABLE instances ADD COLUMN serial TEXT NOT NULL DEFAULT ''`,
	// Each account signs in to guests with its own key, so a guest's
	// auth log names a person. Generated on first use; the public half
	// is stored beside it rather than derived on every read.
	`ALTER TABLE iam_users ADD COLUMN ssh_private_key TEXT NOT NULL DEFAULT ''`,
	`ALTER TABLE iam_users ADD COLUMN ssh_public_key TEXT NOT NULL DEFAULT ''`,
	`ALTER TABLE iam_users ADD COLUMN ssh_key_imported INTEGER NOT NULL DEFAULT 0`,
	// A self-hosted DNS provider has an address; a hosted one's is a
	// constant in its own implementation. Empty for Cloudflare rows
	// that predate this.
	`ALTER TABLE dns_providers ADD COLUMN base_url TEXT NOT NULL DEFAULT ''`,
	// An external address is a cloud's idea: a VM there sits on a private
	// network and is given a public address to be reached at. A guest on
	// a hypervisor has the one address its bridge puts it on, and no
	// driver ever filled this — so the column, and the table column above
	// it, only ever said "—", which reads as "we looked and found none"
	// rather than "this doesn't exist here".
	`ALTER TABLE instances DROP COLUMN external_ip`,
}
