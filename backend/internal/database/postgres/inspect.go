package postgres

import (
	"context"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"

	"lab-cloud-manager/internal/database"
)

// Looking inside one database.
//
// PostgreSQL's catalog is per-database — pg_class only ever describes
// the database you're connected to — so unlike every other read in
// this driver, these open a connection to the target rather than using
// the pool. They're on-demand detail-view reads, not polled, so a
// short-lived connection is the right trade against a pool per
// database.

// connectTo opens a connection to one database on this server.
func (d *Driver) connectTo(ctx context.Context, dbName string) (*pgx.Conn, error) {
	cfg := d.cfg
	cfg.Database = dbName
	conn, err := pgx.Connect(ctx, dsn(cfg))
	if err != nil {
		return nil, fmt.Errorf("postgres: connecting to %q: %w", dbName, err)
	}
	return conn, nil
}

func (d *Driver) Tables(ctx context.Context, dbName string) ([]database.Table, error) {
	conn, err := d.connectTo(ctx, dbName)
	if err != nil {
		return nil, err
	}
	defer conn.Close(ctx)

	// n_live_tup and reltuples are both estimates maintained by
	// autovacuum/ANALYZE — approximate, and free. COUNT(*) on someone's
	// production table is not a thing a console should do on page load.
	// A table that has never been analysed reports 0 whatever its size,
	// which is why the UI shows an unknown estimate as "—" rather than
	// claiming the table is empty.
	rows, err := conn.Query(ctx, `
		SELECT n.nspname,
		       c.relname,
		       pg_get_userbyid(c.relowner),
		       GREATEST(COALESCE(s.n_live_tup, 0), COALESCE(c.reltuples, 0))::bigint,
		       pg_total_relation_size(c.oid),
		       COALESCE(obj_description(c.oid, 'pg_class'), '')
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
		WHERE c.relkind IN ('r', 'p')
		  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
		  AND n.nspname NOT LIKE 'pg_toast%'
		ORDER BY n.nspname, c.relname`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tables := []database.Table{}
	for rows.Next() {
		var t database.Table
		if err := rows.Scan(&t.Schema, &t.Name, &t.Owner, &t.Rows, &t.SizeBytes, &t.Comment); err != nil {
			return nil, err
		}
		tables = append(tables, t)
	}
	return tables, rows.Err()
}

func (d *Driver) Grants(ctx context.Context, dbName string) ([]database.Grant, error) {
	// Database-level privileges live in the shared catalog, so this one
	// can use the pool.
	byKey := map[string]*database.Grant{}
	add := func(grantee, scope, privilege string) {
		key := grantee + "\x00" + scope
		if g, ok := byKey[key]; ok {
			g.Privileges = append(g.Privileges, privilege)
			return
		}
		byKey[key] = &database.Grant{
			Grantee:    grantee,
			Scope:      scope,
			Privileges: []string{privilege},
		}
	}

	rows, err := d.pool.Query(ctx, `
		SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC'
		            ELSE pg_get_userbyid(a.grantee) END,
		       a.privilege_type
		FROM pg_database d, aclexplode(d.datacl) a
		WHERE d.datname = $1`, dbName)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var grantee, privilege string
		if err := rows.Scan(&grantee, &privilege); err != nil {
			rows.Close()
			return nil, err
		}
		add(grantee, "", privilege)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Table-level privileges are per-database, so this half needs the
	// database's own connection.
	conn, err := d.connectTo(ctx, dbName)
	if err != nil {
		return nil, err
	}
	defer conn.Close(ctx)

	tableRows, err := conn.Query(ctx, `
		SELECT grantee, table_schema || '.' || table_name, privilege_type
		FROM information_schema.role_table_grants
		WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
		ORDER BY grantee, table_schema, table_name`)
	if err != nil {
		return nil, err
	}
	defer tableRows.Close()
	for tableRows.Next() {
		var grantee, scope, privilege string
		if err := tableRows.Scan(&grantee, &scope, &privilege); err != nil {
			return nil, err
		}
		add(grantee, scope, privilege)
	}
	if err := tableRows.Err(); err != nil {
		return nil, err
	}
	return sortedGrants(byKey), nil
}

// sortedGrants flattens the accumulator into a stable order: the
// database itself first, then by grantee and scope, so the same server
// renders the same way twice.
func sortedGrants(byKey map[string]*database.Grant) []database.Grant {
	grants := make([]database.Grant, 0, len(byKey))
	for _, g := range byKey {
		sort.Strings(g.Privileges)
		grants = append(grants, *g)
	}
	sort.Slice(grants, func(i, j int) bool {
		if (grants[i].Scope == "") != (grants[j].Scope == "") {
			return grants[i].Scope == ""
		}
		if grants[i].Grantee != grants[j].Grantee {
			return grants[i].Grantee < grants[j].Grantee
		}
		return grants[i].Scope < grants[j].Scope
	})
	return grants
}
