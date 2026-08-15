package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"vantric/internal/inventory"
	"vantric/internal/nvd"
	"vantric/internal/store"
)

// The CVE enricher: a slow background pass that fills in what the flaw
// actually is, for every vulnerability the inventory service reports.
//
// It exists because enrichment on demand only helps the page you
// happen to open. A list can't sort by severity, and the overview can't
// say "two machines carry something critical", if the score only
// arrives when somebody clicks. So the console fetches them all, once,
// and keeps them.
//
// THE RATE LIMIT IS THE DESIGN. NVD allows an anonymous caller a
// handful of requests a minute and a keyed one about fifty per thirty
// seconds; five thousand CVEs is therefore either eight hours or one,
// depending on whether a key is configured. Neither is a thing to do
// eagerly at startup, so this runs at a fixed, deliberately unhurried
// pace, remembers what it has, and never re-asks for something it
// fetched recently. A restart resumes rather than restarts, because
// the answers are in the database.

const (
	// Comfortably inside NVD's published limits, with room for the odd
	// retry: 50 requests per 30s keyed, 5 per 30s anonymous.
	keyedInterval     = 750 * time.Millisecond
	anonymousInterval = 7 * time.Second
	// How often to look for CVEs the inventory service has started
	// reporting since the last sweep.
	discoverEvery = 30 * time.Minute
	// A CVE is re-read this long after it was last fetched: scores get
	// revised and descriptions get written after publication, but
	// neither is news within a month.
	refreshAfter = 30 * 24 * time.Hour
	// A miss is retried sooner — a CVE reserved but not yet published
	// will fill in.
	retryMissingAfter = 7 * 24 * time.Hour
	// What to do when NVD says slower. Their window is 30 seconds, so
	// this waits out a whole one and then some.
	rateLimitBackoff = 60 * time.Second
	// A pass that keeps failing is a pass doing damage, not progress.
	// Ten in a row means something is wrong that waiting won't fix —
	// a revoked key, no route to the internet — and hammering a public
	// service for another five thousand attempts is not the answer.
	maxConsecutiveFailures = 10
)

type enricher struct {
	store     *store.Store
	inventory *inventory.Registry
	nvd       *nvd.Client
	log       *slog.Logger

	mu      sync.Mutex
	status  EnrichmentStatus
	enabled bool
}

// Enabled reports whether this console runs the background pass. See
// nvdEnrichSetting for why a console might not.
func (e *enricher) Enabled() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.enabled
}

func (e *enricher) SetEnabled(on bool) {
	e.mu.Lock()
	e.enabled = on
	e.mu.Unlock()
}

// EnrichmentStatus is what the settings page shows: enough to tell
// whether this is working without reading a log.
type EnrichmentStatus struct {
	Running bool `json:"running"`
	// Queued is how many CVEs are known but not yet enriched.
	Queued int `json:"queued"`
	// Done and Failed count this process's work, so a restart's
	// progress is visible rather than hidden behind the totals.
	Done      int    `json:"done"`
	Failed    int    `json:"failed"`
	LastError string `json:"lastError,omitempty"`
	LastRunAt int64  `json:"lastRunAt"`
	// HasAPIKey says which rate limit is in force, which is the
	// difference between an hour and a working day.
	HasAPIKey bool `json:"hasApiKey"`
}

func newEnricher(st *store.Store, reg *inventory.Registry, client *nvd.Client, log *slog.Logger) *enricher {
	// On unless somebody turned it off: a console that has an
	// inventory service and no enrichment shows a list it can't sort.
	return &enricher{store: st, inventory: reg, nvd: client, log: log, enabled: true}
}

func (e *enricher) Status(ctx context.Context) EnrichmentStatus {
	e.mu.Lock()
	status := e.status
	e.mu.Unlock()
	status.HasAPIKey = e.nvd.HasAPIKey()
	return status
}

// Run discovers work periodically and works through it at NVD's pace.
// It returns when the context is cancelled.
func (e *enricher) Run(ctx context.Context) {
	// Nothing urgent here, and a console starting up has better things
	// to do with its first seconds.
	select {
	case <-ctx.Done():
		return
	case <-time.After(30 * time.Second):
	}
	for {
		e.pass(ctx)
		select {
		case <-ctx.Done():
			return
		case <-time.After(discoverEvery):
		}
	}
}

