package store

import (
	"context"
	"database/sql"
	"errors"
)

// MachineType is a sizing preset, GCP-style. Configurable in Settings.
type MachineType struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	CPUs        int    `json:"cpus"`
	MemoryMB    int    `json:"memoryMb"`
}

func (s *Store) ListMachineTypes(ctx context.Context) ([]MachineType, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT name, description, cpus, memory_mb FROM machine_types ORDER BY cpus, memory_mb, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	types := []MachineType{}
	for rows.Next() {
		var mt MachineType
		if err := rows.Scan(&mt.Name, &mt.Description, &mt.CPUs, &mt.MemoryMB); err != nil {
			return nil, err
		}
		types = append(types, mt)
	}
	return types, rows.Err()
}

func (s *Store) GetMachineType(ctx context.Context, name string) (*MachineType, error) {
	var mt MachineType
	err := s.db.QueryRowContext(ctx,
		`SELECT name, description, cpus, memory_mb FROM machine_types WHERE name = ?`, name).
		Scan(&mt.Name, &mt.Description, &mt.CPUs, &mt.MemoryMB)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &mt, nil
}

func (s *Store) CreateMachineType(ctx context.Context, mt *MachineType) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO machine_types (name, description, cpus, memory_mb, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		mt.Name, mt.Description, mt.CPUs, mt.MemoryMB, now())
	return err
}

func (s *Store) DeleteMachineType(ctx context.Context, name string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM machine_types WHERE name = ?`, name)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) CountMachineTypes(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM machine_types`).Scan(&n)
	return n, err
}
