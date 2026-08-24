package api

import (
	"encoding/json"
	"net/http"
	"strings"

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

// deleteDisk removes a volume from the datastore-wide Disks list.
//
// THE STATE IS RE-READ, NOT TRUSTED FROM THE CLIENT. A disk's
// attachment decides both whether it may be deleted and by which call,
// and the page that offered the button may have been looking at a
// ten-second-old list. So the driver is asked again and the answer
// decides — which also means a disk re-attached since the page loaded
// is refused rather than destroyed.
func (s *Server) deleteDisk(w http.ResponseWriter, r *http.Request) {
	hypervisorID := r.URL.Query().Get("hypervisor")
	id := r.URL.Query().Get("id")
	if hypervisorID == "" || id == "" {
		s.err(w, http.StatusBadRequest, "which disk, on which hypervisor?")
		return
	}
	driver, ok := s.registry.Get(hypervisorID)
	if !ok {
		s.err(w, http.StatusNotFound, "no such hypervisor")
		return
	}
	disks, err := driver.Disks(r.Context())
	if err != nil {
		s.fail(w, err, "disks")
		return
	}
	var disk *hypervisor.Disk
	for i := range disks {
		if disks[i].ID == id {
			disk = &disks[i]
			break
		}
	}
	if disk == nil {
		s.err(w, http.StatusNotFound, "that disk is no longer there")
		return
	}

	switch disk.Attachment {
	case hypervisor.DiskAttached:
		// The two-step is the safety, and it is the same refusal the
		// driver makes — said here so the answer names the guest.
		s.err(w, http.StatusConflict,
			"that disk is attached to "+disk.InUseBy+" — detach it there first")

	case hypervisor.DiskDetached:
		manager, ok := driver.(hypervisor.DiskManager)
		if !ok {
			s.err(w, http.StatusNotImplemented, "this hypervisor can't change disks")
			return
		}
		vmid, slot, found := strings.Cut(disk.ID, "/")
		if !found {
			s.err(w, http.StatusBadRequest, "that disk id names no guest")
			return
		}
		if err := manager.DeleteDisk(r.Context(), vmid, slot); err != nil {
			s.fail(w, err, "deleting the disk")
			return
		}

	case hypervisor.DiskOrphaned:
		// No guest to ask, so it goes through the datastore — the same
		// call that removes an ISO.
		taskID, err := driver.DeleteVolume(r.Context(), disk.Node, disk.VolumeID)
		if err != nil {
			s.fail(w, err, "deleting the disk")
			return
		}
		op := s.ops.start("Deleting disk "+disk.Name,
			"disk", disk.Name, hypervisorID, "/compute/disks")
		s.watchOrFinish(op, driver, taskID, "Deleted "+disk.Name)
		s.json(w, http.StatusAccepted, op)
		return

	default:
		s.err(w, http.StatusBadRequest, "that disk is in a state this console doesn't know")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
