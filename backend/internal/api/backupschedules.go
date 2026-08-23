package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"vantric/internal/hypervisor"
)

// Backup SCHEDULES: the jobs, as opposed to the archives they leave.
//
// THE JOBS ARE THE HYPERVISOR'S AND STAY THERE. This console does not
// keep a schedule of its own and does not run one — it reads and edits
// the hypervisor's, so a job made here is the same job its own UI
// shows, and turning this console off doesn't stop your backups. That
// is the difference between managing a tool and replacing it.
//
// WRITING THEM IS AN EDITOR'S. A backup job is a resource, not a
// credential: it changes what the hypervisor does with guests an
// editor could already delete. Adding the hypervisor stays owner-only.

// scheduler resolves one hypervisor and its capability, for the writes
// — a job belongs to a particular hypervisor and there is no sensible
// "create this on all of them".
func (s *Server) scheduler(w http.ResponseWriter, r *http.Request) (hypervisor.BackupScheduler, bool) {
	id := r.URL.Query().Get("hypervisor")
	if id == "" {
		s.err(w, http.StatusBadRequest, "which hypervisor? a backup job belongs to one")
		return nil, false
	}
	driver, ok := s.registry.Get(id)
	if !ok {
		s.err(w, http.StatusNotFound, "no such hypervisor")
		return nil, false
	}
	scheduler, ok := driver.(hypervisor.BackupScheduler)
	if !ok {
		s.err(w, http.StatusNotImplemented,
			"this hypervisor's backup jobs can't be changed from here")
		return nil, false
	}
	return scheduler, true
}

func (s *Server) listBackupSchedules(w http.ResponseWriter, r *http.Request) {
	items, err := listAcrossHypervisors(s, r,
		func(ctx context.Context, d hypervisor.Driver) ([]hypervisor.BackupSchedule, error) {
			scheduler, ok := d.(hypervisor.BackupScheduler)
			if !ok {
				return nil, nil
			}
			return scheduler.BackupSchedules(ctx)
		},
		func(item *hypervisor.BackupSchedule, id string) { item.HypervisorID = id })
	if err != nil {
		s.fail(w, err, "backup schedules")
		return
	}
	s.json(w, http.StatusOK, items)
}

// listBackupGaps is what the page leads with: guests no job covers.
//
// THE HYPERVISOR ANSWERS IT, and that is the point — a job saying
// "everything except these three" and a job naming fifteen vmids are
// the same coverage wearing different clothes, and working it out from
// the job list here would be reimplementing the thing that already
// knows.
func (s *Server) listBackupGaps(w http.ResponseWriter, r *http.Request) {
	items, err := listAcrossHypervisors(s, r,
		func(ctx context.Context, d hypervisor.Driver) ([]hypervisor.BackupGap, error) {
			scheduler, ok := d.(hypervisor.BackupScheduler)
			if !ok {
				return nil, nil
			}
			return scheduler.GuestsWithoutBackup(ctx)
		},
		func(item *hypervisor.BackupGap, id string) { item.HypervisorID = id })
	if err != nil {
		s.fail(w, err, "backup coverage")
		return
	}
	s.json(w, http.StatusOK, items)
}

// previewBackupSchedule shows when an expression would actually fire.
// Asked of the hypervisor, since a calendar event resolves against the
// cluster's timezone and this console can be running anywhere.
func (s *Server) previewBackupSchedule(w http.ResponseWriter, r *http.Request) {
	scheduler, ok := s.scheduler(w, r)
	if !ok {
		return
	}
	expression := strings.TrimSpace(r.URL.Query().Get("schedule"))
	if expression == "" {
		s.err(w, http.StatusBadRequest, "nothing to preview")
		return
	}
	runs, err := scheduler.PreviewSchedule(r.Context(), expression, 5)
	if err != nil {
		// A bad expression is the ordinary case here — the field is
		// being typed into — so it answers as a rejected value rather
		// than as a failure.
		s.err(w, http.StatusBadRequest, "the hypervisor doesn't recognise that schedule")
		return
	}
	s.json(w, http.StatusOK, runs)
}

type backupScheduleInput struct {
	Enabled       bool   `json:"enabled"`
	Schedule      string `json:"schedule"`
	Storage       string `json:"storage"`
	Node          string `json:"node"`
	Mode          string `json:"mode"`
	All           bool   `json:"all"`
	VMIDs         []int  `json:"vmids"`
	Exclude       []int  `json:"exclude"`
	Pool          string `json:"pool"`
	Retention     string `json:"retention"`
	Compress      string `json:"compress"`
	NotesTemplate string `json:"notesTemplate"`
	MailTo        string `json:"mailTo"`
	Comment       string `json:"comment"`
}

func (in backupScheduleInput) spec() hypervisor.BackupScheduleSpec {
	return hypervisor.BackupScheduleSpec{
		Enabled: in.Enabled, Schedule: strings.TrimSpace(in.Schedule),
		Storage: in.Storage, Node: in.Node, Mode: in.Mode,
		All: in.All, VMIDs: in.VMIDs, Exclude: in.Exclude, Pool: in.Pool,
		Retention: strings.TrimSpace(in.Retention), Compress: in.Compress,
		NotesTemplate: in.NotesTemplate, MailTo: strings.TrimSpace(in.MailTo),
		Comment: strings.TrimSpace(in.Comment),
	}
}

// decode reads a job and refuses the two shapes that produce a job
// which looks configured and backs nothing up.
func (s *Server) decodeSchedule(w http.ResponseWriter, r *http.Request) (*hypervisor.BackupScheduleSpec, bool) {
	var in backupScheduleInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a backup schedule")
		return nil, false
	}
	spec := in.spec()
	if spec.Schedule == "" {
		s.err(w, http.StatusBadRequest, "a schedule needs a time to run")
		return nil, false
	}
	if spec.Storage == "" {
		s.err(w, http.StatusBadRequest, "a schedule needs somewhere to write to")
		return nil, false
	}
	// A job covering nothing is accepted by Proxmox and runs forever
	// without backing anything up, which is the worst of the three
	// possible outcomes: it looks like coverage.
	if !spec.All && len(spec.VMIDs) == 0 && spec.Pool == "" {
		s.err(w, http.StatusBadRequest, "pick the guests to back up, or select all of them")
		return nil, false
	}
	return &spec, true
}

func (s *Server) createBackupSchedule(w http.ResponseWriter, r *http.Request) {
	scheduler, ok := s.scheduler(w, r)
	if !ok {
		return
	}
	spec, ok := s.decodeSchedule(w, r)
	if !ok {
		return
	}
	if err := scheduler.CreateBackupSchedule(r.Context(), *spec); err != nil {
		s.fail(w, err, "creating the backup schedule")
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (s *Server) updateBackupSchedule(w http.ResponseWriter, r *http.Request) {
	scheduler, ok := s.scheduler(w, r)
	if !ok {
		return
	}
	spec, ok := s.decodeSchedule(w, r)
	if !ok {
		return
	}
	if err := scheduler.UpdateBackupSchedule(r.Context(), chi.URLParam(r, "id"), *spec); err != nil {
		s.fail(w, err, "saving the backup schedule")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteBackupSchedule(w http.ResponseWriter, r *http.Request) {
	scheduler, ok := s.scheduler(w, r)
	if !ok {
		return
	}
	if err := scheduler.DeleteBackupSchedule(r.Context(), chi.URLParam(r, "id")); err != nil {
		s.fail(w, err, "removing the backup schedule")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
