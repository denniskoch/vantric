package api

import (
	"testing"

	"vantric/internal/aiaccount"
)

// A warning that never fires is indistinguishable from one that can't,
// which is why this is a test rather than a reading. The thresholds
// are per unit on purpose: five is nearly empty in dollars and nothing
// at all in characters.
func TestLowBalance(t *testing.T) {
	amount := func(v float64) *float64 { return &v }

	cases := []struct {
		name    string
		balance aiaccount.Balance
		want    bool
	}{
		{"dollars, comfortable", aiaccount.Balance{Unit: "USD", Remaining: amount(26.35), Granted: 60}, false},
		{"dollars, nearly out", aiaccount.Balance{Unit: "USD", Remaining: amount(4.99), Granted: 60}, true},
		{"dollars, spent", aiaccount.Balance{Unit: "USD", Remaining: amount(0), Granted: 60}, true},
		// The same number in the other unit must not warn: 4.99
		// characters would be alarming, 40,000 is a full tank.
		{"characters, plenty", aiaccount.Balance{Unit: "characters", Remaining: amount(40000), Granted: 100000}, false},
		{"characters, nearly out", aiaccount.Balance{Unit: "characters", Remaining: amount(9999), Granted: 100000}, true},
		// A unit nobody has written a threshold for says nothing,
		// rather than borrowing one that doesn't apply.
		{"unknown unit stays quiet", aiaccount.Balance{Unit: "tokens", Remaining: amount(1), Granted: 100}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, detail := lowBalance("acct", &tc.balance)
			if got != tc.want {
				t.Fatalf("lowBalance = %v, want %v", got, tc.want)
			}
			if got && detail == "" {
				t.Fatal("a warning with nothing to say is a warning nobody can act on")
			}
		})
	}
}
