// Package config loads server configuration from a YAML file with
// environment-variable overrides (LCM_* prefix).
package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Listen   string   `yaml:"listen"`
	Database Database `yaml:"database"`
	Driver   string   `yaml:"driver"` // "mock" or "proxmox"
	Proxmox  Proxmox  `yaml:"proxmox"`
	// StaticDir, when set, serves the built frontend from this directory
	// (with SPA fallback). Empty in development, where Vite serves the UI.
	StaticDir string `yaml:"staticDir"`
}

type Database struct {
	Driver string `yaml:"driver"` // "sqlite" (default) or "postgres" (planned)
	DSN    string `yaml:"dsn"`
}

type Proxmox struct {
	BaseURL            string `yaml:"baseUrl"`
	TokenID            string `yaml:"tokenId"`
	Secret             string `yaml:"secret"`
	InsecureSkipVerify bool   `yaml:"insecureSkipVerify"`
}

func defaults() Config {
	return Config{
		Listen:   "127.0.0.1:8080",
		Database: Database{Driver: "sqlite", DSN: "labcloud.db"},
		Driver:   "mock",
	}
}

// Load reads path (optional; "" skips the file), then applies env overrides.
func Load(path string) (Config, error) {
	cfg := defaults()
	if path != "" {
		raw, err := os.ReadFile(path)
		if err != nil {
			return cfg, fmt.Errorf("config: reading %s: %w", path, err)
		}
		if err := yaml.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("config: parsing %s: %w", path, err)
		}
	}
	overrideStr(&cfg.Listen, "LCM_LISTEN")
	overrideStr(&cfg.Database.Driver, "LCM_DB_DRIVER")
	overrideStr(&cfg.Database.DSN, "LCM_DB_DSN")
	overrideStr(&cfg.Driver, "LCM_DRIVER")
	overrideStr(&cfg.Proxmox.BaseURL, "LCM_PROXMOX_URL")
	overrideStr(&cfg.Proxmox.TokenID, "LCM_PROXMOX_TOKEN_ID")
	overrideStr(&cfg.Proxmox.Secret, "LCM_PROXMOX_SECRET")
	overrideStr(&cfg.StaticDir, "LCM_STATIC_DIR")
	return cfg, nil
}

func overrideStr(dst *string, key string) {
	if v, ok := os.LookupEnv(key); ok {
		*dst = v
	}
}
