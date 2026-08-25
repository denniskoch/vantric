// Package database defines the abstraction over database servers
// (PostgreSQL first, MySQL/MariaDB next). It mirrors
// internal/hypervisor and internal/dns: nothing outside
// internal/database/* may import an engine's specifics.
//
// These are servers that already exist in the lab. This console
// connects to them and manages what's inside — it does not provision
// the servers themselves.
package database

import (
	"context"
	"errors"
	"vantric/internal/registry"
)

var ErrNotFound = errors.New("database: not found")

// ErrUnsupported is what a driver returns for something its engine has
// no equivalent of. It is a distinct answer from a failure: the UI
// must be able to tell "this engine cannot do that" from "that went
// wrong", so it can decline to offer the action rather than offering
// one that always errors.
var ErrUnsupported = errors.New("database: not supported by this engine")

// ServerInfo is what the server reports about itself.
type ServerInfo struct {
	// Version is the engine's own version string, e.g. "16.2".
	Version string `json:"version"`
	// UptimeSeconds is 0 when the engine doesn't report a start time.
	UptimeSeconds  int64 `json:"uptimeSeconds"`
	SizeBytes      int64 `json:"sizeBytes"`
	Databases      int   `json:"databases"`
	Connections    int   `json:"connections"`
	MaxConnections int   `json:"maxConnections"`
}

// Database is one database inside a server.
type Database struct {
	// ServerID is filled in by the API layer, not the driver.
	ServerID  string `json:"serverId"`
	Name      string `json:"name"`
	Owner     string `json:"owner"`
	SizeBytes int64  `json:"sizeBytes"`
	Encoding  string `json:"encoding"`
	Collation string `json:"collation"`
	// Connections currently open against this database.
	Connections int `json:"connections"`
	// System marks databases the engine owns (templates, catalogs).
	// They're listed but never offered for deletion.
	System bool `json:"system"`
}

// TableKind separates the two things a "table listing" contains.
//
// A VIEW IS NOT A TABLE AND MUST NOT BE HIDDEN. The listing filtered on
// BASE TABLE, so three views in this lab's `romm` database sat on the
// server and on no page here — and a view is exactly the thing somebody
// goes looking for when a query names something they cannot find. It is
// listed WITH ITS KIND rather than filtered out, because the two answer
// different questions: a view has no size, no row count and no storage
// engine, so printing zeroes for those would describe a table that
// isn't there.
type TableKind string

const (
	KindTable TableKind = "table"
	KindView  TableKind = "view"
)

// Table is one table inside a database. Row counts are the engine's
// own ESTIMATE — both engines keep one in their catalog, and counting
// for real means a full scan of someone else's production table.
type Table struct {
	Schema string    `json:"schema"`
	Name   string    `json:"name"`
	Kind   TableKind `json:"kind"`
	Owner  string    `json:"owner"`
	Rows   int64     `json:"rows"`
	// SizeBytes includes indexes.
	SizeBytes int64 `json:"sizeBytes"`
	// Engine is MySQL's storage engine (InnoDB, MyISAM); empty on
	// PostgreSQL, which has one.
	Engine    string `json:"engine"`
	Collation string `json:"collation"`
	Comment   string `json:"comment"`
}

// Grant is what one grantee may do to one thing. Scope is empty for a
// privilege on the database itself, or "schema.table" for one table.
type Grant struct {
	Grantee    string   `json:"grantee"`
	Scope      string   `json:"scope"`
	Privileges []string `json:"privileges"`
}

// AccessLevel is what this console grants. Three answers, not the
// engine's full privilege matrix: "who can read this", "who can write
// to it", "who owns it in practice" is the question people actually
// bring to a console, and the two engines spell the same three answers
// very differently. Anything finer stays in psql or the MySQL client.
type AccessLevel string

const (
	AccessReadOnly  AccessLevel = "read"
	AccessReadWrite AccessLevel = "readwrite"
	AccessFull      AccessLevel = "full"
)

func ValidAccessLevel(level AccessLevel) bool {
	switch level {
	case AccessReadOnly, AccessReadWrite, AccessFull:
		return true
	}
	return false
}

// AccessSpec is one grant of one level to one user on one database.
type AccessSpec struct {
	Database string
	User     string
	// Host is MySQL's half of the identity; ignored by PostgreSQL.
	Host  string
	Level AccessLevel
}

