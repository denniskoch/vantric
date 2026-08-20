package proxmox

import (
	"net/http"
	"strings"

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
