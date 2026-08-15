// Package config is the app's own settings, read from VANTRIC_*
// environment variables.
//
// Environment only, and deliberately: every setting here is a single
// scalar, Docker is the deployment target, and compose already speaks
// env. A YAML file alongside it was a second way to say the same eight
// things — see .env.example, which documents them in one place.
//
// This is the app itself, not the lab. Hypervisors, DNS, databases,
// identity, network controllers and single sign-on are records you add
// in the UI, where the credentials are checked before they're stored.
package config

import (
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	// Listen is the address the API serves on.
	Listen   string
	Database Database
	// SiteURL is the address people reach this console at, e.g.
	// https://console.example.com. Behind a proxy or a tunnel the app
	// cannot work this out — the request arrives addressed to whatever
	// the proxy dialled, an internal name and port — so anything the
	// outside world has to match, notably the OIDC redirect URI, is
	// built from this. Empty means derive it from the request, which is
	// right when you reach the app directly.
	SiteURL string
	// StaticDir, when set, serves the built frontend from this directory
	// (with SPA fallback). Empty in development, where Vite serves the UI.
	StaticDir string
	SSH       SSH
	Auth      Auth
}

type Database struct {
	Driver string // "sqlite" (default) or "postgres" (planned)
	DSN    string
}

// SSH governs what the browser terminal may do to a guest before it
// connects.
type SSH struct {
	// Provision creates the console's account on a guest that doesn't
	// have it yet, through the hypervisor's guest agent. Off means a
	// guest is reachable only once someone installs the key by hand.
	Provision bool
	// ProvisionSudo grants that account passwordless sudo. Deliberately
	// separate and deliberately off: creating a login is implied by
	// clicking Connect, handing out root across the lab is a decision.
	ProvisionSudo bool
}

// Auth seeds the first account. It applies on first run only — after
// that, accounts live in IAM & Admin and these are ignored.
type Auth struct {
	BootstrapEmail string
	// BootstrapPassword, left empty, means one is generated and logged
	// once at startup. Better a password in your terminal scrollback
	// than a default everyone knows.
	BootstrapPassword string
}

// Load reads the environment. Every setting has a working default, so
// running with nothing set is a supported way to start.
func Load() Config {
	cfg := Config{
		Listen:   "127.0.0.1:8080",
		Database: Database{Driver: "sqlite", DSN: "vantric.db"},
		SSH:      SSH{Provision: true},
	}
	overrideStr(&cfg.Listen, "LISTEN")
	overrideStr(&cfg.Database.Driver, "DB_DRIVER")
	overrideStr(&cfg.Database.DSN, "DB_DSN")
	overrideStr(&cfg.SiteURL, "SITE_URL")
	overrideStr(&cfg.StaticDir, "STATIC_DIR")
	overrideBool(&cfg.SSH.Provision, "SSH_PROVISION")
	overrideBool(&cfg.SSH.ProvisionSudo, "SSH_PROVISION_SUDO")
	overrideStr(&cfg.Auth.BootstrapEmail, "AUTH_BOOTSTRAP_EMAIL")
	overrideStr(&cfg.Auth.BootstrapPassword, "AUTH_BOOTSTRAP_PASSWORD")
	return cfg
}

// LegacyDBName is what the SQLite file was called before the rename.
const LegacyDBName = "labcloud.db"

// ResolveSQLite keeps an existing database findable after the file was
// renamed with the app. It returns the path to open and, when it had
// to fall back, the path that was asked for.
//
// This exists because the failure it prevents is invisible. SQLite
// creates a database it can't find, so a deployment whose data is
// still at the old path doesn't error — it comes up clean, with no
// hypervisors, no credentials and no accounts, which reads as "the
// upgrade wiped everything" rather than "it opened the wrong file".
// The image sets the path explicitly, so pulling a new one is exactly
// how somebody meets this.
func ResolveSQLite(driver, dsn string) (path, wanted string) {
	if driver != "sqlite" || dsn == "" {
		return dsn, ""
	}
	if _, err := os.Stat(dsn); err == nil {
		return dsn, ""
	}
	legacy := filepath.Join(filepath.Dir(dsn), LegacyDBName)
	if _, err := os.Stat(legacy); err == nil {
		return legacy, dsn
	}
	// Neither exists: a first run, which should create the new name.
	return dsn, ""
}

// Legacy returns the LCM_* variables still in use, so startup can name
// them rather than silently honouring them forever.
func Legacy() []string {
	var found []string
	for _, name := range settings {
		if _, ok := os.LookupEnv(legacyPrefix + name); ok {
			if _, current := os.LookupEnv(prefix + name); !current {
				found = append(found, legacyPrefix+name)
			}
		}
	}
	return found
}

const (
	prefix       = "VANTRIC_"
	legacyPrefix = "LCM_"
)

var settings = []string{
	"LISTEN", "DB_DRIVER", "DB_DSN", "SITE_URL", "STATIC_DIR",
	"SSH_PROVISION", "SSH_PROVISION_SUDO",
	"AUTH_BOOTSTRAP_EMAIL", "AUTH_BOOTSTRAP_PASSWORD",
}

// lookup reads VANTRIC_<name>, falling back to the LCM_<name> this app
// used before it was renamed. The fallback exists because config is
// environment-only: a deploy that renamed the variables without it
// would start with defaults instead of failing, and the console would
// come up on the wrong address with the wrong database, which is worse
// than not starting at all.
func lookup(name string) (string, bool) {
	if v, ok := os.LookupEnv(prefix + name); ok {
		return v, true
	}
	return os.LookupEnv(legacyPrefix + name)
}

func overrideStr(dst *string, name string) {
	if v, ok := lookup(name); ok {
		*dst = v
	}
}

// overrideBool leaves the default alone for anything it can't read, so
// a typo turns into the documented behaviour rather than a surprise.
func overrideBool(dst *bool, name string) {
	v, _ := lookup(name)
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		*dst = true
	case "0", "false", "no", "off":
		*dst = false
	}
}
