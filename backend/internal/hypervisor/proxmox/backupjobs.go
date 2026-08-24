package proxmox

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	proxmoxsdk "github.com/luthermonson/go-proxmox"

	"vantric/internal/hypervisor"
)

// Backup SCHEDULES — the vzdump jobs, as opposed to the archives they
// leave behind (those are Backups in storage.go).
//
// WRITTEN ON THE LIBRARY, which is what it was brought in for: the
// create/update body is forty fields, and ScheduleAnalyze and
// GuestsNotInBackup are two answers that would be miserable to
// hand-roll. What is NOT taken from it is the typed listing, for one
// reason recorded below.

var _ hypervisor.BackupScheduler = (*Driver)(nil)

// pruneBackups is why this file decodes the job list itself.
//
// THE FIELD COMES BACK AS EITHER SHAPE. Proxmox documents
// `prune-backups` as a property string — "keep-daily=14,keep-weekly=4"
// — and the library types it as one. But a cluster with retention
// actually configured returns it as an OBJECT ({"keep-daily":"14"}),
// and go-proxmox v0.8.1 fails the whole decode on it: one job with
// retention set makes every job on that hypervisor invisible. It is
// not fixed upstream (0.8.1 is the newest), so this accepts both and
// renders one.
type pruneBackups string

func (p *pruneBackups) UnmarshalJSON(raw []byte) error {
	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		*p = pruneBackups(asString)
		return nil
	}
	var asObject map[string]any
	if err := json.Unmarshal(raw, &asObject); err != nil {
		return err
	}
	// Sorted, so the same policy reads the same way every time rather
	// than in whatever order the map happened to iterate.
	keys := make([]string, 0, len(asObject))
	for k := range asObject {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s=%v", k, asObject[k]))
	}
	*p = pruneBackups(strings.Join(parts, ","))
	return nil
}

// backupJob is the wire shape of one vzdump job. It mirrors the
// library's ClusterBackup except for PruneBackups above.
type backupJob struct {
	ID            string       `json:"id"`
	Enabled       int          `json:"enabled"`
	Schedule      string       `json:"schedule"`
	NextRun       int64        `json:"next-run"`
	Storage       string       `json:"storage"`
	Node          string       `json:"node"`
	Mode          string       `json:"mode"`
	All           int          `json:"all"`
	VMID          string       `json:"vmid"`
	Exclude       string       `json:"exclude"`
	Pool          string       `json:"pool"`
	PruneBackups  pruneBackups `json:"prune-backups"`
	Compress      string       `json:"compress"`
	NotesTemplate string       `json:"notes-template"`
	MailTo        string       `json:"mailto"`
	Comment       string       `json:"comment"`
}

func (d *Driver) BackupSchedules(ctx context.Context) ([]hypervisor.BackupSchedule, error) {
	var jobs []backupJob
	if err := d.sdk.Get(ctx, "/cluster/backup", &jobs); err != nil {
		return nil, fmt.Errorf("proxmox: listing backup jobs: %w", err)
	}
	out := make([]hypervisor.BackupSchedule, 0, len(jobs))
	for _, j := range jobs {
		out = append(out, hypervisor.BackupSchedule{
			ID:            j.ID,
			Enabled:       j.Enabled == 1,
			Schedule:      j.Schedule,
			NextRun:       j.NextRun,
			Storage:       j.Storage,
			Node:          j.Node,
			Mode:          j.Mode,
			All:           j.All == 1,
			VMIDs:         vmidList(j.VMID),
			Exclude:       vmidList(j.Exclude),
			Pool:          j.Pool,
			Retention:     string(j.PruneBackups),
			Compress:      j.Compress,
			NotesTemplate: j.NotesTemplate,
			MailTo:        j.MailTo,
			Comment:       j.Comment,
		})
	}
	return out, nil
}

