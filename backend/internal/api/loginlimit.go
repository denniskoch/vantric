package api

import (
	"sync"
	"time"
)

// Sign-in has a ceiling.
//
// bcrypt at cost 10 is 60–100ms, which caps a single-threaded attacker
// at ten or fifteen guesses a second and is genuinely most of the
// defence here. It is not all of it: this console is designed to be
// published through a Cloudflare Tunnel, and the compose file's own
// advice to put an Access policy in front of it is advice, not
// enforcement. A deployment without one should still survive.
//
// Two keys, and the difference matters. The ADDRESS key is the real
// limit — one source cannot work through a password list. The EMAIL key
// catches the same list arriving from many addresses, and is the reason
// the lockout is minutes rather than hours: an attacker who knows your
// address can otherwise lock you out of your own console by failing on
// purpose, and a long lockout would turn this into the denial of
// service it exists to prevent.
//
// Held in memory on purpose. A restart forgets, which is honest for
// something measured in minutes, and it keeps a write off the path that
// an attacker is by definition hammering.
const (
	// Attempts allowed per key before the lockout, and the window they
	// have to arrive in. Ten is far above a person mistyping and far
	// below anything that could be called a search.
	maxSignInAttempts = 10
	signInWindow      = 15 * time.Minute
	signInLockout     = 15 * time.Minute
)

type signInAttempts struct {
	count int
	first time.Time
	until time.Time // set once locked
}

type signInLimiter struct {
	mu   sync.Mutex
	keys map[string]*signInAttempts
	// now is time.Now except in tests.
	now func() time.Time
}

func newSignInLimiter() *signInLimiter {
	return &signInLimiter{keys: map[string]*signInAttempts{}, now: time.Now}
}

// locked reports whether any of these keys is currently shut, and for
// how much longer. Checking does not count as an attempt: a locked-out
// caller hammering the endpoint must not extend their own lockout
// forever, or the window stops meaning anything.
func (l *signInLimiter) locked(keys ...string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.prune(now)
	for _, key := range keys {
		if a := l.keys[key]; a != nil && now.Before(a.until) {
			return true, a.until.Sub(now)
		}
	}
	return false, 0
}

// fail records one failure against every key, and locks those that have
// run out of attempts.
func (l *signInLimiter) fail(keys ...string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.prune(now)
	for _, key := range keys {
		a := l.keys[key]
		if a == nil || now.Sub(a.first) > signInWindow {
			a = &signInAttempts{first: now}
			l.keys[key] = a
		}
		a.count++
		if a.count >= maxSignInAttempts {
			a.until = now.Add(signInLockout)
		}
	}
}

// succeed clears the keys, so a person who mistyped four times and then
// got it right starts from zero.
func (l *signInLimiter) succeed(keys ...string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, key := range keys {
		delete(l.keys, key)
	}
}

// prune drops keys that have gone quiet. Called under the lock on every
// operation, which is enough for a map that only grows one entry per
// distinct address or email.
func (l *signInLimiter) prune(now time.Time) {
	for key, a := range l.keys {
		if now.After(a.until) && now.Sub(a.first) > signInWindow {
			delete(l.keys, key)
		}
	}
}
