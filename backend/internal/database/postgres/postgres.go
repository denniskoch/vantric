// Package postgres implements database.Driver against PostgreSQL
// using pgx.
package postgres

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"lab-cloud-manager/internal/database"
)

type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	// Database is the one to connect to; the catalog views it reads
	// cover the whole server. Defaults to "postgres".
	Database string
	// SSLMode is libpq's: disable, prefer, require, verify-full.
	SSLMode string
}

type Driver struct {
	cfg  Config
	pool *pgxpool.Pool
}

func New(cfg Config) (*Driver, error) {
	if cfg.Port == 0 {
		cfg.Port = 5432
	}
	if cfg.Database == "" {
		cfg.Database = "postgres"
	}
	if cfg.SSLMode == "" {
		cfg.SSLMode = "prefer"
	}
	poolCfg, err := pgxpool.ParseConfig(dsn(cfg))
	if err != nil {
		return nil, fmt.Errorf("postgres: %w", err)
	}
	// A console holds connections open against someone else's server,
	// so keep the pool small and let idle ones go.
	poolCfg.MaxConns = 4
	poolCfg.MaxConnIdleTime = 2 * time.Minute
	poolCfg.ConnConfig.ConnectTimeout = 10 * time.Second
	pool, err := pgxpool.NewWithConfig(context.Background(), poolCfg)
	if err != nil {
		return nil, fmt.Errorf("postgres: %w", err)
	}
	return &Driver{cfg: cfg, pool: pool}, nil
}

func dsn(cfg Config) string {
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s&application_name=lab-cloud-manager",
		urlEscape(cfg.Username), urlEscape(cfg.Password), cfg.Host, cfg.Port,
		urlEscape(cfg.Database), cfg.SSLMode)
}

// urlEscape percent-encodes the characters that would otherwise end a
// DSN field early. Passwords routinely contain them.
func urlEscape(s string) string {
	replacer := strings.NewReplacer(
		"%", "%25", ":", "%3A", "/", "%2F", "?", "%3F", "#", "%23",
		"[", "%5B", "]", "%5D", "@", "%40", " ", "%20",
	)
	return replacer.Replace(s)
}

func (d *Driver) Type() string { return "postgres" }

func (d *Driver) Close() { d.pool.Close() }

func (d *Driver) Ping(ctx context.Context) error {
	if err := d.pool.Ping(ctx); err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	return nil
}

func (d *Driver) Info(ctx context.Context) (*database.ServerInfo, error) {
	info := &database.ServerInfo{}
	// pg_database_size needs CONNECT on the database, which a
	// non-superuser may lack; skipping those beats failing the page.
	const q = `
		SELECT current_setting('server_version'),
		       COALESCE(EXTRACT(EPOCH FROM now() - pg_postmaster_start_time())::bigint, 0),
		       (SELECT COALESCE(SUM(CASE WHEN has_database_privilege(datname, 'CONNECT')
		                                 THEN pg_database_size(datname) ELSE 0 END), 0)::bigint
		          FROM pg_database WHERE datallowconn),
		       (SELECT count(*) FROM pg_database WHERE datallowconn),
		       (SELECT count(*) FROM pg_stat_activity),
		       current_setting('max_connections')::int`
	err := d.pool.QueryRow(ctx, q).Scan(
		&info.Version, &info.UptimeSeconds, &info.SizeBytes,
		&info.Databases, &info.Connections, &info.MaxConnections)
	if err != nil {
		return nil, fmt.Errorf("postgres: %w", err)
	}
	return info, nil
}

func (d *Driver) Databases(ctx context.Context) ([]database.Database, error) {
	const q = `
		SELECT d.datname,
		       pg_get_userbyid(d.datdba),
		       CASE WHEN has_database_privilege(d.datname, 'CONNECT')
		            THEN pg_database_size(d.datname) ELSE 0 END::bigint,
		       pg_encoding_to_char(d.encoding),
		       d.datcollate,
		       (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname),
		       d.datistemplate OR d.datname = 'postgres'
		  FROM pg_database d
		 WHERE d.datallowconn OR d.datistemplate
		 ORDER BY d.datname`
	rows, err := d.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("postgres: %w", err)
	}
	defer rows.Close()
	databases := []database.Database{}
	for rows.Next() {
		var db database.Database
		if err := rows.Scan(&db.Name, &db.Owner, &db.SizeBytes, &db.Encoding,
			&db.Collation, &db.Connections, &db.System); err != nil {
			return nil, err
		}
		databases = append(databases, db)
	}
	return databases, rows.Err()
}