// vmidList parses Proxmox's comma-separated guest list. A value that
// isn't a number is dropped rather than failing the job: the list is
// for display and filtering, and one malformed entry should not hide a
// schedule that is running perfectly well.
func vmidList(raw string) []int {
	out := []int{}
	for _, part := range strings.Split(raw, ",") {
		if n, err := strconv.Atoi(strings.TrimSpace(part)); err == nil {
			out = append(out, n)
		}
	}
	return out
}

func vmidString(ids []int) string {
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, strconv.Itoa(id))
	}
	return strings.Join(parts, ",")
}

// options maps a spec onto the library's request body.
//
// EMPTY MEANS OMITTED, and the library's `omitempty` tags do that for
// us — which is what we want on create and is a TRAP on update, since
// Proxmox leaves an omitted field alone rather than clearing it. That
// is handled by the caller: see UpdateBackupSchedule.
func options(spec hypervisor.BackupScheduleSpec) *proxmoxsdk.ClusterBackupOptions {
	opts := &proxmoxsdk.ClusterBackupOptions{
		Enabled:       spec.Enabled,
		Schedule:      spec.Schedule,
		Storage:       spec.Storage,
		Node:          spec.Node,
		Mode:          spec.Mode,
		Pool:          spec.Pool,
		PruneBackups:  spec.Retention,
		Compress:      spec.Compress,
		NotesTemplate: spec.NotesTemplate,
		MailTo:        spec.MailTo,
		Comment:       spec.Comment,
	}
	if spec.All {
		opts.All = true
		opts.Exclude = vmidString(spec.Exclude)
	} else {
		opts.VMID = vmidString(spec.VMIDs)
	}
	return opts
}

// CreateBackupSchedule adds a job.
//
// `enabled` IS WRITTEN BY HAND, for the same reason it is on update:
// the library tags it `omitempty`, so `false` is dropped from the body
// and Proxmox defaults a new job to ON. Asking for a job that doesn't
// run yet and getting one that does is the worst direction for that
// mistake to go — and it is invisible, because the create succeeds.
func (d *Driver) CreateBackupSchedule(ctx context.Context, spec hypervisor.BackupScheduleSpec) error {
	body, err := withEnabled(options(spec), spec.Enabled)
	if err != nil {
		return err
	}
	return d.sdk.Post(ctx, "/cluster/backup", body, nil)
}

// withEnabled turns the typed options into a map so one field can be
// sent even when it is false.
func withEnabled(opts *proxmoxsdk.ClusterBackupOptions, enabled bool) (map[string]any, error) {
	raw, err := json.Marshal(opts)
	if err != nil {
		return nil, err
	}
	body := map[string]any{}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, err
	}
	body["enabled"] = boolInt(enabled)
	return body, nil
}

