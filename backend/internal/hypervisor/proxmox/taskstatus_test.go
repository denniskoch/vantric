package proxmox

import "testing"

// A TASK THAT WARNS HAS SUCCEEDED.
//
// Proxmox ends a task with one of three things, and the console read it
// as two: "OK", "WARNINGS: N", or the reason it failed. Treating
// anything but "OK" as a failure put a red error in the notification
// bell against a VM that had started perfectly — the console
// contradicting the hypervisor about something the hypervisor is
// authoritative on, and worse, spending the colour that means "drop
// what you are doing" on a note about certificate enrolment.
//
// The parse is three lines and the bug was one word, which is exactly
// the kind of thing a test holds still.
func TestExitStatusHasThreeOutcomes(t *testing.T) {
	cases := []struct {
		name      string
		status    string
		exit      string
		running   bool
		succeeded bool
		warned    bool
	}{
		{"still going", "running", "", true, false, false},
		{"clean", "stopped", "OK", false, true, false},
		{
			// The one this test exists for: a real Proxmox start task
			// that warned about UEFI 2023 certificates and started the
			// VM anyway.
			name: "finished with warnings", status: "stopped", exit: "WARNINGS: 1",
			succeeded: true, warned: true,
		},
		{"several warnings", "stopped", "WARNINGS: 3", false, true, true},
		{"a real failure", "stopped", "VM 1001 already running", false, false, false},
		{
			// An interrupted task reports no exit status at all, which is
			// not a success — and must not be read as one just because it
			// isn't a warning either.
			name: "stopped saying nothing", status: "stopped", exit: "",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := taskOutcome(c.status, c.exit)
			if got.Running != c.running {
				t.Errorf("Running = %v, want %v", got.Running, c.running)
			}
			if got.Succeeded != c.succeeded {
				t.Errorf("Succeeded = %v, want %v", got.Succeeded, c.succeeded)
			}
			if got.Warned != c.warned {
				t.Errorf("Warned = %v, want %v", got.Warned, c.warned)
			}
		})
	}
}
