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
	"sync"
)

var ErrNotFound = errors.New("database: not found")

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

// Table is one table inside a database. Row counts are the engine's
// own ESTIMATE — both engines keep one in their catalog, and counting
// for real means a full scan of someone else's production table.
type Table struct {
	Schema string `json:"schema"`
	Name   string `json:"name"`
	Owner  string `json:"owner"`
	Rows   int64  `json:"rows"`
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
	Host        string   `json:"host"`
	CanLogin    bool     `json:"canLogin"`
	Superuser   bool     `json:"superuser"`
	CreateDB    bool     `json:"createDb"`
	Replication bool     `json:"replication"`
	MemberOf    []string `json:"memberOf"`
	// ConnectionLimit is -1 for unlimited.
	ConnectionLimit int  `json:"connectionLimit"`
	System          bool `json:"system"`
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
	// Close releases the pool; called when a server is edited or
	// removed, so connections don't leak.
	Close()
}

// Registry holds one live Driver per configured server, keyed by its
// record ID.
type Registry struct {
	mu      sync.RWMutex
	drivers map[string]Driver
}

func NewRegistry() *Registry {
	return &Registry{drivers: map[string]Driver{}}
}

func (r *Registry) Get(id string) (Driver, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	d, ok := r.drivers[id]
	return d, ok
}

// Set replaces any driver already registered, closing it first.
func (r *Registry) Set(id string, d Driver) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if old, ok := r.drivers[id]; ok {
		old.Close()
	}
	r.drivers[id] = d
}

func (r *Registry) Remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if d, ok := r.drivers[id]; ok {
		d.Close()
	}
	delete(r.drivers, id)
}
