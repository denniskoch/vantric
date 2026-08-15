// Package mysql implements database.Driver against MySQL and MariaDB.
// The two are close enough to share a driver; where they differ the
// query sticks to what both answer.
package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	mysqldriver "github.com/go-sql-driver/mysql"

	"vantric/internal/database"
)

type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	// Database is the one to connect to; the catalog it reads covers
	// the whole server. Defaults to the mysql schema.
	Database string
	// SSLMode is the same vocabulary the rest of the app uses
	// (libpq's), mapped to the MySQL driver's tls parameter.
	SSLMode string
}

type Driver struct {
	cfg Config
	db  *sql.DB
}

// tlsParam maps the app's SSL modes onto the MySQL driver's.
// "preferred" tries TLS and falls back; "skip-verify" encrypts without
// checking the certificate, which is what require means.
var tlsParam = map[string]string{
	"disable":     "false",
	"prefer":      "preferred",
	"require":     "skip-verify",
	"verify-full": "true",
}

func New(cfg Config) (*Driver, error) {
	if cfg.Port == 0 {
		cfg.Port = 3306
	}
	if cfg.Database == "" {
		cfg.Database = "mysql"
	}
	tls, ok := tlsParam[cfg.SSLMode]
	if !ok {
		tls = "preferred"
	}
	dsnCfg := mysqldriver.NewConfig()
	dsnCfg.User = cfg.Username
	dsnCfg.Passwd = cfg.Password
	dsnCfg.Net = "tcp"
	dsnCfg.Addr = fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	dsnCfg.DBName = cfg.Database
	dsnCfg.TLSConfig = tls
	dsnCfg.Timeout = 10 * time.Second
	// Client attributes, not session variables: anything left in Params
	// is sent as SET <name>, and MySQL rejects names it doesn't know.
	dsnCfg.ConnectionAttributes = "program_name:vantric"

	db, err := sql.Open("mysql", dsnCfg.FormatDSN())
	if err != nil {
		return nil, fmt.Errorf("mysql: %w", err)
	}
	// A console holds connections open against someone else's server,
	// so keep the pool small and let idle ones go.
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	db.SetConnMaxIdleTime(2 * time.Minute)
	return &Driver{cfg: cfg, db: db}, nil
}

func (d *Driver) Type() string { return "mysql" }

func (d *Driver) Close() { _ = d.db.Close() }

func (d *Driver) Ping(ctx context.Context) error {
	if err := d.db.PingContext(ctx); err != nil {
		return fmt.Errorf("mysql: %w", err)
	}
	return nil
}

// globalStatus reads one SHOW GLOBAL STATUS counter. Values arrive as
// strings whatever they hold. SHOW takes no bind parameters, so the
// name is interpolated — every caller passes a constant from this
// file, never anything from a request.
func (d *Driver) globalStatus(ctx context.Context, name string) (int64, error) {
	var key string
	var value string
	row := d.db.QueryRowContext(ctx, "SHOW GLOBAL STATUS LIKE '"+name+"'")
	if err := row.Scan(&key, &value); err != nil {
		return 0, err
	}
	var n int64
	_, _ = fmt.Sscanf(value, "%d", &n)
	return n, nil
}

func (d *Driver) Info(ctx context.Context) (*database.ServerInfo, error) {
	info := &database.ServerInfo{}
	const q = `
		SELECT VERSION(),
		       (SELECT COUNT(*) FROM information_schema.schemata),
		       (SELECT COALESCE(SUM(data_length + index_length), 0)
		          FROM information_schema.tables),
		       @@max_connections`
	if err := d.db.QueryRowContext(ctx, q).Scan(
		&info.Version, &info.Databases, &info.SizeBytes, &info.MaxConnections); err != nil {
		return nil, fmt.Errorf("mysql: %w", err)
	}
	if uptime, err := d.globalStatus(ctx, "Uptime"); err == nil {
		info.UptimeSeconds = uptime
	}
	if conns, err := d.globalStatus(ctx, "Threads_connected"); err == nil {
		info.Connections = int(conns)
	}
	return info, nil
}

// systemSchemas are the server's own; they're listed but never dropped.
var systemSchemas = map[string]bool{
	"information_schema": true,
	"mysql":              true,
	"performance_schema": true,
	"sys":                true,
}

func (d *Driver) Databases(ctx context.Context) ([]database.Database, error) {
	// A schema with no tables must still appear, hence the LEFT JOIN.
	// MySQL has no owner concept — the column stays empty and the UI
	// shows a dash.
	const q = `
		SELECT s.schema_name,
		       COALESCE(SUM(t.data_length + t.index_length), 0),
		       s.default_character_set_name,
		       s.default_collation_name
		  FROM information_schema.schemata s
		  LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name
		 GROUP BY s.schema_name, s.default_character_set_name, s.default_collation_name
		 ORDER BY s.schema_name`
	rows, err := d.db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("mysql: %w", err)
	}
	defer rows.Close()
	databases := []database.Database{}
	for rows.Next() {
		var db database.Database
		if err := rows.Scan(&db.Name, &db.SizeBytes, &db.Encoding, &db.Collation); err != nil {
			return nil, err
		}
		db.System = systemSchemas[db.Name]
		databases = append(databases, db)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Per-database session counts need the PROCESS privilege. Without
	// it the counts are simply absent rather than the page failing.
	counts, err := d.sessionCounts(ctx)
	if err == nil {
		for i := range databases {
			databases[i].Connections = counts[databases[i].Name]
		}
	}
	return databases, nil
}

