package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"vantric/internal/hypervisor"
)

// Changing what an instance IS after it exists: its sizing, and its
// snapshots.
//
// Synchronous for the same reason the disk operations are — the driver
// waits for the hypervisor's task, and the panel that started it has to
// show the result. Editor's work: these change a resource, not a
// credential.

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

func (s *Server) snapshotManagerFor(w http.ResponseWriter, r *http.Request) (hypervisor.SnapshotManager, string, bool) {
	inst, driver := s.instanceDriver(w, r)
	if driver == nil {
		return nil, "", false
	}
	driverID := inst.DriverID
	manager, ok := driver.(hypervisor.SnapshotManager)
	if !ok {
		s.err(w, http.StatusNotImplemented, "this hypervisor doesn't do snapshots")
		return nil, "", false
	}
	return manager, driverID, true
}

func (s *Server) createInstanceSnapshot(w http.ResponseWriter, r *http.Request) {
	manager, driverID, ok := s.snapshotManagerFor(w, r)
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
	if err := manager.CreateSnapshot(r.Context(), driverID, req.Name, req.Description); err != nil {
		s.fail(w, err, "taking the snapshot")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) rollbackInstanceSnapshot(w http.ResponseWriter, r *http.Request) {
	manager, driverID, ok := s.snapshotManagerFor(w, r)
	if !ok {
		return
	}
	if err := manager.RollbackSnapshot(r.Context(), driverID, chi.URLParam(r, "snapshot")); err != nil {
		s.fail(w, err, "rolling back")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteInstanceSnapshot(w http.ResponseWriter, r *http.Request) {
	manager, driverID, ok := s.snapshotManagerFor(w, r)
	if !ok {
		return
	}
	if err := manager.DeleteSnapshot(r.Context(), driverID, chi.URLParam(r, "snapshot")); err != nil {
		s.fail(w, err, "deleting the snapshot")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
