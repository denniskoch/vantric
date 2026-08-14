package postgres

import (
	"context"
	"fmt"
	"sort"
	"strings"

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

// Granting access.
//
// Three levels, spelled out in PostgreSQL's terms. Two details make
// the difference between a grant that works and one that looks like it
// worked:
//
//   - USAGE on the schema. Table privileges are unreachable without
//     it, so "read access" without USAGE is permission denied.
//   - Sequences. A serial primary key needs USAGE on its sequence, so
//     write access without it fails on the first INSERT.
//
// And ALTER DEFAULT PRIVILEGES, so the grant covers tables that don't
// exist yet — otherwise access silently stops applying the next time
// the app runs a migration.

// grantStatements renders the level as statements to run inside the
// database. schemaPublic is where an application's tables live unless
// someone went out of their way; deeper layouts are a psql job.
func grantStatements(level database.AccessLevel, user, owner string) []string {
	u := quote(user)
	stmts := []string{
		"GRANT USAGE ON SCHEMA public TO " + u,
	}
	defaults := func(objects, privileges string) string {
		// FOR ROLE the owner: default privileges attach to the role that
		// CREATES the object, and that's whoever owns the database, not
		// the console's login.
		return "ALTER DEFAULT PRIVILEGES FOR ROLE " + quote(owner) +
			" IN SCHEMA public GRANT " + privileges + " ON " + objects + " TO " + u
	}
	switch level {
	case database.AccessReadOnly:
		stmts = append(stmts,
			"GRANT SELECT ON ALL TABLES IN SCHEMA public TO "+u,
			"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "+u,
			defaults("TABLES", "SELECT"),
			defaults("SEQUENCES", "USAGE, SELECT"),
		)
	case database.AccessReadWrite:
		stmts = append(stmts,
			"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "+u,
			"GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "+u,
			defaults("TABLES", "SELECT, INSERT, UPDATE, DELETE"),
			defaults("SEQUENCES", "USAGE, SELECT, UPDATE"),
		)
	case database.AccessFull:
		stmts = append(stmts,
			"GRANT CREATE ON SCHEMA public TO "+u,
			"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "+u,
			"GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "+u,
			defaults("TABLES", "ALL PRIVILEGES"),
			defaults("SEQUENCES", "ALL PRIVILEGES"),
		)
	}
	return stmts
}

func (d *Driver) GrantAccess(ctx context.Context, spec database.AccessSpec) error {
	owner, err := d.databaseOwner(ctx, spec.Database)
	if err != nil {
		return err
	}

	// CONNECT lives on the database itself, in the shared catalog.
	dbPrivileges := "CONNECT, TEMPORARY"
	if spec.Level == database.AccessFull {
		dbPrivileges = "ALL PRIVILEGES"
	}
	if _, err := d.pool.Exec(ctx, "GRANT "+dbPrivileges+" ON DATABASE "+
		quote(spec.Database)+" TO "+quote(spec.User)); err != nil {
		return fmt.Errorf("postgres: granting on database: %w", err)
	}

	conn, err := d.connectTo(ctx, spec.Database)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	// Start from nothing so lowering someone's access is a real
	// reduction rather than an addition on top of what they had.
	if err := revokeInDatabase(ctx, conn, spec.User, owner); err != nil {
		return err
	}
	for _, stmt := range grantStatements(spec.Level, spec.User, owner) {
		if _, err := conn.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("postgres: %s: %w", firstWords(stmt), err)
		}
	}
	return nil
}

func (d *Driver) RevokeAccess(ctx context.Context, dbName, user, _ string) error {
	owner, err := d.databaseOwner(ctx, dbName)
	if err != nil {
		return err
	}
	conn, err := d.connectTo(ctx, dbName)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	if err := revokeInDatabase(ctx, conn, user, owner); err != nil {
		return err
	}
	if _, err := d.pool.Exec(ctx, "REVOKE ALL PRIVILEGES ON DATABASE "+
		quote(dbName)+" FROM "+quote(user)); err != nil {
		return fmt.Errorf("postgres: revoking on database: %w", err)
	}
	return nil
}

// revokeInDatabase clears everything inside one database, standing
// rules for future objects included — a revoke that leaves those
// behind hands access back the next time a table is created.
func revokeInDatabase(ctx context.Context, conn *pgx.Conn, user, owner string) error {
	u := quote(user)
	for _, stmt := range []string{
		"ALTER DEFAULT PRIVILEGES FOR ROLE " + quote(owner) +
			" IN SCHEMA public REVOKE ALL ON TABLES FROM " + u,
		"ALTER DEFAULT PRIVILEGES FOR ROLE " + quote(owner) +
			" IN SCHEMA public REVOKE ALL ON SEQUENCES FROM " + u,
		"REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM " + u,
		"REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM " + u,
		"REVOKE ALL PRIVILEGES ON SCHEMA public FROM " + u,
	} {
		if _, err := conn.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("postgres: %s: %w", firstWords(stmt), err)
		}
	}
	return nil
}

func (d *Driver) databaseOwner(ctx context.Context, dbName string) (string, error) {
	var owner string
	err := d.pool.QueryRow(ctx,
		`SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = $1`,
		dbName).Scan(&owner)
	if err != nil {
		return "", fmt.Errorf("postgres: reading the owner of %q: %w", dbName, err)
	}
	return owner, nil
}

// firstWords labels a failing statement without pasting the whole
// thing (and any identifier in it) into an error a user will read.
func firstWords(stmt string) string {
	words := strings.Fields(stmt)
	if len(words) > 4 {
		words = words[:4]
	}
	return strings.Join(words, " ")
}