func (d *Driver) sessionCounts(ctx context.Context) (map[string]int, error) {
	rows, err := d.db.QueryContext(ctx,
		`SELECT db, COUNT(*) FROM information_schema.processlist
		  WHERE db IS NOT NULL GROUP BY db`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var name string
		var n int
		if err := rows.Scan(&name, &n); err != nil {
			return nil, err
		}
		counts[name] = n
	}
	return counts, rows.Err()
}

func (d *Driver) Users(ctx context.Context) ([]database.User, error) {
	// mysql.user is a table in MySQL and a view in MariaDB 10.4+; these
	// columns exist in both. Reading it needs SELECT on the mysql
	// schema, which an admin account has.
	const q = `
		SELECT user, host, super_priv, create_priv, repl_slave_priv, max_user_connections
		  FROM mysql.user
		 ORDER BY user, host`
	rows, err := d.db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("mysql: %w", err)
	}
	defer rows.Close()
	users := []database.User{}
	for rows.Next() {
		var u database.User
		var super, create, repl string // ENUM('N','Y')
		var maxConns int
		if err := rows.Scan(&u.Name, &u.Host, &super, &create, &repl, &maxConns); err != nil {
			return nil, err
		}
		u.Superuser = super == "Y"
		u.CreateDB = create == "Y"
		u.Replication = repl == "Y"
		// A MySQL account exists in order to connect, and 0 means
		// unlimited — which this app reports as -1.
		u.CanLogin = true
		u.ConnectionLimit = -1
		if maxConns > 0 {
			u.ConnectionLimit = maxConns
		}
		u.System = systemUser(u.Name)
		users = append(users, u)
	}
	return users, rows.Err()
}

// systemUser marks the accounts the server ships with, which exist to
// run internal jobs and shouldn't be offered up for deletion.
func systemUser(name string) bool {
	return strings.HasPrefix(name, "mysql.") || name == "mariadb.sys" ||
		name == "rdsadmin" || name == "healthchecker"
}

func (d *Driver) Connections(ctx context.Context) ([]database.Connection, error) {
	const q = `
		SELECT id, COALESCE(user, ''), COALESCE(db, ''), COALESCE(host, ''),
		       COALESCE(command, ''), COALESCE(time, 0), COALESCE(info, '')
		  FROM information_schema.processlist
		 ORDER BY id`
	rows, err := d.db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("mysql: %w", err)
	}
	defer rows.Close()
	connections := []database.Connection{}
	for rows.Next() {
		var c database.Connection
		var command string
		var seconds int64
		if err := rows.Scan(&c.PID, &c.User, &c.Database, &c.ClientAddr,
			&command, &seconds, &c.Query); err != nil {
			return nil, err
		}
		// MySQL reports a command where PostgreSQL reports a state;
		// "Sleep" is the same thing as "idle".
		if command == "Sleep" {
			c.State = "idle"
		} else {
			c.State = strings.ToLower(command)
		}
		c.Seconds = float64(seconds)
		// host is "1.2.3.4:54321" — the port is noise in a list.
		if host, _, ok := strings.Cut(c.ClientAddr, ":"); ok {
			c.ClientAddr = host
		}
		connections = append(connections, c)
	}
	return connections, rows.Err()
}

// quote makes an identifier safe to interpolate: backtick-quoted, with
// any backtick inside doubled. DDL can't take bind parameters, so
// every name reaching a statement goes through this (and through the
// API layer's name check before that).
func quote(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}

// quoteLiteral is the same for a string value. Backslash escapes are
// on by default in MySQL, so both it and the quote need doubling.
func quoteLiteral(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func userHost(host string) string {
	if host == "" {
		return "%"
	}
	return host
}

func account(name, host string) string {
	return quoteLiteral(name) + "@" + quoteLiteral(userHost(host))
}

// CreateDatabase ignores the owner: MySQL databases don't have one.
// Grants are what tie a user to a database, and those are separate.
func (d *Driver) CreateDatabase(ctx context.Context, spec database.DatabaseSpec) error {
	if _, err := d.db.ExecContext(ctx, "CREATE DATABASE "+quote(spec.Name)); err != nil {
		return fmt.Errorf("mysql: %w", err)
	}
	return nil
}

func (d *Driver) DropDatabase(ctx context.Context, name string) error {
	if _, err := d.db.ExecContext(ctx, "DROP DATABASE "+quote(name)); err != nil {
		return fmt.Errorf("mysql: %w", err)
	}
	return nil
}

func (d *Driver) CreateUser(ctx context.Context, spec database.UserSpec) error {
	stmt := "CREATE USER " + account(spec.Name, spec.Host)
	if spec.Password != "" {
		stmt += " IDENTIFIED BY " + quoteLiteral(spec.Password)
	}
	if _, err := d.db.ExecContext(ctx, stmt); err != nil {
		return fmt.Errorf("mysql: %w", err)
	}
	if spec.CreateDB {
		grant := "GRANT CREATE ON *.* TO " + account(spec.Name, spec.Host)
		if _, err := d.db.ExecContext(ctx, grant); err != nil {
			return fmt.Errorf("mysql: user created but granting CREATE failed: %w", err)
		}
	}
	return nil
}

func (d *Driver) DropUser(ctx context.Context, name, host string) error {
	if _, err := d.db.ExecContext(ctx, "DROP USER "+account(name, host)); err != nil {
		return fmt.Errorf("mysql: %w", err)
	}
	return nil
}

func (d *Driver) SetPassword(ctx context.Context, name, host, password string) error {
	stmt := "ALTER USER " + account(name, host) + " IDENTIFIED BY " + quoteLiteral(password)
	if _, err := d.db.ExecContext(ctx, stmt); err != nil {
		return fmt.Errorf("mysql: %w", err)
	}
	return nil
}
