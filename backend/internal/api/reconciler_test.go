package api

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"vantric/internal/hypervisor"
	"vantric/internal/store"
)

// listDriver answers List and nothing else. Embedding the interface
// leaves the rest nil, which is the point: a sweep that reaches for
// anything else here has changed shape and should say so loudly.
type listDriver struct {
	hypervisor.Driver
	states []hypervisor.InstanceState
}

func (d listDriver) List(context.Context) ([]hypervisor.InstanceState, error) {
	return d.states, nil
}

func (d listDriver) Get(_ context.Context, id string) (*hypervisor.InstanceState, error) {
	return &hypervisor.InstanceState{DriverID: id}, nil
}

// A driver.List that FAILS is already handled — the sweep logs and moves
// on. One that SUCCEEDS and returns nothing was not: it read as "every
// VM is gone", and every record for that hypervisor was deleted. Proxmox
// serves cluster/resources from a cache and can answer empty or partial
// when a node loses quorum, so this is a bad afternoon, not a theory:
// the protected flag and the description mirror go with the rows, and
// adoption puts the guests back as new records.
func TestSweepKeepsRecordsWhenTheHypervisorReturnsNothing(t *testing.T) {
	st, ctx := reconcilerStore(t)
	seedInstance(t, st, "web-1", "101")

	r := reconcilerFor(st, listDriver{})
	r.grace = 0 // so only the empty-list guard can save the record
	r.sweep(ctx)

	if !hasInstance(t, st, "web-1") {
		t.Fatal("an empty list deleted the record it should have kept")
	}
}

// The other half: a record whose VM really has gone still goes.
func TestSweepRemovesAGuestThatIsActuallyGone(t *testing.T) {
	st, ctx := reconcilerStore(t)
	seedInstance(t, st, "web-1", "101")
	seedInstance(t, st, "web-2", "102")

	// The hypervisor reports only 101.
	r := reconcilerFor(st, listDriver{states: []hypervisor.InstanceState{
		{DriverID: "101", Name: "web-1", Status: hypervisor.StatusRunning},
	}})
	r.grace = 0 // not what this one is testing
	r.sweep(ctx)

	if hasInstance(t, st, "web-2") {
		t.Fatal("a guest the hypervisor no longer reports was kept")
	}
	if !hasInstance(t, st, "web-1") {
		t.Fatal("a guest the hypervisor still reports was removed")
	}
}

// Creating an instance races this sweep: the handler writes the record
// and the hypervisor may not report the VM for another beat. Without a
// grace period the sweep deletes what the create just wrote.
func TestSweepSparesAFreshlyCreatedRecord(t *testing.T) {
	st, ctx := reconcilerStore(t)
	seedInstance(t, st, "web-1", "101")

	// A successful list that simply doesn't mention it yet. Non-empty,
	// so the empty-list guard above is not what's being tested here.
	r := reconcilerFor(st, listDriver{states: []hypervisor.InstanceState{
		{DriverID: "999", Name: "someone-else", Status: hypervisor.StatusRunning},
	}})
	r.sweep(ctx)

	// Count is the wrong assertion here: the old sweep deleted web-1 AND
	// adopted the VM it didn't recognise, so the total stayed at one
	// while the record under test was gone.
	if !hasInstance(t, st, "web-1") {
		t.Fatal("the sweep deleted a record written seconds ago")
	}
}

// --- helpers ---------------------------------------------------------

func reconcilerStore(t *testing.T) (*store.Store, context.Context) {
	t.Helper()
	st, err := store.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ctx := context.Background()
	if err := st.CreateHypervisor(ctx, &store.Hypervisor{
		ID: "hv", Name: "pve", Type: "mock",
	}); err != nil {
		t.Fatal(err)
	}
	return st, ctx
}

func reconcilerFor(st *store.Store, d hypervisor.Driver) *Reconciler {
	registry := hypervisor.NewRegistry()
	registry.Set("hv", d)
	return NewReconciler(st, registry,
		slog.New(slog.NewTextHandler(io.Discard, nil)), time.Second)
}

func seedInstance(t *testing.T, st *store.Store, name, driverID string) {
	t.Helper()
	inst := &store.Instance{
		ID: name, Name: name, HypervisorID: "hv", Node: "pve1",
		Status: "RUNNING", DriverID: driverID,
	}
	if err := st.CreateInstance(context.Background(), inst); err != nil {
		t.Fatal(err)
	}
}

func hasInstance(t *testing.T, st *store.Store, name string) bool {
	t.Helper()
	instances, err := st.ListInstances(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, inst := range instances {
		if inst.Name == name {
			return true
		}
	}
	return false
}
