package proxmox

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	sdk "github.com/luthermonson/go-proxmox"
)

// Adopting github.com/luthermonson/go-proxmox, one call at a time.
//
// WHY A LIBRARY AT ALL, given 39 endpoints already worked: because the
// next section is backup SCHEDULING, and that is a different size of
// problem. Reading a backup catalogue is one endpoint; vzdump jobs are
// a schedule expression, retention, notification policy, inclusion by
// pool or by guest, and a preview of when a schedule actually fires.
// The library has all of it (Cluster.NewBackup, ClusterBackupOptions,
// ScheduleAnalyze) plus GuestsNotInBackup, which answers "what isn't
// covered" — the correlation this console exists to show.
//
// It also types the thing that bit us. A resize returning a UPID looked
// like success and did nothing; the library's signatures are
// `(task *Task, err error)`, so the task is impossible to not notice.
//
// WHY NOT A REWRITE. The hand-rolled driver is 3,457 lines that now
// have live tests against a real hypervisor, and most of its value is
// not the HTTP calls — it's the comments explaining why a serial must
// not be set on a template, which disk is the boot disk, and what an
// empty guest-agent answer means. Replacing all of it at once would
// trade verified behaviour for a diff nobody can review. So: new work
// is written on the library, and existing calls move over when there's
// a reason to touch them, each one still covered by the same tests.
//
// The client SHARES this driver's http.Client, so there is one TLS
// policy, one timeout and one connection pool rather than two — which
// also means the transport-level behaviour stays exactly what today's
// driver already proves against the lab.
func newSDK(cfg Config, client *http.Client) *sdk.Client {
	base := strings.TrimRight(cfg.BaseURL, "/") + "/api2/json"
	return sdk.NewClient(base,
		sdk.WithHTTPClient(client),
		sdk.WithAPIToken(cfg.TokenID, cfg.Secret),
	)
}

// vmFor is the library's handle on a guest, resolved through this
// driver's own vmid → node cache so it costs no extra call.
func (d *Driver) vmFor(ctx context.Context, driverID string) (*sdk.VirtualMachine, error) {
	node, err := d.node(ctx, driverID)
	if err != nil {
		return nil, err
	}
	vmid, err := strconv.Atoi(driverID)
	if err != nil {
		return nil, fmt.Errorf("%q is not a vmid", driverID)
	}
	n, err := d.sdk.Node(ctx, node)
	if err != nil {
		return nil, err
	}
	return n.VirtualMachine(ctx, vmid)
}

// configMap flattens the library's typed config back into the shape this
// driver's own parsers expect.
//
// Deliberate, rather than a step not yet taken. The library groups the
// repeatable keys — SCSIs, IDEs, Unuseds — which is the part worth
// having, and leaves each VALUE as the string Proxmox wrote
// ("local-lvm:vm-101-disk-0,size=20G"). The code that reads those
// strings is ours, tested, and encodes things no library knows: which
// disk a guest boots from, that a cloud-init drive is media=cdrom, that
// a size in megabytes rounds DOWN or the next resize is refused as a
// shrink. Feeding it from here keeps that logic and its tests untouched
// while the transport moves.
func configMap(cfg *sdk.VirtualMachineConfig) map[string]any {
	out := map[string]any{}
	if cfg == nil {
		return out
	}
	if cfg.Boot != "" {
		out["boot"] = cfg.Boot
	}
	for _, group := range []map[string]string{
		cfg.SCSIs, cfg.IDEs, cfg.SATAs, cfg.VirtIOs, cfg.Unuseds,
	} {
		for key, value := range group {
			out[key] = value
		}
	}
	return out
}

// awaitTask waits for one of the library's tasks.
//
// The reason this file exists at all: every mutating call in the library
// returns (*Task, error), so a caller cannot quietly skip the wait the
// way ours could. The disk resize shipped doing exactly that — issued,
// reported success, changed nothing — because the UPID came back as an
// untyped body nobody was obliged to look at.
func awaitTask(ctx context.Context, task *sdk.Task, what string) error {
	if task == nil {
		return nil
	}
	if err := task.Wait(ctx, time.Second, diskWait); err != nil {
		return fmt.Errorf("waiting for %s: %w", what, err)
	}
	return nil
}
