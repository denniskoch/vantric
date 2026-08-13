package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// DatabaseServer is a database server this console connects to.
// Password is never serialized; the API exposes hasPassword instead.
type DatabaseServer struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"-"`
	// Database is the one to connect to; catalog reads cover the whole
	// server regardless.
	Database  string    `json:"database"`
	SSLMode   string    `json:"sslMode"`
	CreatedAt time.Time `json:"createdAt"`
}

const databaseServerCols = `id, name, type, host, port, username, password, dbname, ssl_mode, created_at`

func scanDatabaseServer(scan func(dest ...any) error) (*DatabaseServer, error) {
	var s DatabaseServer
	var created string
	if err := scan(&s.ID, &s.Name, &s.Type, &s.Host, &s.Port, &s.Username,
		&s.Password, &s.Database, &s.SSLMode, &created); err != nil {
		return nil, err
	}
	s.CreatedAt = parseTime(created)
	return &s, nil
}

func (s *Store) ListDatabaseServers(ctx context.Context) ([]DatabaseServer, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+databaseServerCols+` FROM database_servers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	servers := []DatabaseServer{}
	for rows.Next() {
		server, err := scanDatabaseServer(rows.Scan)
		if err != nil {
			return nil, err
		}
		servers = append(servers, *server)
	}
	return servers, rows.Err()
}

func (s *Store) GetDatabaseServer(ctx context.Context, id string) (*DatabaseServer, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+databaseServerCols+` FROM database_servers WHERE id = ?`, id)
	server, err := scanDatabaseServer(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return server, err
}

func (s *Store) GetDatabaseServerByName(ctx context.Context, name string) (*DatabaseServer, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+databaseServerCols+` FROM database_servers WHERE name = ?`, name)
	server, err := scanDatabaseServer(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return server, err
}

func (s *Store) CreateDatabaseServer(ctx context.Context, server *DatabaseServer) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO database_servers (`+databaseServerCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		server.ID, server.Name, server.Type, server.Host, server.Port, server.Username,
		server.Password, server.Database, server.SSLMode, ts)
	server.CreatedAt = parseTime(ts)
	return err
}

func (s *Store) UpdateDatabaseServer(ctx context.Context, server *DatabaseServer) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE database_servers SET name = ?, type = ?, host = ?, port = ?, username = ?,
		        password = ?, dbname = ?, ssl_mode = ? WHERE id = ?`,
		server.Name, server.Type, server.Host, server.Port, server.Username,
		server.Password, server.Database, server.SSLMode, server.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteDatabaseServer(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM database_servers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