// pass enriches everything currently outstanding, then returns.
func (e *enricher) pass(ctx context.Context) {
	if !e.Enabled() {
		return
	}
	provider, ok := e.inventory.Any()
	if !ok {
		return
	}
	summaries, err := provider.Vulnerabilities(ctx)
	if err != nil {
		// Including ErrUnsupported: a service that can't list CVEs
		// estate-wide gives this worker nothing to do, which is a fact
		// about the service rather than a failure here.
		return
	}
	known, err := e.store.KnownCVEs(ctx, time.Now().Add(-refreshAfter).Unix())
	if err != nil {
		e.log.Warn("enricher: reading the cache failed", "error", err)
		return
	}
	outstanding := make([]string, 0)
	for _, s := range summaries {
		if !known[s.CVE] {
			outstanding = append(outstanding, s.CVE)
		}
	}

	e.mu.Lock()
	e.status.Running = len(outstanding) > 0
	e.status.Queued = len(outstanding)
	e.status.LastRunAt = time.Now().Unix()
	e.mu.Unlock()

	if len(outstanding) == 0 {
		return
	}
	e.log.Info("enricher: starting a pass", "cves", len(outstanding),
		"interval", e.interval(),
		"estimate", (time.Duration(len(outstanding)) * e.interval()).Round(time.Minute))

	consecutive := 0
	for _, cve := range outstanding {
		// The pace is read every iteration rather than fixed for the pass:
		// a key added or removed while this runs changes which limit
		// applies, and the old code would have kept the old pace for
		// another five thousand requests.
		select {
		case <-ctx.Done():
			return
		case <-time.After(e.interval()):
		}
		if !e.Enabled() {
			e.log.Info("enricher: switched off mid-pass, stopping")
			break
		}
		err := e.enrich(ctx, cve)
		switch {
		case err == nil:
			consecutive = 0
		case errors.Is(err, nvd.ErrRateLimited):
			// Feedback, not a statistic. Wait out their window before
			// asking again.
			consecutive++
			e.log.Warn("enricher: rate limited, backing off",
				"wait", rateLimitBackoff, "hasApiKey", e.nvd.HasAPIKey())
			select {
			case <-ctx.Done():
				return
			case <-time.After(rateLimitBackoff):
			}
		default:
			consecutive++
		}
		if consecutive >= maxConsecutiveFailures {
			e.log.Error("enricher: giving up on this pass",
				"consecutiveFailures", consecutive, "lastError", e.status.LastError)
			break
		}
	}

	e.mu.Lock()
	e.status.Running = false
	e.status.Queued = 0
	e.mu.Unlock()
	e.log.Info("enricher: pass complete", "done", e.status.Done, "failed", e.status.Failed)
}

// interval is the pace NVD allows right now, which depends on whether
// a key is configured — an hour's work against most of a day.
func (e *enricher) interval() time.Duration {
	if e.nvd.HasAPIKey() {
		return keyedInterval
	}
	return anonymousInterval
}

func (e *enricher) enrich(ctx context.Context, cve string) error {
	record, err := e.nvd.Lookup(ctx, cve)
	if err != nil {
		e.mu.Lock()
		e.status.Failed++
		e.status.LastError = err.Error()
		e.mu.Unlock()
		return err
	}
	row := &store.CVE{ID: cve, Missing: record == nil}
	if record != nil {
		row.Description = record.Description
		row.Published = record.Published
		row.LastModified = record.LastModified
		if len(record.Metrics) > 0 {
			// The first is the preferred one — NVD's own analysis where
			// it exists — lifted out so a list can sort without
			// decoding the rest.
			row.Score = record.Metrics[0].Score
			row.Severity = record.Metrics[0].Severity
		}
		row.Metrics = encode(record.Metrics)
		row.Weaknesses = encode(record.Weaknesses)
		row.References = encode(record.References)
	}
	if err := e.store.UpsertCVE(ctx, row); err != nil {
		e.log.Warn("enricher: storing failed", "cve", cve, "error", err)
		return err
	}
	e.mu.Lock()
	e.status.Done++
	if e.status.Queued > 0 {
		e.status.Queued--
	}
	e.mu.Unlock()
	return nil
}

func encode(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(raw)
}

// enrichedRecord rebuilds an nvd.Record from a cached row, so a page
// can't tell whether the answer came from the database or the wire.
func enrichedRecord(c *store.CVE) *nvd.Record {
	if c == nil || c.Missing {
		return nil
	}
	record := &nvd.Record{
		CVE:          c.ID,
		Description:  c.Description,
		Published:    c.Published,
		LastModified: c.LastModified,
	}
	_ = json.Unmarshal([]byte(c.Metrics), &record.Metrics)
	_ = json.Unmarshal([]byte(c.Weaknesses), &record.Weaknesses)
	_ = json.Unmarshal([]byte(c.References), &record.References)
	return record
}
