package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// The CVE cache: what a public reference says about a flaw, kept here
// so every view can show it without asking NVD again.
//
// This is a local copy of somebody else's data, which this project
// otherwise refuses to keep — the difference is that NVD is a
// REFERENCE, not a tool that owns state in the lab. Nobody edits it, it
// can't drift from a truth we're mirroring, and deleting the table
// costs a refetch rather than a fact. That is a different thing from a
// second inventory of your machines.

// CVE is one enriched vulnerability. The JSON columns hold what the
// provider returned, since scores and references are lists whose shape
// belongs to NVD rather than to a schema here.
type CVE struct {
	ID           string
	Description  string
	Published    int64
	LastModified int64
	// Score and Severity are the headline metric, lifted out of the
	// JSON so a list can sort on them without decoding every row.
	Score      float64
	Severity   string
	Metrics    string
	Weaknesses string
	References string
	// FetchedAt is when this console last asked. Missing marks a CVE
	// NVD doesn't publish — recorded so it isn't asked for repeatedly.
	FetchedAt int64
	Missing   bool
}

func (s *Store) GetCVE(ctx context.Context, id string) (*CVE, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, description, published, last_modified, score, severity,
		        metrics, weaknesses, references_json, fetched_at, missing
		 FROM cve_cache WHERE id = ?`, strings.ToUpper(id))
	c, err := scanCVE(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// CVEScores returns the headline metric for many CVEs at once, which is
// what a list needs: one query rather than one per row.
func (s *Store) CVEScores(ctx context.Context) (map[string]CVE, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, description, published, last_modified, score, severity,
		        metrics, weaknesses, references_json, fetched_at, missing
		 FROM cve_cache WHERE missing = 0`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]CVE{}
	for rows.Next() {
		c, err := scanCVE(rows.Scan)
		if err != nil {
			return nil, err
		}
		out[c.ID] = *c
	}
	return out, rows.Err()
}

func scanCVE(scan func(dest ...any) error) (*CVE, error) {
	var c CVE
	var missing int
	err := scan(&c.ID, &c.Description, &c.Published, &c.LastModified, &c.Score,
		&c.Severity, &c.Metrics, &c.Weaknesses, &c.References, &c.FetchedAt, &missing)
	if err != nil {
		return nil, err
	}
	c.Missing = missing != 0
	return &c, nil
}

func (s *Store) UpsertCVE(ctx context.Context, c *CVE) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO cve_cache
		   (id, description, published, last_modified, score, severity,
		    metrics, weaknesses, references_json, fetched_at, missing)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   description = excluded.description,
		   published = excluded.published,
		   last_modified = excluded.last_modified,
		   score = excluded.score,
		   severity = excluded.severity,
		   metrics = excluded.metrics,
		   weaknesses = excluded.weaknesses,
		   references_json = excluded.references_json,
		   fetched_at = excluded.fetched_at,
		   missing = excluded.missing`,
		strings.ToUpper(c.ID), c.Description, c.Published, c.LastModified, c.Score,
		c.Severity, c.Metrics, c.Weaknesses, c.References,
		time.Now().Unix(), boolInt(c.Missing))
	return err
}

// KnownCVEs is the set already fetched, so the worker can ask for what
// it's missing without reading every row's contents.
func (s *Store) KnownCVEs(ctx context.Context, staleBefore int64) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id FROM cve_cache WHERE fetched_at > ?`, staleBefore)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	known := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		known[id] = true
	}
	return known, rows.Err()
}

// CVECacheStats is what the settings page reports: enough to tell
// whether the backfill is working without reading the log.
type CVECacheStats struct {
	Enriched  int   `json:"enriched"`
	Missing   int   `json:"missing"`
	NewestAt  int64 `json:"newestAt"`
	WithScore int   `json:"withScore"`
}

func (s *Store) CVECacheStats(ctx context.Context) (*CVECacheStats, error) {
	var stats CVECacheStats
	err := s.db.QueryRowContext(ctx,
		`SELECT
		   COALESCE(SUM(CASE WHEN missing = 0 THEN 1 ELSE 0 END), 0),
		   COALESCE(SUM(CASE WHEN missing = 1 THEN 1 ELSE 0 END), 0),
		   COALESCE(MAX(fetched_at), 0),
		   COALESCE(SUM(CASE WHEN score > 0 THEN 1 ELSE 0 END), 0)
		 FROM cve_cache`).Scan(&stats.Enriched, &stats.Missing, &stats.NewestAt, &stats.WithScore)
	return &stats, err
}
