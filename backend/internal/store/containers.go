package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Container is a system container (LXC). Kept separate from Instance:
// containers list, provision, and behave differently from VMs.
type Container struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	HypervisorID string    `json:"hypervisorId"`
	Node         string    `json:"node"`
	CPUs         int       `json:"cpus"`
	MemoryMB     int       `json:"memoryMb"`
	DiskGB       int       `json:"diskGb"`
	Status       string    `json:"status"`
	DriverID     string    `json:"driverId"`
	InternalIP   string    `json:"internalIp"`
	Description  string    `json:"description"`
	Protected    bool      `json:"protected"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

const containerCols = `id, name, hypervisor_id, node, cpus, memory_mb, disk_gb,
	status, driver_id, internal_ip, description, protected, created_at, updated_at`

func scanContainer(scan func(dest ...any) error) (*Container, error) {
	var c Container
	var created, updated string
	var protected int
	err := scan(&c.ID, &c.Name, &c.HypervisorID, &c.Node, &c.CPUs, &c.MemoryMB, &c.DiskGB,
		&c.Status, &c.DriverID, &c.InternalIP, &c.Description, &protected, &created, &updated)
	if err != nil {
		return nil, err
	}
	c.Protected = protected != 0
	c.CreatedAt = parseTime(created)
	c.UpdatedAt = parseTime(updated)
	return &c, nil
}

func (s *Store) CreateContainer(ctx context.Context, c *Container) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO containers (`+containerCols+`)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		c.ID, c.Name, c.HypervisorID, c.Node, c.CPUs, c.MemoryMB, c.DiskGB,
		c.Status, c.DriverID, c.InternalIP, c.Description, boolInt(c.Protected), ts, ts)
	c.CreatedAt = parseTime(ts)
	c.UpdatedAt = c.CreatedAt
	return err
}

func (s *Store) ListContainers(ctx context.Context) ([]Container, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+containerCols+` FROM containers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	containers := []Container{}
	for rows.Next() {
		c, err := scanContainer(rows.Scan)
		if err != nil {
			return nil, err
		}
		containers = append(containers, *c)
	}
	return containers, rows.Err()
}

func (s *Store) GetContainer(ctx context.Context, name string) (*Container, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+containerCols+` FROM containers WHERE name = ?`, name)
	c, err := scanContainer(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

func (s *Store) UpdateContainerState(ctx context.Context, id, status, internalIP string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE containers SET status = ?, internal_ip = ?, updated_at = ? WHERE id = ?`,
		status, internalIP, now(), id)
	return err
}

// UpdateContainerShape is UpdateInstanceShape for containers; same
// race, same drift.
func (s *Store) UpdateContainerShape(ctx context.Context, id, name, node string, cpus, memoryMB, diskGB int) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE containers SET name = ?, node = ?, cpus = ?, memory_mb = ?, disk_gb = ?,
		 updated_at = ? WHERE id = ?`,
		name, node, cpus, memoryMB, diskGB, now(), id)
	return err
}

func (s *Store) SetContainerStatus(ctx context.Context, id, status string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE containers SET status = ?, updated_at = ? WHERE id = ?`, status, now(), id)
	return err
}

func (s *Store) SetContainerProtection(ctx context.Context, id string, protected bool) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE containers SET protected = ?, updated_at = ? WHERE id = ?`,
		boolInt(protected), now(), id)
	return err
}

func (s *Store) DeleteContainer(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM containers WHERE id = ?`, id)
	return err
}

// GetContainerByDriverID finds the record for one container on one
// hypervisor, whatever it ended up being called — which is how the
// create flow recognises a container the reconciler adopted while it was
// still working.
func (s *Store) GetContainerByDriverID(ctx context.Context, hypervisorID, driverID string) (*Container, error) {
	ct, err := scanContainer(s.db.QueryRowContext(ctx,
		`SELECT `+containerCols+` FROM containers WHERE hypervisor_id = ? AND driver_id = ?`,
		hypervisorID, driverID).Scan)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return ct, err
}

// ClaimContainer takes over a record the reconciler adopted a moment
// before this app's own create finished writing one — the same race
// ClaimInstance exists for, and it bites harder here because a container
// is created in seconds and the sweep runs every two.
func (s *Store) ClaimContainer(ctx context.Context, c *Container) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE containers SET name = ?, driver_id = ?, node = ?, cpus = ?, memory_mb = ?,
		 disk_gb = ?, description = ?, protected = ?, updated_at = ? WHERE id = ?`,
		c.Name, c.DriverID, c.Node, c.CPUs, c.MemoryMB, c.DiskGB, c.Description,
		boolInt(c.Protected), now(), c.ID)
	return err
}