// User is a login role on the server.
type User struct {
	Name string `json:"name"`
	// Host is MySQL's half of the identity ('%', 'localhost'); empty
	// for engines where a user isn't scoped to one.
	Host string `json:"host"`
	// CanLogin is whether this account may currently connect — the one
	// field that answers "is this user disabled", so it must never be
	// assumed. The MySQL driver used to hardcode it true, which said
	// exactly the wrong thing about a locked account.
	CanLogin    bool     `json:"canLogin"`
	Superuser   bool     `json:"superuser"`
	CreateDB    bool     `json:"createDb"`
	Replication bool     `json:"replication"`
	MemberOf    []string `json:"memberOf"`
	// ConnectionLimit is -1 for unlimited.
	ConnectionLimit int  `json:"connectionLimit"`
	System          bool `json:"system"`
	// Role marks a bundle of privileges rather than a way in. MariaDB
	// keeps roles in the same table as accounts (is_role='Y', with an
	// empty host), so they were listed here as though someone could
	// sign in as one. They stay listed, because they are real and
	// granted to real users, but nothing offers to give one a password.
	Role bool `json:"role"`
}

// Connection is one client session, as the server sees it.
type Connection struct {
	PID        int     `json:"pid"`
	User       string  `json:"user"`
	Database   string  `json:"database"`
	ClientAddr string  `json:"clientAddr"`
	AppName    string  `json:"appName"`
	State      string  `json:"state"`
	Query      string  `json:"query"`
	Seconds    float64 `json:"seconds"`
}

type DatabaseSpec struct {
	Name  string
	Owner string
}

type UserSpec struct {
	Name string
	// Host is MySQL's other half of the identity; "%" (any host) when
	// blank. Engines without it ignore the field.
	Host     string
	Password string
	CanLogin bool
	CreateDB bool
}

// Driver is the contract every engine implements. Implementations
// must be safe for concurrent use and hold their own pool.
type Driver interface {
	Type() string
	// Ping checks the credentials work without changing anything.
	Ping(ctx context.Context) error
	Info(ctx context.Context) (*ServerInfo, error)
	Databases(ctx context.Context) ([]Database, error)
	// Tables lists what's inside one database, and Grants who may touch
	// it. Both are read on demand for the detail view, never polled:
	// they query someone else's catalog and one of them (PostgreSQL)
	// has to open a connection to the database itself.
	Tables(ctx context.Context, dbName string) ([]Table, error)
	Grants(ctx context.Context, dbName string) ([]Grant, error)
	// GrantAccess gives a user one of the three levels on a database,
	// replacing whatever they had. Implementations must cover objects
	// created LATER too, or "read access" quietly stops applying the
	// next time the app migrates.
	GrantAccess(ctx context.Context, spec AccessSpec) error
	// RevokeAccess takes it all back, including any standing rule about
	// future objects.
	RevokeAccess(ctx context.Context, dbName, user, host string) error
	Users(ctx context.Context) ([]User, error)
	Connections(ctx context.Context) ([]Connection, error)
	CreateDatabase(ctx context.Context, spec DatabaseSpec) error
	DropDatabase(ctx context.Context, name string) error
	CreateUser(ctx context.Context, spec UserSpec) error
	// Users are addressed by name and host, since MySQL identities are
	// the pair; engines without hosts ignore the second argument.
	DropUser(ctx context.Context, name, host string) error
	SetPassword(ctx context.Context, name, host, password string) error
	// SetUserEnabled turns an account off without deleting it, which is
	// the answer to "this person has left" that keeps their grants
	// intact for whoever inherits the job. MySQL locks the account;
	// PostgreSQL takes LOGIN away from the role.
	SetUserEnabled(ctx context.Context, name, host string, enabled bool) error
	// SetUserHost moves a MySQL identity to a different host pattern.
	//
	// PostgreSQL returns ErrUnsupported, and that is not a gap to fill
	// later: a Postgres role has no host, and where somebody may
	// connect from lives in pg_hba.conf — a FILE on the server, which
	// this console reaches no more than it reaches a hypervisor's
	// /etc. Saying so is better than an action that always fails.
	SetUserHost(ctx context.Context, name, host, newHost string) error
	// Close releases the pool; called when a server is edited or
	// removed, so connections don't leak.
	Close()
}

// Registry holds one live Driver per configured server, keyed by its
// record ID.
//
// The three methods live in internal/registry: they were the same
// three in all seven of these.
type Registry = registry.Of[Driver]

// NewRegistry returns an empty registry.
func NewRegistry() *Registry { return registry.New[Driver]() }
