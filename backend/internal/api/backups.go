package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"vantric/internal/hypervisor"
)

// Restoring a backup. Listing and deleting archives live in catalog.go
// with the rest of the datastore catalog; this is the one thing done TO
// an archive rather than with the list of them.

// restoreBackup turns an archive back into a guest.
//
// THE SAFE ANSWER IS THE DEFAULT. A restore beside the original, at a
// free vmid, cannot lose anything and is what you want most of the
// time — checking what was in a backup, or bringing back a guest
// somebody removed. Overwriting the guest that is there now is the
// other thing entirely: Proxmox deletes it and its disks before it
// unpacks, so it is off unless explicitly asked for, and the UI makes
// you type the name.
//
// IT IS AN OPERATION. Unpacking tens of gigabytes takes as long as it
// takes, so the handler validates, starts it, and answers with
// something the bell can follow.
func (s *Server) restoreBackup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		HypervisorID string `json:"hypervisorId"`
		Node         string `json:"node"`
		VolumeID     string `json:"volumeId"`
		GuestType    string `json:"guestType"`
		VMID         int    `json:"vmid"`
		Storage      string `json:"storage"`
		Overwrite    bool   `json:"overwrite"`
		Start        bool   `json:"start"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a restore")
		return
	}
	driver, ok := s.registry.Get(in.HypervisorID)
	if !ok {
		s.err(w, http.StatusNotFound, "no such hypervisor")
		return
	}
	restorer, ok := driver.(hypervisor.BackupRestorer)
	if !ok {
		s.err(w, http.StatusNotImplemented, "this hypervisor can't restore from here")
		return
	}
	if in.VolumeID == "" || in.Node == "" {
		s.err(w, http.StatusBadRequest, "which archive, on which node?")
		return
	}
	if in.VMID <= 0 {
		s.err(w, http.StatusBadRequest, "a restore needs a guest id to restore as")
		return
	}

	// THE CONSOLE'S OWN GUARD, not the hypervisor's. Proxmox refuses a
	// vmid in use unless force is set — but it would happily accept
	// force against a RUNNING guest and delete it mid-flight. Requiring
	// it to be stopped is the same rule instance deletion follows, and
	// for the same reason: destroying disks under a running machine is
	// a decision that should be made twice.
	if existing, err := s.store.GetInstanceByDriverID(r.Context(),
		in.HypervisorID, strconv.Itoa(in.VMID)); err == nil && existing != nil {
		if !in.Overwrite {
			s.err(w, http.StatusConflict,
				fmt.Sprintf("%d is already %s — pick a free id, or choose to replace it",
					in.VMID, existing.Name))
			return
		}
		if existing.Status == string(hypervisor.StatusRunning) ||
			existing.Status == string(hypervisor.StatusStaging) {
			s.err(w, http.StatusConflict,
				fmt.Sprintf("%s is running — stop it before restoring over it", existing.Name))
			return
		}
	}

	taskID, err := restorer.RestoreBackup(r.Context(), hypervisor.RestoreSpec{
		Node: in.Node, VolumeID: in.VolumeID, GuestType: in.GuestType,
		VMID: in.VMID, Storage: in.Storage, Overwrite: in.Overwrite, Start: in.Start,
	})
	if err != nil {
		s.fail(w, err, "restoring the backup")
		return
	}
	op := s.ops.start(fmt.Sprintf("Restoring %d from backup", in.VMID),
		"instance", strconv.Itoa(in.VMID), in.HypervisorID, "/compute/instances")
	s.watchOrFinish(op, driver, taskID, fmt.Sprintf("Restored %d", in.VMID))
	s.json(w, http.StatusAccepted, op)
}

// nextVMID offers the free guest id a restore defaults to.
func (s *Server) nextVMID(w http.ResponseWriter, r *http.Request) {
	driver, ok := s.registry.Get(r.URL.Query().Get("hypervisor"))
	if !ok {
		s.err(w, http.StatusNotFound, "no such hypervisor")
		return
	}
	restorer, ok := driver.(hypervisor.BackupRestorer)
	if !ok {
		s.err(w, http.StatusNotImplemented, "this hypervisor doesn't hand out guest ids")
		return
	}
	id, err := restorer.NextVMID(r.Context())
	if err != nil {
		s.fail(w, err, "a free guest id")
		return
	}
	s.json(w, http.StatusOK, map[string]int{"vmid": id})
}
