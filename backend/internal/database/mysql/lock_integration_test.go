//go:build integration

package mysql

import (
	"context"
	"os"
	"testing"

	"vantric/internal/database"
)

// WHETHER AN ACCOUNT IS LOCKED IS THE ONE FACT THAT FAILS SILENTLY.
//
// lockedAccounts answers by querying whichever of two unrelated places
// this server keeps the flag in, and its failure mode is an EMPTY MAP
// — which reads as "nobody is locked", which is precisely the bug this
// replaced: every account reporting that it can log in, confidently
// and wrongly. A test that never runs against a real server would not
// catch a query that silently stops matching, so this one needs one.
//
// It is build-tagged rather than skipped, so `make check` doesn't
// depend on Docker:
//
//	go test -tags integration ./internal/database/mysql/ \
//	  -args   (VANTRIC_TEST_MYSQL=127.0.0.1:13306)
//
// Point it at each engine in turn — the two families disagree here and
// a driver that works on one proves nothing about the other:
//
//	MySQL 5.7.6+ : mysql.user.account_locked, ENUM('N','Y')
//	MariaDB 10.4+: mysql.global_priv, JSON, key absent when unlocked
func TestLockStateIsReadNotAssumed(t *testing.T) {
	addr := os.Getenv("VANTRIC_TEST_MYSQL")
	if addr == "" {
		t.Skip("set VANTRIC_TEST_MYSQL=host:port")
	}
	host, port := splitAddr(t, addr)
	d, err := New(Config{Host: host, Port: port, Username: "root",
		Password: os.Getenv("VANTRIC_TEST_MYSQL_PASSWORD"), Database: "mysql", SSLMode: "disable"})
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	ctx := context.Background()

	const name, userHost = "vantric_locktest", "%"
	_ = d.DropUser(ctx, name, userHost)
	if err := d.CreateUser(ctx, database.UserSpec{
		Name: name, Host: userHost, Password: "x", CanLogin: true,
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.DropUser(ctx, name, userHost) })

	canLogin := func() bool {
		t.Helper()
		users, err := d.Users(ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, u := range users {
			if u.Name == name {
				return u.CanLogin
			}
		}
		t.Fatalf("%s is missing from the user listing", name)
		return false
	}

	if !canLogin() {
		t.Error("a freshly created account reports that it cannot log in")
	}
	if err := d.SetUserEnabled(ctx, name, userHost, false); err != nil {
		t.Fatal(err)
	}
	if canLogin() {
		// The original bug, exactly.
		t.Error("a LOCKED account still reports that it can log in")
	}
	if err := d.SetUserEnabled(ctx, name, userHost, true); err != nil {
		t.Fatal(err)
	}
	if !canLogin() {
		t.Error("an UNLOCKED account still reports that it cannot log in")
	}

	// The shape has to have been settled by now. lockNone means neither
	// query worked, which on a server that just accepted ACCOUNT LOCK
	// means the read is broken rather than the feature being absent.
	d.mu.Lock()
	shape := d.lock
	d.mu.Unlock()
	if shape == lockNone {
		t.Error("this server locks accounts but neither lock query matched")
	}
	t.Logf("lock shape discovered: %d", shape)
}

func splitAddr(t *testing.T, addr string) (string, int) {
	t.Helper()
	host, portStr, found := cut(addr, ":")
	if !found {
		t.Fatalf("VANTRIC_TEST_MYSQL should be host:port, got %q", addr)
	}
	port := 0
	for _, c := range portStr {
		if c < '0' || c > '9' {
			t.Fatalf("bad port in %q", addr)
		}
		port = port*10 + int(c-'0')
	}
	return host, port
}

func cut(s, sep string) (string, string, bool) {
	for i := 0; i+len(sep) <= len(s); i++ {
		if s[i:i+len(sep)] == sep {
			return s[:i], s[i+len(sep):], true
		}
	}
	return s, "", false
}
