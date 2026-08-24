package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"vantric/internal/hypervisor"
)

// Restoring a backup. Listing and deleting archives live in catalog.go
// with the rest of the datastore catalog; this is the one thing done TO
// an archive rather than with the list of them.

// restoreBackup turns an archive back into a guest.
//
// TWO ANSWERS, AND NEITHER MENTIONS A GUEST ID. Restore as a new guest,
// which needs a name, or replace the one the backup came from, which
// does not. Every other page in this console names guests rather than
// numbering them — a vmid is an artefact of the hypervisor, the way a
// machine type was an artefact of GCP — so the free id is worked out
// here instead of typed there.
//
// THE NAME IS NOT COSMETIC. A restore alongside a guest that still
// exists would otherwise produce two of them answering to one name, and
// this console's instance names are unique; the reconciler would adopt
// one and fail on the other.
//
// REPLACING IS THE DESTRUCTIVE ONE. Proxmox deletes the guest and its
// disks before it unpacks, so it is refused while that guest is
// running — the same rule instance deletion follows.
//
// IT IS AN OPERATION: unpacking tens of gigabytes takes as long as it
// takes, so this validates, starts it, and answers with something the
// bell can follow.
func (s *Server) restoreBackup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		HypervisorID string `json:"hypervisorId"`
		VolumeID     string `json:"volumeId"`
		// Mode is "new" or "replace".
		Mode    string `json:"mode"`
		Name    string `json:"name"`
		Storage string `json:"storage"`
		Start   bool   `json:"start"`
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

	// THE ARCHIVE IS READ, NOT DESCRIBED BY THE CALLER. Which node it
	// is on, which guest it came from and whether that guest was a VM
	// or a container are all facts about the file — trusting a client
	// for them means a mistyped guest type silently builds an empty
	// container named after your backup.
	catalog, ok := driver.(hypervisor.BackupDriver)
	if !ok {
		s.err(w, http.StatusNotImplemented, "this hypervisor keeps no backup catalog")
		return
	}
	archives, err := catalog.Backups(r.Context())
	if err != nil {
		s.fail(w, err, "the backup catalog")
		return
	}
	var archive *hypervisor.Backup
	for i := range archives {
		if archives[i].ID == in.VolumeID {
			archive = &archives[i]
			break
		}
	}
	if archive == nil {
		s.err(w, http.StatusNotFound, "that archive is no longer there")
		return
	}

	spec := hypervisor.RestoreSpec{
		Node: archive.Node, VolumeID: archive.ID, GuestType: archive.GuestType,
		Storage: in.Storage, Start: in.Start,
	}
	existing, _ := s.store.GetInstanceByDriverID(r.Context(),
		in.HypervisorID, strconv.Itoa(archive.VMID))

	switch in.Mode {
	case "replace":
		if existing == nil {
			s.err(w, http.StatusConflict,
				"there is no guest to replace — restore it as a new one")
			return
		}
		if existing.Status == string(hypervisor.StatusRunning) ||
			existing.Status == string(hypervisor.StatusStaging) {
			s.err(w, http.StatusConflict,
				existing.Name+" is running. Stop it first.")
			return
		}
		spec.VMID = archive.VMID
		spec.Overwrite = true
		// No name: replacing keeps the guest's own.

	case "new", "":
		spec.Name = strings.TrimSpace(in.Name)
		if spec.Name == "" {
			s.err(w, http.StatusBadRequest, "a name is required")
			return
		}
		if taken, _ := s.store.GetInstance(r.Context(), spec.Name); taken != nil {
			s.err(w, http.StatusConflict, spec.Name+" is already taken")
			return
		}
		id, err := restorer.NextVMID(r.Context())
		if err != nil {
			s.fail(w, err, "a free guest id")
			return
		}
		spec.VMID = id

	default:
		s.err(w, http.StatusBadRequest, "restore as a new guest, or replace the original")
		return
	}

	taskID, err := restorer.RestoreBackup(r.Context(), spec)
	if err != nil {
		s.fail(w, err, "restoring the backup")
		return
	}
	label := spec.Name
	if label == "" && existing != nil {
		label = existing.Name
	}
	op := s.ops.start("Restoring "+label,
		"instance", label, in.HypervisorID, "/compute/instances")
	s.watchOrFinish(op, driver, taskID, "Restored "+label)
	s.json(w, http.StatusAccepted, op)
}