// UpdateBackupSchedule replaces a job's configuration.
//
// THE FIELDS A FORM CLEARED HAVE TO BE SENT AS CLEARED. `omitempty`
// drops an empty string, and Proxmox reads an absent field as "leave
// it alone" — so removing a job's retention, or its notes template, or
// its node pin would silently do nothing and the form would come back
// still showing the old value. `delete` is Proxmox's own word for it
// and takes the list of keys to unset.
func (d *Driver) UpdateBackupSchedule(ctx context.Context, id string, spec hypervisor.BackupScheduleSpec) error {
	body, err := withEnabled(options(spec), spec.Enabled)
	if err != nil {
		return err
	}

	clear := []string{}
	for key, value := range map[string]string{
		"prune-backups":  spec.Retention,
		"notes-template": spec.NotesTemplate,
		"mailto":         spec.MailTo,
		"comment":        spec.Comment,
		"node":           spec.Node,
		"pool":           spec.Pool,
	} {
		if value == "" {
			clear = append(clear, key)
		}
	}
	// Whichever way of choosing guests this job is NOT using has to go,
	// or a job switched from "all" to a named list keeps both and
	// Proxmox refuses it.
	if spec.All {
		clear = append(clear, "vmid")
	} else {
		clear = append(clear, "all", "exclude")
	}
	sort.Strings(clear)
	body["delete"] = strings.Join(clear, ",")

	return d.sdk.Put(ctx, "/cluster/backup/"+id, body, nil)
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// AddGuestsToSchedule merges guests into a job's list.
//
// READ, MERGE, WRITE ONE KEY. Proxmox takes a partial PUT, so the body
// carries `vmid` alone — no `delete` list, nothing else touched. The
// read is what makes it a merge rather than a replace, and it is why
// this cannot be done from the browser without risking everything else
// on the job.
func (d *Driver) AddGuestsToSchedule(ctx context.Context, id string, vmids []int) error {
	var jobs []backupJob
	if err := d.sdk.Get(ctx, "/cluster/backup", &jobs); err != nil {
		return fmt.Errorf("proxmox: reading backup job %s: %w", id, err)
	}
	var job *backupJob
	for i := range jobs {
		if jobs[i].ID == id {
			job = &jobs[i]
			break
		}
	}
	if job == nil {
		return fmt.Errorf("proxmox: no backup job %s", id)
	}
	// A job that already takes everything has nothing to add to, and
	// writing a vmid list onto it would NARROW it — the opposite of
	// what was asked for.
	if job.All == 1 {
		return fmt.Errorf("proxmox: backup job %s already covers every guest", id)
	}

	merged := vmidList(job.VMID)
	seen := map[int]bool{}
	for _, v := range merged {
		seen[v] = true
	}
	for _, v := range vmids {
		if !seen[v] {
			seen[v] = true
			merged = append(merged, v)
		}
	}
	sort.Ints(merged)

	return d.sdk.Put(ctx, "/cluster/backup/"+id,
		map[string]any{"vmid": vmidString(merged)}, nil)
}

func (d *Driver) DeleteBackupSchedule(ctx context.Context, id string) error {
	return d.sdk.Delete(ctx, "/cluster/backup/"+id, nil)
}

func (d *Driver) GuestsWithoutBackup(ctx context.Context) ([]hypervisor.BackupGap, error) {
	cluster, err := d.sdk.Cluster(ctx)
	if err != nil {
		return nil, err
	}
	guests, err := cluster.GuestsNotInBackup(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]hypervisor.BackupGap, 0, len(guests))
	for _, g := range guests {
		out = append(out, hypervisor.BackupGap{VMID: g.VMID, Name: g.Name, Type: g.Type})
	}
	return out, nil
}

// PreviewSchedule asks the hypervisor when an expression would fire.
//
// ITS OWN CLOCK, NOT OURS. A calendar event resolves against the
// cluster's timezone, and this console can be running anywhere — so
// the times come back from the thing that will actually run the job.
func (d *Driver) PreviewSchedule(ctx context.Context, schedule string, count int) ([]time.Time, error) {
	cluster, err := d.sdk.Cluster(ctx)
	if err != nil {
		return nil, err
	}
	events, err := cluster.ScheduleAnalyze(ctx, schedule, count, 0)
	if err != nil {
		return nil, err
	}
	out := make([]time.Time, 0, len(events))
	for _, e := range events {
		out = append(out, time.Unix(int64(e.Timestamp), 0).UTC())
	}
	return out, nil
}

var _ hypervisor.BackupRestorer = (*Driver)(nil)

// NextVMID asks the cluster for a guest id nothing is using.
func (d *Driver) NextVMID(ctx context.Context) (int, error) {
	var id json.Number
	if err := d.sdk.Get(ctx, "/cluster/nextid", &id); err != nil {
		return 0, fmt.Errorf("proxmox: asking for a free vmid: %w", err)
	}
	n, err := id.Int64()
	if err != nil {
		return 0, fmt.Errorf("proxmox: %q is not a vmid: %w", id, err)
	}
	return int(n), nil
}

