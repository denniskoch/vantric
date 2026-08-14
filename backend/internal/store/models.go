package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

var ErrNotFound = errors.New("store: not found")

type Instance struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ServerID    string `json:"serverId"`
	Zone        string `json:"zone"`
	MachineType string `json:"machineType"`
	CPUs        int    `json:"cpus"`
	MemoryMB    int    `json:"memoryMb"`
	DiskGB      int    `json:"diskGb"`
	ImageID     string `json:"imageId"`
	Status      string `json:"status"`
	DriverID    string `json:"driverId"`
	InternalIP  string `json:"internalIp"`
	ExternalIP  string `json:"externalIp"`
	NetBridge   string `json:"netBridge"`
	VLANTag     int    `json:"vlanTag"`
	Description string `json:"description"`
	Protected   bool   `json:"protected"`
	// OSType is the hypervisor's guest-type hint (Proxmox's l26, win11,
	// …). Filled in once per instance, and only used to decide whether
	// "connect" means SSH or RDP.
	OSType    string    `json:"osType"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

const timeFormat = time.RFC3339

func now() string { return time.Now().UTC().Format(timeFormat) }

func parseTime(s string) time.Time {
	t, _ := time.Parse(timeFormat, s)
	return t
}

const instanceCols = `id, name, server_id, zone, machine_type, cpus, memory_mb, disk_gb,
	image_id, status, driver_id, internal_ip, external_ip, net_bridge, vlan_tag,
	description, protected, os_type, created_at, updated_at`

func scanInstance(scan func(dest ...any) error) (*Instance, error) {
	var i Instance
	var created, updated string
	var protected int
	err := scan(&i.ID, &i.Name, &i.ServerID, &i.Zone, &i.MachineType, &i.CPUs, &i.MemoryMB,
		&i.DiskGB, &i.ImageID, &i.Status, &i.DriverID, &i.InternalIP, &i.ExternalIP,
		&i.NetBridge, &i.VLANTag, &i.Description, &protected, &i.OSType, &created, &updated)
	if err != nil {
		return nil, err
	}
	i.Protected = protected != 0
	i.CreatedAt = parseTime(created)
	i.UpdatedAt = parseTime(updated)
	return &i, nil
}

func (s *Store) CreateInstance(ctx context.Context, i *Instance) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO instances (`+instanceCols+`)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		i.ID, i.Name, i.ServerID, i.Zone, i.MachineType, i.CPUs, i.MemoryMB, i.DiskGB,
		i.ImageID, i.Status, i.DriverID, i.InternalIP, i.ExternalIP, i.NetBridge, i.VLANTag,
		i.Description, boolInt(i.Protected), i.OSType, ts, ts)
	i.CreatedAt = parseTime(ts)
	i.UpdatedAt = i.CreatedAt
	return err
}

// SetInstanceOSType records the guest type once the hypervisor has
// been asked for it.
func (s *Store) SetInstanceOSType(ctx context.Context, id, osType string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE instances SET os_type = ? WHERE id = ?`, osType, id)
	return err
}

func (s *Store) SetInstanceProtection(ctx context.Context, id string, protected bool) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE instances SET protected = ?, updated_at = ? WHERE id = ?`,
		boolInt(protected), now(), id)
	return err
}

func (s *Store) ListInstances(ctx context.Context) ([]Instance, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+instanceCols+` FROM instances ORDER BY name`)
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

func (s *Store) GetInstance(ctx context.Context, name string) (*Instance, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+instanceCols+` FROM instances WHERE name = ?`, name)
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
