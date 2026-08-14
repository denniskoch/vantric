// Package config is the app's own settings, read from LCM_* environment
// variables.
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
	"strings"
)

type Config struct {
	// Listen is the address the API serves on.
	Listen   string
	Database Database
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
		Database: Database{Driver: "sqlite", DSN: "labcloud.db"},
		SSH:      SSH{Provision: true},
	}
	overrideStr(&cfg.Listen, "LCM_LISTEN")
	overrideStr(&cfg.Database.Driver, "LCM_DB_DRIVER")
	overrideStr(&cfg.Database.DSN, "LCM_DB_DSN")
	overrideStr(&cfg.StaticDir, "LCM_STATIC_DIR")
	overrideBool(&cfg.SSH.Provision, "LCM_SSH_PROVISION")
	overrideBool(&cfg.SSH.ProvisionSudo, "LCM_SSH_PROVISION_SUDO")
	overrideStr(&cfg.Auth.BootstrapEmail, "LCM_AUTH_BOOTSTRAP_EMAIL")
	overrideStr(&cfg.Auth.BootstrapPassword, "LCM_AUTH_BOOTSTRAP_PASSWORD")
	return cfg
}

func overrideStr(dst *string, key string) {
	if v, ok := os.LookupEnv(key); ok {
		*dst = v
	}
}

// overrideBool leaves the default alone for anything it can't read, so
// a typo turns into the documented behaviour rather than a surprise.
func overrideBool(dst *bool, key string) {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		*dst = true
	case "0", "false", "no", "off":
		*dst = false
	}
}
