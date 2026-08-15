package config

import (
	"os"
	"path/filepath"
	"testing"
)

// The app was called lab-cloud-manager, and its variables LCM_*, until
// it was renamed. These pin the transition, because every way it can
// break is silent: config is environment-only and every setting has a
// working default, so a fallback that stopped working wouldn't fail to
// start — it would come up on the wrong address with the wrong
// database and no error anywhere.

func TestLegacyNamesStillRead(t *testing.T) {
	t.Setenv("LCM_SITE_URL", "https://old.example.com")
	t.Setenv("LCM_LISTEN", "127.0.0.1:9999")

	cfg := Load()
	if cfg.SiteURL != "https://old.example.com" {
		t.Errorf("SiteURL = %q, want the LCM_ value", cfg.SiteURL)
	}
	if cfg.Listen != "127.0.0.1:9999" {
		t.Errorf("Listen = %q, want the LCM_ value", cfg.Listen)
	}
	if got := Legacy(); len(got) != 2 {
		t.Errorf("Legacy() = %v, want both names so startup can warn", got)
	}
}

func TestCurrentNameWins(t *testing.T) {
	t.Setenv("LCM_SITE_URL", "https://old.example.com")
	t.Setenv("VANTRIC_SITE_URL", "https://new.example.com")

	if cfg := Load(); cfg.SiteURL != "https://new.example.com" {
		t.Errorf("SiteURL = %q, want VANTRIC_ to win", cfg.SiteURL)
	}
	// Already migrated, so there's nothing to warn about.
	if got := Legacy(); len(got) != 0 {
		t.Errorf("Legacy() = %v, want empty once the new name is set", got)
	}
}

// Booleans take a separate path through lookup, and a missed fallback
// there would silently turn a feature off rather than mis-set a string.
func TestLegacyBool(t *testing.T) {
	t.Setenv("LCM_SSH_PROVISION_SUDO", "true")
	if !Load().SSH.ProvisionSudo {
		t.Error("ProvisionSudo = false, want the LCM_ value honoured")
	}
}

// The database was renamed with the app. SQLite CREATES a file it
// can't find, so getting this wrong doesn't error — it silently opens
// an empty database, and the console comes up with no hypervisors, no
// credentials and no accounts.
func TestResolveSQLite(t *testing.T) {
	dir := t.TempDir()
	current := filepath.Join(dir, "vantric.db")
	legacy := filepath.Join(dir, LegacyDBName)

	t.Run("falls back to the pre-rename file", func(t *testing.T) {
		if err := os.WriteFile(legacy, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		defer os.Remove(legacy)

		got, wanted := ResolveSQLite("sqlite", current)
		if got != legacy {
			t.Errorf("opened %q, want the existing %q", got, legacy)
		}
		if wanted != current {
			t.Errorf("wanted = %q, want %q so startup can say what to rename", wanted, current)
		}
	})

	t.Run("prefers the current name when both exist", func(t *testing.T) {
		for _, p := range []string{current, legacy} {
			if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
				t.Fatal(err)
			}
			defer os.Remove(p)
		}
		if got, wanted := ResolveSQLite("sqlite", current); got != current || wanted != "" {
			t.Errorf("ResolveSQLite = (%q, %q), want the current name and no warning", got, wanted)
		}
	})

	t.Run("first run creates the current name", func(t *testing.T) {
		if got, wanted := ResolveSQLite("sqlite", current); got != current || wanted != "" {
			t.Errorf("ResolveSQLite = (%q, %q), want the current name on an empty directory", got, wanted)
		}
	})

	// Postgres DSNs are connection strings, not paths — stat would be
	// meaningless and the fallback must not touch them.
	t.Run("leaves other drivers alone", func(t *testing.T) {
		dsn := "postgres://user@host/db"
		if got, wanted := ResolveSQLite("postgres", dsn); got != dsn || wanted != "" {
			t.Errorf("ResolveSQLite = (%q, %q), want the DSN untouched", got, wanted)
		}
	})
}
