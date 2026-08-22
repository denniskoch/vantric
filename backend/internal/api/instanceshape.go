package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"vantric/internal/hypervisor"
	"vantric/internal/store"
)

// Changing what an instance IS after it exists: its sizing, and its
// snapshots.
//
// Resizing is synchronous for the same reason the disk operations are —
// it is a config write, and the panel that started it has to show the
// result. SNAPSHOTS ARE NOT: taking one on a running guest writes its
// RAM out to disk, and rolling back reads it in again, which is minutes
// on a machine with any memory to speak of. That is work outliving its
// request, so it reports in the bell like a clone does. Editor's work
// either way: these change a resource, not a credential.

func (s *Server) resizeInstance(w http.ResponseWriter, r *http.Request) {
	inst, driver := s.instanceDriver(w, r)
	if driver == nil {
		return
	}
	resizer, ok := driver.(hypervisor.InstanceResizer)
	if !ok {
		s.err(w, http.StatusNotImplemented, "this hypervisor can't resize an instance after it's created")
		return
	}
	var req struct {
		CPUs     int `json:"cpus"`
		MemoryMB int `json:"memoryMb"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.CPUs < 1 {
		s.err(w, http.StatusBadRequest, "an instance needs at least one vCPU")
		return
	}
	if req.MemoryMB < 128 {
		s.err(w, http.StatusBadRequest, "an instance needs at least 128 MB of memory")
		return
	}
	if err := resizer.ResizeInstance(r.Context(), inst.DriverID, req.CPUs, req.MemoryMB); err != nil {
		s.fail(w, err, "resizing the instance")
		return
	}
	// Nothing is written to the store here on purpose. syncShape already
	// reconciles name and sizing from the hypervisor on every sweep, so
	// a mirror write would be a second implementation of the same rule,
	// two seconds earlier and free to disagree.
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) snapshotManagerFor(w http.ResponseWriter, r *http.Request) (hypervisor.SnapshotManager, *store.Instance, bool) {
	inst, driver := s.instanceDriver(w, r)
	if driver == nil {
		return nil, nil, false
	}
	manager, ok := driver.(hypervisor.SnapshotManager)
	if !ok {
		s.err(w, http.StatusNotImplemented, "this hypervisor doesn't do snapshots")
		return nil, nil, false
	}
	return manager, inst, true
}

// snapshotOperation is the bell entry these three share: same resource,
// same place to click through to, differing only in what they say.
func (s *Server) snapshotOperation(inst *store.Instance, title string) *Operation {
	return s.ops.start(title, "snapshot", inst.Name, inst.HypervisorID,
		"/compute/instances/"+inst.Name)
}

func (s *Server) createInstanceSnapshot(w http.ResponseWriter, r *http.Request) {
	manager, inst, ok := s.snapshotManagerFor(w, r)
	if !ok {
		return
	}
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	// Proxmox's own rule for a snapshot name, and stricter than nameRe
	// only in allowing capitals — which people use, and which nothing
	// downstream minds.
	if !snapshotNameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest,
			"a snapshot name is letters, digits, hyphens and underscores, starting with a letter")
		return
	}
	op := s.snapshotOperation(inst, "Taking snapshot "+req.Name+" of "+inst.Name)
	driverID, name, description := inst.DriverID, req.Name, req.Description
	s.run(op, "Snapshot taken", func(ctx context.Context, step func(string)) error {
		return manager.CreateSnapshot(ctx, driverID, name, description)
	})
	s.json(w, http.StatusAccepted, op)
}

func (s *Server) rollbackInstanceSnapshot(w http.ResponseWriter, r *http.Request) {
	manager, inst, ok := s.snapshotManagerFor(w, r)
	if !ok {
		return
	}
	snapshot, driverID := chi.URLParam(r, "snapshot"), inst.DriverID
	op := s.snapshotOperation(inst, "Rolling "+inst.Name+" back to "+snapshot)
	s.run(op, "Rolled back", func(ctx context.Context, step func(string)) error {
		return manager.RollbackSnapshot(ctx, driverID, snapshot)
	})
	s.json(w, http.StatusAccepted, op)
}

func (s *Server) deleteInstanceSnapshot(w http.ResponseWriter, r *http.Request) {
	manager, inst, ok := s.snapshotManagerFor(w, r)
	if !ok {
		return
	}
	snapshot, driverID := chi.URLParam(r, "snapshot"), inst.DriverID
	op := s.snapshotOperation(inst, "Deleting snapshot "+snapshot+" of "+inst.Name)
	s.run(op, "Snapshot deleted", func(ctx context.Context, step func(string)) error {
		return manager.DeleteSnapshot(ctx, driverID, snapshot)
	})
	s.json(w, http.StatusAccepted, op)
}
