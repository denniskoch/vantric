package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"

	"vantric/internal/database"
)

// Looking inside one database.
//
// MySQL's information_schema is server-wide, so unlike PostgreSQL
// these read through the existing pool — the database is a WHERE
// clause, not a connection.

func (d *Driver) Tables(ctx context.Context, dbName string) ([]database.Table, error) {
	// TABLE_ROWS is the engine's estimate for InnoDB and can be off by
	// a wide margin; it's still the only free answer, and a console
	// shouldn't COUNT(*) someone's production table on page load.
	//
	// VIEWS ARE LISTED TOO. Filtering on BASE TABLE hid three of them
	// in this lab's `romm` database — present on the server, on no page
	// here. They come back with NULL for rows, size and engine, which
	// is the truth about a view rather than a gap, so the kind travels
	// with the row and the UI shows a dash instead of a zero.
	rows, err := d.db.QueryContext(ctx, `
		SELECT table_name,
		       table_type,
		       COALESCE(table_rows, 0),
		       COALESCE(data_length, 0) + COALESCE(index_length, 0),
		       COALESCE(engine, ''),
		       COALESCE(table_collation, ''),
		       COALESCE(table_comment, '')
		FROM information_schema.tables
		WHERE table_schema = ? AND table_type IN ('BASE TABLE', 'VIEW')
		ORDER BY table_name`, dbName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tables := []database.Table{}
	for rows.Next() {
		var t database.Table
		var tableType string
		if err := rows.Scan(&t.Name, &tableType, &t.Rows, &t.SizeBytes, &t.Engine,
			&t.Collation, &t.Comment); err != nil {
			return nil, err
		}
		t.Kind = database.KindTable
		if tableType == "VIEW" {
			t.Kind = database.KindView
		}
		// MySQL has no schema layer inside a database and no per-table
		// owner; leaving them blank is honest, and the UI drops the
		// columns rather than printing a column of dashes.
		tables = append(tables, t)
	}
	return tables, rows.Err()
}

func (d *Driver) Grants(ctx context.Context, dbName string) ([]database.Grant, error) {
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

	collect := func(query, scopeColumn string) error {
		rows, err := d.db.QueryContext(ctx, query, dbName)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var grantee, privilege string
			var scope sql.NullString
			if scopeColumn == "" {
				if err := rows.Scan(&grantee, &privilege); err != nil {
					return err
				}
			} else if err := rows.Scan(&grantee, &scope, &privilege); err != nil {
				return err
			}
			// Grantee arrives quoted as 'user'@'host'; leave it as the
			// server writes it, since that pair IS the identity here.
			add(grantee, scope.String, privilege)
		}
		return rows.Err()
	}

	if err := collect(`
		SELECT grantee, privilege_type
		FROM information_schema.schema_privileges
		WHERE table_schema = ?`, ""); err != nil {
		return nil, err
	}
	if err := collect(`
		SELECT grantee, table_name, privilege_type
		FROM information_schema.table_privileges
		WHERE table_schema = ?`, "table_name"); err != nil {
		return nil, err
	}

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
	return grants, nil
}

// Granting access.
//
// MySQL keeps privileges on the database as a whole (`db`.*), so the
// three levels are three privilege lists and nothing more — no schema
// USAGE, no sequences, and no standing rule needed for future tables
// because the grant was never per-table to begin with.

func levelPrivileges(level database.AccessLevel) string {
	switch level {
	case database.AccessReadOnly:
		return "SELECT"
	case database.AccessReadWrite:
		return "SELECT, INSERT, UPDATE, DELETE"
	case database.AccessFull:
		return "ALL PRIVILEGES"
	}
	return ""
}

// grantee spells the thing being granted to, which is NOT always
// name@host.
//
// A ROLE HAS NO HOST, and addressing one as though it did fails —
// `'devrole'@”` and `'devrole'@'%'` are both "Can't find any matching
// row in the user table". A role is a bare quoted name.
//
// The host is not defaulted to '%' for an ordinary account either.
// 'bob'@'localhost' and 'bob'@'%' are two different accounts, so
// filling in a blank host with the wildcard doesn't grant broadly, it
// names an account that usually doesn't exist and fails the same way.
// A caller that has an account has its host; a blank one is only ever
// right for a role.
func (d *Driver) grantee(ctx context.Context, name, host string) string {
	if host == "" && d.roleNames(ctx)[name] {
		return quoteLiteral(name)
	}
	if host == "" {
		host = "%"
	}
	return quoteLiteral(name) + "@" + quoteLiteral(host)
}

func (d *Driver) GrantAccess(ctx context.Context, spec database.AccessSpec) error {
	privileges := levelPrivileges(spec.Level)
	if privileges == "" {
		return fmt.Errorf("mysql: unknown access level %q", spec.Level)
	}
	account := d.grantee(ctx, spec.User, spec.Host)

	// Clear first, so lowering someone's access is a reduction rather
	// than an addition on top of what they already had.
	if err := d.revokeOn(ctx, spec.Database, account); err != nil {
		return fmt.Errorf("mysql: revoking existing access: %w", err)
	}
	if _, err := d.db.ExecContext(ctx,
		"GRANT "+privileges+" ON "+quote(spec.Database)+".* TO "+account); err != nil {
		return fmt.Errorf("mysql: %w", err)
	}
	return nil
}

func (d *Driver) RevokeAccess(ctx context.Context, dbName, user, host string) error {
	if err := d.revokeOn(ctx, dbName, d.grantee(ctx, user, host)); err != nil {
		return fmt.Errorf("mysql: %w", err)
	}
	return nil
}

// revokeOn clears one account's privileges on one database.
//
// Two statements, not one: "ALL PRIVILEGES, GRANT OPTION" together is
// only valid in the global form with no ON clause, and scoped to a
// database it is a syntax error.
//
// Having nothing to revoke is the normal case when granting to someone
// new, and MySQL reports that as error 1141 — an answer, not a
// failure.
func (d *Driver) revokeOn(ctx context.Context, dbName, account string) error {
	for _, what := range []string{"ALL PRIVILEGES", "GRANT OPTION"} {
		_, err := d.db.ExecContext(ctx,
			"REVOKE "+what+" ON "+quote(dbName)+".* FROM "+account)
		if err != nil && !noSuchGrant(err) {
			return err
		}
	}
	return nil
}

func noSuchGrant(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "1141") || strings.Contains(msg, "there is no such grant")
}
