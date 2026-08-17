package store

import (
	"context"
	"path/filepath"
	"testing"
)

// The create flow and the reconciler race whenever a VM appears on the
// hypervisor before the handler has written its record — the reconciler
// sweeps every two seconds, and a Proxmox clone can take longer than
// that. The reconciler wins by adopting the VM, and the create then
// collided on the name and reported failure over a machine that had in
// fact been built.
//
// This is the recovery: find the adopted record by the VM it points at,
// whatever it ended up being called, and take it over.
func TestClaimAdoptedInstance(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()

	server := &Hypervisor{ID: "srv", Name: "pve", Type: "mock"}
	if err := st.CreateHypervisor(ctx, server); err != nil {
		t.Fatal(err)
	}

	// What adoption writes when Proxmox hasn't named the VM yet: no name
	// worth having, no sizing, and protected, because an adopted guest
	// is one this console didn't create.
	adopted := &Instance{
		ID: "adopted", Name: "vm-101", HypervisorID: "srv", Node: "pve1",
		Status: "RUNNING", DriverID: "101", Protected: true,
	}
	if err := st.CreateInstance(ctx, adopted); err != nil {
		t.Fatal(err)
	}

	found, err := st.GetInstanceByDriverID(ctx, "srv", "101")
	if err != nil {
		t.Fatalf("the create flow couldn't find the adopted record: %v", err)
	}
	if found.ID != "adopted" {
		t.Fatalf("found %q, want the adopted record", found.ID)
	}

	// What the create flow knows and adoption couldn't.
	claim := &Instance{
		ID: found.ID, Name: "web-1", HypervisorID: "srv", Node: "pve1",
		CPUs: 4, MemoryMB: 8192, DiskGB: 40, ImageID: "9000",
		DriverID: "101", NetBridge: "vmbr0", Description: "the real one",
		Protected: false,
	}
	if err := st.ClaimInstance(ctx, claim); err != nil {
		t.Fatal(err)
	}

	got, err := st.GetInstance(ctx, "web-1")
	if err != nil {
		t.Fatalf("claimed record isn't under its proper name: %v", err)
	}
	switch {
	case got.ID != "adopted":
		t.Errorf("claim made a second record (%q) instead of taking the first", got.ID)
	case got.CPUs != 4 || got.MemoryMB != 8192 || got.DiskGB != 40:
		t.Errorf("sizing not applied: %d cpu, %d MB, %d GB", got.CPUs, got.MemoryMB, got.DiskGB)
	case got.ImageID != "9000" || got.NetBridge != "vmbr0" || got.Description != "the real one":
		t.Errorf("create-flow metadata not applied: %+v", got)
	case got.Protected:
		t.Error("kept adoption's protection instead of what was asked for")
	}

	// One VM, one record — the failure mode this replaced was two.
	all, err := st.ListInstances(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 {
		t.Fatalf("%d records for one VM, want 1", len(all))
	}
	if _, err := st.GetInstance(ctx, "vm-101"); err != ErrNotFound {
		t.Error("the adopted name is still resolvable, so the record was duplicated")
	}
}

func testStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}
