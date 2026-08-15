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
	OSType string `json:"osType"`
	// Serial is the SMBIOS serial number, empty unless somebody set
	// one on the hypervisor. Inventory tools key on it.
	Serial string `json:"serial"`
	// UUID is the guest's SMBIOS system UUID, filled in beside OSType.
	// It is what the guest sees as its own identity, so it's what
	// correlates this record with inventory and monitoring that run
	// inside the machine — and unlike the vmid, it isn't reused.
	UUID      string    `json:"uuid"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

const timeFormat = time.RFC3339

func now() string { return time.Now().UTC().Format(timeFormat) }

func parseTime(s string) time.Time {
	t, _ := time.Parse(timeFormat, s)
	return t
}

const instanceCols = `id, name, server_id, zone, cpus, memory_mb, disk_gb,
	image_id, status, driver_id, internal_ip, external_ip, net_bridge, vlan_tag,
	description, protected, os_type, uuid, serial, created_at, updated_at`

func scanInstance(scan func(dest ...any) error) (*Instance, error) {
	var i Instance
	var created, updated string
	var protected int
	err := scan(&i.ID, &i.Name, &i.ServerID, &i.Zone, &i.CPUs, &i.MemoryMB,
		&i.DiskGB, &i.ImageID, &i.Status, &i.DriverID, &i.InternalIP, &i.ExternalIP,
		&i.NetBridge, &i.VLANTag, &i.Description, &protected, &i.OSType, &i.UUID,
		&i.Serial, &created, &updated)
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
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		i.ID, i.Name, i.ServerID, i.Zone, i.CPUs, i.MemoryMB, i.DiskGB,
		i.ImageID, i.Status, i.DriverID, i.InternalIP, i.ExternalIP, i.NetBridge, i.VLANTag,
		i.Description, boolInt(i.Protected), i.OSType, i.UUID, i.Serial, ts, ts)
	i.CreatedAt = parseTime(ts)
	i.UpdatedAt = i.CreatedAt
	return err
}

// SetInstanceFacts records the things a guest is born with and never
// changes — its configured type and its SMBIOS UUID — once the
// hypervisor has been asked for them.
func (s *Store) SetInstanceFacts(ctx context.Context, id, osType, uuid, serial string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE instances SET os_type = ?, uuid = ?, serial = ? WHERE id = ?`,
		osType, uuid, serial, id)
	return err
}

// SetInstanceDescription mirrors what was just written to the
// hypervisor, so the list is right without waiting for a sweep. The
// hypervisor stays the source of truth; this is the copy.
func (s *Store) SetInstanceDescription(ctx context.Context, id, description string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE instances SET description = ?, updated_at = ? WHERE id = ?`,
		description, now(), id)
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

// GetInstanceByDriverID finds the record for one VM on one server,
// whatever it ended up being called — which is how the create flow
// recognises a VM the reconciler adopted while it was still working.
func (s *Store) GetInstanceByDriverID(ctx context.Context, serverID, driverID string) (*Instance, error) {
	inst, err := scanInstance(s.db.QueryRowContext(ctx,
		`SELECT `+instanceCols+` FROM instances WHERE server_id = ? AND driver_id = ?`,
		serverID, driverID).Scan)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	return inst, err
}

// ClaimInstance takes over a record the reconciler adopted a moment
// before this app's own create finished writing its own — the two race
// whenever a VM appears on the hypervisor before the handler returns.
// Everything the create flow knows and adoption couldn't is written on
// top: the image it came from, the network, the description, and
// whether deletion protection was actually asked for.
func (s *Store) ClaimInstance(ctx context.Context, i *Instance) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE instances SET name = ?, driver_id = ?, zone = ?, cpus = ?, memory_mb = ?,
		 disk_gb = ?, image_id = ?, net_bridge = ?, vlan_tag = ?, description = ?,
		 protected = ?, updated_at = ? WHERE id = ?`,
		i.Name, i.DriverID, i.Zone, i.CPUs, i.MemoryMB, i.DiskGB, i.ImageID, i.NetBridge,
		i.VLANTag, i.Description, boolInt(i.Protected), now(), i.ID)
	return err
}

// UpdateInstanceShape syncs the metadata the hypervisor owns: what the
// VM is called and how big it is.
//
// It exists because adoption is a race. A VM that appears in the
// hypervisor's cluster listing while it is still being created has no
// name and no sizing yet, and a record written from that snapshot used
// to keep those zeroes forever. It also means renaming or resizing a
// guest in the hypervisor shows up here instead of quietly drifting.
func (s *Store) UpdateInstanceShape(ctx context.Context, id, name, zone string, cpus, memoryMB, diskGB int) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE instances SET name = ?, zone = ?, cpus = ?, memory_mb = ?, disk_gb = ?,
		 updated_at = ? WHERE id = ?`,
		name, zone, cpus, memoryMB, diskGB, now(), id)
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
