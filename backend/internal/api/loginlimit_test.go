package api

import (
	"testing"
	"time"
)

func TestSignInLimiter(t *testing.T) {
	clock := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	l := newSignInLimiter()
	l.now = func() time.Time { return clock }

	addr, email := "addr:203.0.113.7", "email:someone@example.com"

	// A person mistyping is not an attack.
	for i := 0; i < maxSignInAttempts-1; i++ {
		l.fail(addr, email)
	}
	if locked, _ := l.locked(addr, email); locked {
		t.Fatalf("locked out after %d attempts, before the limit", maxSignInAttempts-1)
	}

	// Getting it right clears the slate.
	l.succeed(addr, email)
	for i := 0; i < maxSignInAttempts-1; i++ {
		l.fail(addr, email)
	}
	if locked, _ := l.locked(addr, email); locked {
		t.Fatal("a successful sign-in didn't reset the count")
	}

	// The limit itself.
	l.fail(addr, email)
	locked, retryIn := l.locked(addr, email)
	if !locked {
		t.Fatalf("not locked out after %d failures", maxSignInAttempts)
	}
	if retryIn <= 0 || retryIn > signInLockout {
		t.Errorf("retryIn %v, want between 0 and %v", retryIn, signInLockout)
	}

	// Hammering a locked endpoint must not extend the lockout, or it
	// never ends and the window stops meaning anything.
	clock = clock.Add(signInLockout - time.Minute)
	for i := 0; i < 50; i++ {
		if locked, _ := l.locked(addr, email); !locked {
			t.Fatal("came unlocked early")
		}
	}
	clock = clock.Add(2 * time.Minute)
	if locked, _ := l.locked(addr, email); locked {
		t.Fatal("still locked out after the lockout elapsed")
	}
}

// The two keys are independent: one address working through a list of
// emails is stopped by the address, and one email attacked from many
// addresses is stopped by the email.
func TestSignInLimiterKeysAreIndependent(t *testing.T) {
	clock := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	l := newSignInLimiter()
	l.now = func() time.Time { return clock }

	for i := 0; i < maxSignInAttempts; i++ {
		l.fail("addr:203.0.113.7", "email:victim@example.com")
	}
	// A different person on a different address is unaffected...
	if locked, _ := l.locked("addr:192.168.80.44", "email:someone@example.com"); locked {
		t.Error("an unrelated sign-in was locked out")
	}
	// ...but the attacked account is shut whoever asks for it.
	if locked, _ := l.locked("addr:192.168.80.44", "email:victim@example.com"); !locked {
		t.Error("the attacked account was reachable from another address")
	}
}

// Failures older than the window don't accumulate forever: someone who
// mistypes twice a month should never meet the lockout.
func TestSignInLimiterForgetsOldFailures(t *testing.T) {
	clock := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	l := newSignInLimiter()
	l.now = func() time.Time { return clock }

	for i := 0; i < maxSignInAttempts-1; i++ {
		l.fail("addr:203.0.113.7")
		clock = clock.Add(signInWindow / 2)
	}
	if locked, _ := l.locked("addr:203.0.113.7"); locked {
		t.Fatal("failures spread far apart added up to a lockout")
	}
	if len(l.keys) > 1 {
		t.Errorf("the limiter kept %d keys for one address", len(l.keys))
	}
}
