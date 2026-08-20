// Package identity defines the abstraction over identity providers
// (authentik first). It mirrors internal/hypervisor, internal/dns and
// internal/database: nothing outside internal/identity/* may import a
// provider's specifics.
//
// The provider owns the directory. This console reads it and performs
// the everyday actions — disable an account, reset a password, change
// a group — and leaves flows, stages and policies to the provider's
// own UI, where that work belongs.
package identity

import (
	"context"
	"errors"
	"vantric/internal/registry"
)

var ErrNotFound = errors.New("identity: not found")

// Info is what the provider reports about itself.
type Info struct {
	Version string `json:"version"`
	// LatestVersion and Outdated are empty/false when the provider
	// doesn't report an upstream version.
	LatestVersion string `json:"latestVersion"`
	Outdated      bool   `json:"outdated"`
	Users         int    `json:"users"`
	Groups        int    `json:"groups"`
	Applications  int    `json:"applications"`
}

// User is an account in the directory.
type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	Active   bool   `json:"active"`
	// Superuser is true when the account, or a group it belongs to,
	// carries administrator rights.
	Superuser bool `json:"superuser"`
	// Kind separates people from service accounts.
	Kind string `json:"kind"`
	// LastLogin is unix seconds; 0 when the account has never signed in.
	LastLogin int64    `json:"lastLogin"`
	Groups    []string `json:"groups"`
}

// Group is a collection of users, and usually what grants access.
type Group struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Superuser groups make their members administrators.
	Superuser bool   `json:"superuser"`
	Members   int    `json:"members"`
	Parent    string `json:"parent"`
}

// Application is something users sign in to through this provider.
type Application struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
	// LaunchURL is where a user lands; empty for applications with no
	// front door of their own.
	LaunchURL string `json:"launchUrl"`
	// Provider names the login mechanism behind the application, and
	// ProviderType is its kind (oauth2, proxy, saml, ldap, …).
	Provider     string `json:"provider"`
	ProviderType string `json:"providerType"`
	Description  string `json:"description"`
}

// Event is one entry from the provider's audit log.
type Event struct {
	ID       string `json:"id"`
	Action   string `json:"action"`
	User     string `json:"user"`
	App      string `json:"app"`
	ClientIP string `json:"clientIp"`
	// Created is unix seconds.
	Created int64 `json:"created"`
	// Detail is a short human summary drawn from the event's context.
	Detail string `json:"detail"`
}

// UserSpec describes an account to create. A new account has no
// password: the provider issues a recovery link instead, so the person
// sets their own and passes through enrollment and MFA on the way.
type UserSpec struct {
	Username string
	Name     string
	Email    string
	// Groups are group IDs the account joins on creation.
	Groups []string
}

// Provider is the contract every identity backend implements.
// Implementations must be safe for concurrent use.
type Provider interface {
	Type() string
	// Verify checks the credentials work without changing anything.
	Verify(ctx context.Context) error
	Info(ctx context.Context) (*Info, error)
	Users(ctx context.Context) ([]User, error)
	Groups(ctx context.Context) ([]Group, error)
	Applications(ctx context.Context) ([]Application, error)
	// Events returns the most recent audit entries, newest first.
	Events(ctx context.Context, limit int) ([]Event, error)
	CreateUser(ctx context.Context, spec UserSpec) (*User, error)
	// RecoveryLink returns a one-time URL the new account holder uses to
	// set their own password. Providers that can't issue one return an
	// error rather than a blank string.
	RecoveryLink(ctx context.Context, userID string) (string, error)
	SetUserActive(ctx context.Context, userID string, active bool) error
	SetUserPassword(ctx context.Context, userID, password string) error
	AddUserToGroup(ctx context.Context, groupID, userID string) error
	RemoveUserFromGroup(ctx context.Context, groupID, userID string) error
}

// Registry holds one live Provider per configured record, keyed by its
// record ID.
//
// The three methods live in internal/registry: they were the same
// three in all seven of these.
type Registry = registry.Of[Provider]

// NewRegistry returns an empty registry.
func NewRegistry() *Registry { return registry.New[Provider]() }
