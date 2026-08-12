package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

var ErrNotFound = errors.New("store: not found")

type Project struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	DisplayName string    `json:"displayName"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Instance struct {
	ID          string    `json:"id"`
	ProjectID   string    `json:"projectId"`
	Name        string    `json:"name"`
	Zone        string    `json:"zone"`
	MachineType string    `json:"machineType"`
	CPUs        int       `json:"cpus"`
	MemoryMB    int       `json:"memoryMb"`
	DiskGB      int       `json:"diskGb"`
	ImageID     string    `json:"imageId"`
	Status      string    `json:"status"`
	Driver      string    `json:"driver"`
	DriverID    string    `json:"driverId"`
	InternalIP  string    `json:"internalIp"`
	ExternalIP  string    `json:"externalIp"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

const timeFormat = time.RFC3339

func now() string { return time.Now().UTC().Format(timeFormat) }

func parseTime(s string) time.Time {
	t, _ := time.Parse(timeFormat, s)
	return t
}

// --- Projects ---

func (s *Store) CreateProject(ctx context.Context, p *Project) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO projects (id, name, display_name, created_at) VALUES (?, ?, ?, ?)`,
		p.ID, p.Name, p.DisplayName, ts)
	p.CreatedAt = parseTime(ts)
	return err
}

func (s *Store) ListProjects(ctx context.Context) ([]Project, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name, display_name, created_at FROM projects ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := []Project{}
	for rows.Next() {
		var p Project
		var created string
		if err := rows.Scan(&p.ID, &p.Name, &p.DisplayName, &created); err != nil {
			return nil, err
		}
		p.CreatedAt = parseTime(created)
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

func (s *Store) GetProjectByName(ctx context.Context, name string) (*Project, error) {
	var p Project
	var created string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, name, display_name, created_at FROM projects WHERE name = ?`, name).
		Scan(&p.ID, &p.Name, &p.DisplayName, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.CreatedAt = parseTime(created)
	return &p, nil
}

// --- Instances ---

const instanceCols = `id, project_id, name, zone, machine_type, cpus, memory_mb, disk_gb,
	image_id, status, driver, driver_id, internal_ip, external_ip, created_at, updated_at`

func scanInstance(scan func(dest ...any) error) (*Instance, error) {
	var i Instance
	var created, updated string
	err := scan(&i.ID, &i.ProjectID, &i.Name, &i.Zone, &i.MachineType, &i.CPUs, &i.MemoryMB,
		&i.DiskGB, &i.ImageID, &i.Status, &i.Driver, &i.DriverID, &i.InternalIP, &i.ExternalIP,
		&created, &updated)
	if err != nil {
		return nil, err
	}
	i.CreatedAt = parseTime(created)
	i.UpdatedAt = parseTime(updated)
	return &i, nil
}

func (s *Store) CreateInstance(ctx context.Context, i *Instance) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO instances (`+instanceCols+`)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		i.ID, i.ProjectID, i.Name, i.Zone, i.MachineType, i.CPUs, i.MemoryMB, i.DiskGB,
		i.ImageID, i.Status, i.Driver, i.DriverID, i.InternalIP, i.ExternalIP, ts, ts)
	i.CreatedAt = parseTime(ts)
	i.UpdatedAt = i.CreatedAt
	return err
}

func (s *Store) ListInstances(ctx context.Context, projectID string) ([]Instance, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+instanceCols+` FROM instances WHERE project_id = ? ORDER BY name`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	instances := []Instance{}
	for rows.Next() {
		i, err := scanInstance(rows.Scan)
		if err != nil {
			return nil, err
		}
		instances = append(instances, *i)
	}
	return instances, rows.Err()
}

// ListAllInstances returns every instance across projects (for the reconciler).
func (s *Store) ListAllInstances(ctx context.Context) ([]Instance, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+instanceCols+` FROM instances`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	instances := []Instance{}
	for rows.Next() {
		i, err := scanInstance(rows.Scan)
		if err != nil {
			return nil, err
		}
		instances = append(instances, *i)
	}
	return instances, rows.Err()
}

func (s *Store) GetInstance(ctx context.Context, projectID, name string) (*Instance, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+instanceCols+` FROM instances WHERE project_id = ? AND name = ?`, projectID, name)
	i, err := scanInstance(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return i, err
}

// UpdateInstanceState syncs live fields observed from the hypervisor.
func (s *Store) UpdateInstanceState(ctx context.Context, id, status, internalIP, externalIP string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE instances SET status = ?, internal_ip = ?, external_ip = ?, updated_at = ? WHERE id = ?`,
		status, internalIP, externalIP, now(), id)
	return err
}

func (s *Store) SetInstanceStatus(ctx context.Context, id, status string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE instances SET status = ?, updated_at = ? WHERE id = ?`, status, now(), id)
	return err
}

func (s *Store) DeleteInstance(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM instances WHERE id = ?`, id)
	return err
}
