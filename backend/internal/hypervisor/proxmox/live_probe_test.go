//go:build livecheck

package proxmox

import (
	"context"
	"os"
	"strings"
	"testing"
)

// Reads a REAL warned task off the lab's Proxmox, to prove TaskStatus
// and TaskLog agree with what its own task viewer shows.
func TestLiveWarnedTask(t *testing.T) {
	base, tok, sec, upid := os.Getenv("PVE_URL"), os.Getenv("PVE_TOKEN"),
		os.Getenv("PVE_SECRET"), os.Getenv("PVE_UPID")
	if base == "" || upid == "" {
		t.Skip("set PVE_URL, PVE_TOKEN, PVE_SECRET, PVE_UPID")
	}
	d := New(Config{BaseURL: base, TokenID: tok, Secret: sec, InsecureSkipVerify: true})
	ctx := context.Background()
	st, err := d.TaskStatus(ctx, upid)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("exit=%q running=%v succeeded=%v warned=%v",
		st.ExitStatus, st.Running, st.Succeeded, st.Warned)
	if !st.Succeeded || !st.Warned {
		t.Errorf("a WARNINGS task should be succeeded AND warned")
	}
	lines, err := d.TaskLog(ctx, upid)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("log has %d lines", len(lines))
	for _, l := range lines {
		t.Log("   ", l)
	}
	if len(lines) == 0 || !strings.Contains(strings.Join(lines, "\n"), "WARN") {
		t.Errorf("expected the warning text in the log")
	}
}
