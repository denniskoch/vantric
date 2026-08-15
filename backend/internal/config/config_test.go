package config

import "testing"

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
