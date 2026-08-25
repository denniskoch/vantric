package inventory

import "testing"

// A vulnerable application in the Trash is still on disk and still
// launchable, and the inventory service reports it exactly like an
// installed one. This lab's MacBook had Microsoft Teams there since
// 2021 with six CVEs, one of them in CISA's exploited catalogue, while
// Fleet's own UI showed the machine carrying four applications.
func TestDiscardedRecognisesEveryPlatformsWastebasket(t *testing.T) {
	for _, path := range []string{
		"/Users/dianekoch/.Trash/Microsoft Teams.app",
		"/Volumes/Data/.Trashes/501/old.app",
		"C:/$Recycle.Bin/S-1-5-21-1234/thing.exe",
		"/home/dk/.local/share/Trash/files/thing",
	} {
		if !Discarded(path) {
			t.Errorf("%s was not recognised as discarded", path)
		}
	}
	// And the ordinary places, which must never read as discarded —
	// excusing a live flaw is the worse direction for this to fail.
	for _, path := range []string{
		"/Applications/Google Chrome.app",
		"/usr/local/bin/thing",
		"C:/Program Files/Thing/thing.exe",
		"/Users/dk/Projects/.Trashcan/notreally",
		"",
	} {
		if Discarded(path) {
			t.Errorf("%s was wrongly called discarded", path)
		}
	}
}
