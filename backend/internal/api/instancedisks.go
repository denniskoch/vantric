package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"vantric/internal/hypervisor"
)

// Disks on an instance that already exists.
//
// SYNCHRONOUS, unlike a create. The rule here is that work outliving its
// request becomes an operation and reports in the bell — a clone or an
// ISO download can run for minutes and nothing on the page can help. A
// disk change is seconds, and the panel you started it from has to show
// the result, which is the same reason deleting an instance stayed
// synchronous. The driver waits for the hypervisor's task before
// answering, so "done" means done rather than accepted.
//
// Editor's work, not an owner's: this changes a resource, not a
// credential.

// diskManagerFor resolves the instance and its driver's disk capability.
func (s *Server) diskManagerFor(w http.ResponseWriter, r *http.Request) (hypervisor.DiskManager, string, bool) {
	inst, err := s.store.GetInstance(r.Context(), chi.URLParam(r, "instance"))
	if err != nil {
		s.fail(w, err, "instance")
		return nil, "", false
	}
	driver, ok := s.registry.Get(inst.HypervisorID)
	if !ok {
		s.err(w, http.StatusConflict, "the hypervisor backing this instance is no longer registered")
		return nil, "", false
	}
	manager, ok := driver.(hypervisor.DiskManager)
	if !ok {
		// A capability the backend doesn't have is a 501, not a 500:
		// nothing went wrong, this backend just doesn't do it.
		s.err(w, http.StatusNotImplemented, "this hypervisor can't change disks after an instance is created")
		return nil, "", false
	}
	return manager, inst.DriverID, true
}

func (s *Server) addInstanceDisk(w http.ResponseWriter, r *http.Request) {
	manager, driverID, ok := s.diskManagerFor(w, r)
	if !ok {
		return
	}
	var req struct {
		Storage string `json:"storage"`
		SizeGB  int    `json:"sizeGb"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if msg := placementError("", req.Storage); msg != "" {
		s.err(w, http.StatusBadRequest, msg)
		return
	}
	if req.Storage == "" {
		s.err(w, http.StatusBadRequest, "a storage pool is required")
		return
	}
	if req.SizeGB < 1 {
		s.err(w, http.StatusBadRequest, "a disk needs at least 1 GB")
		return
	}
	disk, err := manager.AddDisk(r.Context(), driverID,
		hypervisor.DiskSpec{Storage: req.Storage, SizeGB: req.SizeGB})
	if err != nil {
		s.fail(w, err, "adding a disk")
		return
	}
	s.json(w, http.StatusOK, map[string]string{"disk": disk})
}

func (s *Server) resizeInstanceDisk(w http.ResponseWriter, r *http.Request) {
	manager, driverID, ok := s.diskManagerFor(w, r)
	if !ok {
		return
	}
	var req struct {
		SizeGB int `json:"sizeGb"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.SizeGB < 1 {
		s.err(w, http.StatusBadRequest, "a disk needs at least 1 GB")
		return
	}
	if err := manager.ResizeDisk(r.Context(), driverID, chi.URLParam(r, "disk"), req.SizeGB); err != nil {
		s.fail(w, err, "resizing the disk")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) attachInstanceDisk(w http.ResponseWriter, r *http.Request) {
	manager, driverID, ok := s.diskManagerFor(w, r)
	if !ok {
		return
	}
	disk, err := manager.AttachDisk(r.Context(), driverID, chi.URLParam(r, "disk"))
	if err != nil {
		s.fail(w, err, "attaching the disk")
		return
	}
	s.json(w, http.StatusOK, map[string]string{"disk": disk})
}

func (s *Server) detachInstanceDisk(w http.ResponseWriter, r *http.Request) {
	manager, driverID, ok := s.diskManagerFor(w, r)
	if !ok {
		return
	}
	if err := manager.DetachDisk(r.Context(), driverID, chi.URLParam(r, "disk")); err != nil {
		s.fail(w, err, "detaching the disk")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteInstanceDisk(w http.ResponseWriter, r *http.Request) {
	manager, driverID, ok := s.diskManagerFor(w, r)
	if !ok {
		return
	}
	if err := manager.DeleteDisk(r.Context(), driverID, chi.URLParam(r, "disk")); err != nil {
		s.fail(w, err, "deleting the disk")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
