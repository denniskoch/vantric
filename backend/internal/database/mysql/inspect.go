package mysql

import (
	"context"
	"database/sql"
	"sort"

	"lab-cloud-manager/internal/database"
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
	rows, err := d.db.QueryContext(ctx, `
		SELECT table_name,
		       COALESCE(table_rows, 0),
		       COALESCE(data_length, 0) + COALESCE(index_length, 0),
		       COALESCE(engine, ''),
		       COALESCE(table_collation, ''),
		       COALESCE(table_comment, '')
		FROM information_schema.tables
		WHERE table_schema = ? AND table_type = 'BASE TABLE'
		ORDER BY table_name`, dbName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tables := []database.Table{}
	for rows.Next() {
		var t database.Table
		if err := rows.Scan(&t.Name, &t.Rows, &t.SizeBytes, &t.Engine,
			&t.Collation, &t.Comment); err != nil {
			return nil, err
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