func (d *Driver) Users(ctx context.Context) ([]database.User, error) {
	// pg_* roles are the engine's own predefined ones; they'd bury the
	// handful of roles someone actually created.
	const q = `
		SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreatedb,
		       r.rolreplication, r.rolconnlimit,
		       ARRAY(SELECT b.rolname FROM pg_auth_members m
		               JOIN pg_roles b ON m.roleid = b.oid
		              WHERE m.member = r.oid ORDER BY b.rolname)
		  FROM pg_roles r
		 WHERE r.rolname NOT LIKE 'pg\_%'
		 ORDER BY r.rolname`
	rows, err := d.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("postgres: %w", err)
	}
	defer rows.Close()
	users := []database.User{}
	for rows.Next() {
		var u database.User
		if err := rows.Scan(&u.Name, &u.CanLogin, &u.Superuser, &u.CreateDB,
			&u.Replication, &u.ConnectionLimit, &u.MemberOf); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (d *Driver) Connections(ctx context.Context) ([]database.Connection, error) {
	const q = `
		SELECT pid,
		       COALESCE(usename, ''),
		       COALESCE(datname, ''),
		       COALESCE(host(client_addr), ''),
		       COALESCE(application_name, ''),
		       COALESCE(state, ''),
		       COALESCE(query, ''),
		       COALESCE(EXTRACT(EPOCH FROM now() - COALESCE(state_change, backend_start)), 0)
		  FROM pg_stat_activity
		 WHERE backend_type = 'client backend'
		 ORDER BY pid`
	rows, err := d.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("postgres: %w", err)
	}
	defer rows.Close()
	connections := []database.Connection{}
	for rows.Next() {
		var c database.Connection
		if err := rows.Scan(&c.PID, &c.User, &c.Database, &c.ClientAddr,
			&c.AppName, &c.State, &c.Query, &c.Seconds); err != nil {
			return nil, err
		}
		connections = append(connections, c)
	}
	return connections, rows.Err()
}

// quote makes an identifier safe to interpolate. DDL can't take bind
// parameters, so every name reaching a statement goes through this
// (and through the API layer's name check before that).
func quote(name string) string {
	return pgx.Identifier{name}.Sanitize()
}

// quoteLiteral is the same for a string value. standard_conforming_
// strings has been on by default since 9.1, so doubling the quote is
// the whole job.
func quoteLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func (d *Driver) CreateDatabase(ctx context.Context, spec database.DatabaseSpec) error {
	stmt := "CREATE DATABASE " + quote(spec.Name)
	if spec.Owner != "" {
		stmt += " OWNER " + quote(spec.Owner)
	}
	if _, err := d.pool.Exec(ctx, stmt); err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	return nil
}

func (d *Driver) DropDatabase(ctx context.Context, name string) error {
	if _, err := d.pool.Exec(ctx, "DROP DATABASE "+quote(name)); err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	return nil
}

func (d *Driver) CreateUser(ctx context.Context, spec database.UserSpec) error {
	stmt := "CREATE ROLE " + quote(spec.Name)
	if spec.CanLogin {
		stmt += " LOGIN"
	}
	if spec.CreateDB {
		stmt += " CREATEDB"
	}
	if spec.Password != "" {
		stmt += " PASSWORD " + quoteLiteral(spec.Password)
	}
	if _, err := d.pool.Exec(ctx, stmt); err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	return nil
}

// Roles have no host in PostgreSQL; the argument is ignored.
func (d *Driver) DropUser(ctx context.Context, name, _ string) error {
	if _, err := d.pool.Exec(ctx, "DROP ROLE "+quote(name)); err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	return nil
}

func (d *Driver) SetPassword(ctx context.Context, name, _, password string) error {
	stmt := "ALTER ROLE " + quote(name) + " PASSWORD " + quoteLiteral(password)
	if _, err := d.pool.Exec(ctx, stmt); err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	return nil
}