// RestoreBackup unpacks an archive into a guest.
//
// TWO ENDPOINTS AND TWO SPELLINGS FOR THE SAME THING. A VM restore is a
// create with `archive` set; a container restore is a create with
// `ostemplate` set AND `restore=1`, because without that flag the same
// field means "build a fresh container from this template". Getting it
// wrong doesn't fail — it makes an empty container named after your
// backup.
//
// `force` IS THE DESTRUCTIVE FLAG and is only ever what the caller
// asked for: it tells Proxmox to delete the guest already at that vmid
// before unpacking. Everything else about this call is additive.
func (d *Driver) RestoreBackup(ctx context.Context, spec hypervisor.RestoreSpec) (string, error) {
	body := map[string]any{
		"vmid":  spec.VMID,
		"start": boolInt(spec.Start),
	}
	if spec.Storage != "" {
		body["storage"] = spec.Storage
	}
	if spec.Overwrite {
		body["force"] = 1
	}

	// The two guests spell their name differently, and a restore that
	// sets neither keeps the archive's — which is the original's, and
	// is how you end up with two guests answering to one name.
	kind := "qemu"
	if spec.GuestType == "lxc" {
		kind = "lxc"
		body["ostemplate"] = spec.VolumeID
		body["restore"] = 1
		if spec.Name != "" {
			body["hostname"] = spec.Name
		}
	} else {
		body["archive"] = spec.VolumeID
		if spec.Name != "" {
			body["name"] = spec.Name
		}
	}

	var taskID string
	path := fmt.Sprintf("/nodes/%s/%s", spec.Node, kind)
	if err := d.sdk.Post(ctx, path, body, &taskID); err != nil {
		return "", fmt.Errorf("proxmox: restoring %s: %w", spec.VolumeID, err)
	}
	return taskID, nil
}

var _ hypervisor.BackupRunner = (*Driver)(nil)

// RunBackup writes one archive now.
//
// `remove=0` IS THE IMPORTANT ONE. vzdump's default is to prune the
// storage to the retention policy as it goes — which for a backup you
// took by hand, before doing something risky, could delete the very
// archives you were keeping. An ad-hoc backup adds; it does not tidy.
func (d *Driver) RunBackup(ctx context.Context, spec hypervisor.BackupSpec) (string, error) {
	body := map[string]any{
		"vmid":    spec.VMID,
		"storage": spec.Storage,
		"mode":    spec.Mode,
		"remove":  0,
	}
	if spec.Compress != "" {
		body["compress"] = spec.Compress
	}
	if spec.Notes != "" {
		body["notes-template"] = spec.Notes
	}
	if spec.Protected {
		body["protected"] = 1
	}
	var taskID string
	path := fmt.Sprintf("/nodes/%s/vzdump", spec.Node)
	if err := d.sdk.Post(ctx, path, body, &taskID); err != nil {
		return "", fmt.Errorf("proxmox: backing up %d: %w", spec.VMID, err)
	}
	return taskID, nil
}

// SetBackupProtection flips an archive's exemption from retention.
func (d *Driver) SetBackupProtection(ctx context.Context, node, volumeID string, protected bool) error {
	// The volume id is a PATH SEGMENT here, and it contains a colon and
	// a slash — "nas-b4f2:backup/vzdump-…". Proxmox wants it escaped as
	// one segment rather than split into two.
	path := fmt.Sprintf("/nodes/%s/storage/%s/content/%s",
		url.PathEscape(node), url.PathEscape(storageOf(volumeID)), url.PathEscape(volumeID))
	body := map[string]any{"protected": boolInt(protected)}
	if err := d.sdk.Put(ctx, path, body, nil); err != nil {
		return fmt.Errorf("proxmox: protecting %s: %w", volumeID, err)
	}
	return nil
}

// storageOf takes the datastore off the front of a volume id.
func storageOf(volumeID string) string {
	name, _, _ := strings.Cut(volumeID, ":")
	return name
}
