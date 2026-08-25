// Package mysql implements database.Driver against MySQL and MariaDB.
// The two are close enough to share a driver; where they differ the
// query sticks to what both answer.
package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
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
	// mu guards lock, which is discovered on first use.
	mu   sync.Mutex
	lock lockShape
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

// lockShape is how this server records a locked account. The two
// engines this driver serves keep the same fact in different places,
// and neither can read the other's — so it is DISCOVERED on the first
// listing rather than configured, the same rule the UniFi driver
// follows for its API prefix.
//
//   - MySQL 5.7.6+ : mysql.user.account_locked, an ENUM('N','Y')
//   - MariaDB 10.4+: mysql.global_priv, JSON, key $.account_locked —
//     ABSENT when the account is not locked, which is not the same as
//     present-and-false. A key left at its default is omitted.
//
// Older servers of either family have no lock at all, and there
// `lockNone` is the honest answer: every account really can log in.
type lockShape int

const (
	lockUnknown lockShape = iota
	lockColumn
	lockGlobalPriv
	lockNone
)

// lockedAccounts returns the accounts this server considers locked,
// keyed by user\x00host.
func (d *Driver) lockedAccounts(ctx context.Context) map[string]bool {
	locked := map[string]bool{}
	scan := func(q string) error {
		rows, err := d.db.QueryContext(ctx, q)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var user, host string
			if err := rows.Scan(&user, &host); err != nil {
				return err
			}
			locked[user+"\x00"+host] = true
		}
		return rows.Err()
	}

	const columnQuery = `SELECT user, host FROM mysql.user WHERE account_locked = 'Y'`
	const globalPrivQuery = `SELECT user, host FROM mysql.global_priv
	                          WHERE JSON_VALUE(Priv, '$.account_locked') = 1`

	d.mu.Lock()
	shape := d.lock
	d.mu.Unlock()

	switch shape {
	case lockColumn:
		if err := scan(columnQuery); err == nil {
			return locked
		}
	case lockGlobalPriv:
		if err := scan(globalPrivQuery); err == nil {
			return locked
		}
	case lockNone:
		return locked
	}

	// First time, or the remembered shape stopped working (a server
	// upgraded under us). Try both and remember which answered.
	for _, attempt := range []struct {
		shape lockShape
		query string
	}{{lockColumn, columnQuery}, {lockGlobalPriv, globalPrivQuery}} {
		if err := scan(attempt.query); err == nil {
			d.mu.Lock()
			d.lock = attempt.shape
			d.mu.Unlock()
			return locked
		}
		// A failed attempt may have added rows before erroring.
		clear(locked)
	}
	d.mu.Lock()
	d.lock = lockNone
	d.mu.Unlock()
	return locked
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
		u.ConnectionLimit = -1
		if maxConns > 0 {
			u.ConnectionLimit = maxConns
		}
		u.System = systemUser(u.Name)
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// WHETHER AN ACCOUNT CAN LOG IN IS READ, NOT ASSUMED. This was
	// hardcoded true, so a locked account read as one that could sign
	// in — the console stating the opposite of the truth on the single
	// field that answers "is this user disabled".
	locked := d.lockedAccounts(ctx)
	roles := d.roleNames(ctx)
	for i := range users {
		u := &users[i]
		u.Role = roles[u.Name]
		// A role is not a way in, whatever else is true of it.
		u.CanLogin = !u.Role && !locked[u.Name+"\x00"+u.Host]
	}
	return users, nil
}

// roleNames is the set of entries in mysql.user that are MariaDB
// ROLES rather than accounts. They sit in the same table with an empty
// host, so without this a role was listed as somebody who could sign
// in. MySQL has no roles in this sense and the column is absent, which
// is an empty set rather than an error.
func (d *Driver) roleNames(ctx context.Context) map[string]bool {
	roles := map[string]bool{}
	rows, err := d.db.QueryContext(ctx,
		`SELECT user FROM mysql.user WHERE is_role = 'Y'`)
	if err != nil {
		return roles
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return roles
		}
		roles[name] = true
	}
	return roles
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

// SetUserEnabled locks or unlocks the account.
//
// A LOCKED ACCOUNT KEEPS EVERYTHING ELSE. Its grants, its password and
// its host stay exactly as they were — which is the whole point of
// having this beside Delete: "they have left" and "this login is
// finished forever" are different decisions, and only one of them is
// reversible.
//
// ACCOUNT LOCK arrived in MySQL 5.7.6 and MariaDB 10.4.2. An older
// server rejects the syntax outright, and that comes back as the
// engine's own message rather than being dressed up as something else.
func (d *Driver) SetUserEnabled(ctx context.Context, name, host string, enabled bool) error {
	what := "ACCOUNT LOCK"
	if enabled {
		what = "ACCOUNT UNLOCK"
	}
	if _, err := d.db.ExecContext(ctx, "ALTER USER "+account(name, host)+" "+what); err != nil {
		return fmt.Errorf("mysql: %w", err)
	}
	return nil
}

// SetUserHost moves the account to a different host pattern.
//
// THE HOST IS HALF THE IDENTITY, so this is a RENAME rather than an
// update of a field: 'app'@'10.0.0.5' and 'app'@'%' are two different
// accounts as far as the server is concerned, and RENAME USER is what
// carries the password and every grant across. Dropping and recreating
// would silently discard both.
func (d *Driver) SetUserHost(ctx context.Context, name, host, newHost string) error {
	if newHost == "" {
		newHost = "%"
	}
	if host == "" {
		host = "%"
	}
	if newHost == host {
		return nil
	}
	stmt := "RENAME USER " + account(name, host) + " TO " + account(name, newHost)
	if _, err := d.db.ExecContext(ctx, stmt); err != nil {
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
