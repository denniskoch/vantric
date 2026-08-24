package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"time"

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

	// A CONTAINER HAS TO BE TOLD WHERE TO GO. Omitting storage on a VM
	// restore puts the disks back where the archive's config says; a
	// container restore defaults to `local` instead, and on a host
	// whose `local` holds no container directories that fails at
	// Proxmox with a message about directories rather than about the
	// field nobody filled in.
	if archive.GuestType == "lxc" && in.Storage == "" {
		s.err(w, http.StatusBadRequest, "a container restore needs a storage pool")
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
		// BOTH TABLES. A container and a VM are separate records here,
		// and checking only instances let an LXC restore straight past
		// this into a duplicate — which the hypervisor happily accepts
		// and the reconciler then trips over.
		if taken, _ := s.store.GetInstance(r.Context(), spec.Name); taken != nil {
			s.err(w, http.StatusConflict, spec.Name+" is already taken")
			return
		}
		if taken, _ := s.store.GetContainer(r.Context(), spec.Name); taken != nil {
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
	// Watched here rather than through watchOrFinish, because a restore
	// has something to do once the task lands — see claimRestored.
	hypervisorID, vmid, guestType := in.HypervisorID, spec.VMID, spec.GuestType
	s.run(op, "Restored "+label, func(ctx context.Context, _ func(string)) error {
		if err := awaitTask(ctx, driver, taskID); err != nil {
			return err
		}
		s.claimRestored(ctx, hypervisorID, vmid, guestType)
		return nil
	})
	s.json(w, http.StatusAccepted, op)
}

// claimRestored takes deletion protection back off a guest this console
// just restored.
//
// THE RECONCILER GETS THERE FIRST, and it is right to: a guest that
// appears on a hypervisor without this console creating it is adopted,
// and adopted guests are protected so that a record the console never
// meant to own cannot be deleted by accident. A restore is the one case
// where that reads wrong — you asked for this guest, deliberately, and
// it arrives locked. Creating an instance has the same race and solves
// it the same way, with ClaimInstance.
//
// BEST EFFORT AND QUIET. The restore succeeded either way; if the
// record has not appeared within a few sweeps, or the update fails, the
// guest is simply protected — which is a click to undo and not worth
// failing a completed operation over.
func (s *Server) claimRestored(ctx context.Context, hypervisorID string, vmid int, guestType string) {
	id := strconv.Itoa(vmid)
	for attempt := 0; attempt < 15; attempt++ {
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
		if guestType == "lxc" {
			if ct, err := s.store.GetContainerByDriverID(ctx, hypervisorID, id); err == nil && ct != nil {
				if ct.Protected {
					_ = s.store.SetContainerProtection(ctx, ct.ID, false)
				}
				return
			}
			continue
		}
		if inst, err := s.store.GetInstanceByDriverID(ctx, hypervisorID, id); err == nil && inst != nil {
			if inst.Protected {
				_ = s.store.SetInstanceProtection(ctx, inst.ID, false)
			}
			return
		}
	}
}

// takeBackup writes one archive now, for the guest named in the path.
//
// AD-HOC BACKUPS ARE WHY A SCHEDULE IS NOT ENOUGH. The nightly job runs
// at 21:00; the moment you want a restore point is the ten minutes
// before you upgrade something. Same vzdump, same archive, same list —
// it is only the trigger that differs.
func (s *Server) takeBackup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Storage   string `json:"storage"`
		Mode      string `json:"mode"`
		Notes     string `json:"notes"`
		Protected bool   `json:"protected"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a backup")
		return
	}
	if strings.TrimSpace(in.Storage) == "" {
		s.err(w, http.StatusBadRequest, "pick somewhere to write it")
		return
	}

	name := chi.URLParam(r, "instance")
	guestType := "qemu"
	var hypervisorID, node, driverID string
	if inst, err := s.store.GetInstance(r.Context(), name); err == nil && inst != nil {
		hypervisorID, node, driverID = inst.HypervisorID, inst.Node, inst.DriverID
	} else if ct, err := s.store.GetContainer(r.Context(), chi.URLParam(r, "container")); err == nil && ct != nil {
		hypervisorID, node, driverID, guestType = ct.HypervisorID, ct.Node, ct.DriverID, "lxc"
		name = ct.Name
	} else {
		s.err(w, http.StatusNotFound, "no such guest")
		return
	}
	_ = guestType // vzdump takes a vmid; which kind it is, it works out itself.

	driver, ok := s.registry.Get(hypervisorID)
	if !ok {
		s.err(w, http.StatusNotFound, "no such hypervisor")
		return
	}
	runner, ok := driver.(hypervisor.BackupRunner)
	if !ok {
		s.err(w, http.StatusNotImplemented, "this hypervisor can't take a backup from here")
		return
	}
	vmid, err := strconv.Atoi(driverID)
	if err != nil {
		s.err(w, http.StatusBadRequest, "that guest has no id this hypervisor would recognise")
		return
	}

	mode := in.Mode
	if mode == "" {
		mode = "snapshot"
	}
	taskID, err := runner.RunBackup(r.Context(), hypervisor.BackupSpec{
		Node: node, VMID: vmid, Storage: in.Storage, Mode: mode,
		Compress: "zstd", Notes: in.Notes, Protected: in.Protected,
	})
	if err != nil {
		s.fail(w, err, "taking the backup")
		return
	}
	op := s.ops.start("Backing up "+name, "backup", name, hypervisorID, "/compute/backups")
	s.watchOrFinish(op, driver, taskID, "Backed up "+name)
	s.json(w, http.StatusAccepted, op)
}

// setBackupProtection exempts an archive from retention, or stops.
//
// THE WAY BACK FROM THE CHECKBOX. Taking an ad-hoc backup offers to
// keep it regardless of retention, and a protected archive is one the
// hypervisor refuses to delete — so without this the console could
// create archives it was then unable to remove.
func (s *Server) setBackupProtection(w http.ResponseWriter, r *http.Request) {
	driver := s.driverForHypervisor(w, r)
	if driver == nil {
		return
	}
	runner, ok := driver.(hypervisor.BackupRunner)
	if !ok {
		s.err(w, http.StatusNotImplemented, "this hypervisor can't change that from here")
		return
	}
	q := r.URL.Query()
	node, volume := q.Get("node"), q.Get("volume")
	if node == "" || volume == "" {
		s.err(w, http.StatusBadRequest, "node and volume are required")
		return
	}
	var in struct {
		Protected bool `json:"protected"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected protected true or false")
		return
	}
	if err := runner.SetBackupProtection(r.Context(), node, volume, in.Protected); err != nil {
		s.fail(w, err, "changing protection")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
