package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"lab-cloud-manager/internal/inventory"
	"lab-cloud-manager/internal/nvd"
	"lab-cloud-manager/internal/store"
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
)

type enricher struct {
	store     *store.Store
	inventory *inventory.Registry
	nvd       *nvd.Client
	log       *slog.Logger

	mu     sync.Mutex
	status EnrichmentStatus
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
	return &enricher{store: st, inventory: reg, nvd: client, log: log}
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
	interval := anonymousInterval
	if e.nvd.HasAPIKey() {
		interval = keyedInterval
	}
	e.log.Info("enricher: starting a pass", "cves", len(outstanding),
		"interval", interval, "estimate", (time.Duration(len(outstanding)) * interval).Round(time.Minute))

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for _, cve := range outstanding {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		e.enrich(ctx, cve)
	}

	e.mu.Lock()
	e.status.Running = false
	e.status.Queued = 0
	e.mu.Unlock()
	e.log.Info("enricher: pass complete", "done", e.status.Done, "failed", e.status.Failed)
}

func (e *enricher) enrich(ctx context.Context, cve string) {
	record, err := e.nvd.Lookup(ctx, cve)
	if err != nil {
		e.mu.Lock()
		e.status.Failed++
		e.status.LastError = err.Error()
		e.mu.Unlock()
		return
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
		return
	}
	e.mu.Lock()
	e.status.Done++
	if e.status.Queued > 0 {
		e.status.Queued--
	}
	e.mu.Unlock()
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
