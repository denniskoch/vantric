package store

import (
	"context"
	"time"
)

// IPAddress is what someone has recorded about one address.
//
// Only addresses with something to say get a row. The full list a
// subnet contains is generated from its prefix, because storing 65k
// mostly-empty rows for a /16 would make the table the size of the
// address space rather than the size of the knowledge.
type IPAddress struct {
	ID       string `json:"id"`
	SubnetID string `json:"subnetId"`
	Address  string `json:"address"`
	Hostname string `json:"hostname"`
	MAC      string `json:"mac"`
	// Status is "assigned" or "reserved": reserved means kept back on
	// purpose, which is different from in use.
	Status      string    `json:"status"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

const ipAddressCols = `id, subnet_id, address, hostname, mac, status,
	description, created_at, updated_at`

func scanIPAddress(scan func(dest ...any) error) (*IPAddress, error) {
	var a IPAddress
	var created, updated string
	if err := scan(&a.ID, &a.SubnetID, &a.Address, &a.Hostname, &a.MAC,
		&a.Status, &a.Description, &created, &updated); err != nil {
		return nil, err
	}
	a.CreatedAt = parseTime(created)
	a.UpdatedAt = parseTime(updated)
	return &a, nil
}

// ListIPAddresses returns every recorded address in one subnet. The
// whole set is read at once because it is the exception rather than
// the range: a subnet with a thousand recorded addresses is a busy
// one.
func (s *Store) ListIPAddresses(ctx context.Context, subnetID string) ([]IPAddress, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+ipAddressCols+` FROM ip_addresses WHERE subnet_id = ?`, subnetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	addresses := []IPAddress{}
	for rows.Next() {
		a, err := scanIPAddress(rows.Scan)
		if err != nil {
			return nil, err
		}
		addresses = append(addresses, *a)
	}
	return addresses, rows.Err()
}

// SaveIPAddress records or updates one address.
func (s *Store) SaveIPAddress(ctx context.Context, a *IPAddress) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO ip_addresses (`+ipAddressCols+`)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (subnet_id, address) DO UPDATE SET
		   hostname = excluded.hostname, mac = excluded.mac,
		   status = excluded.status, description = excluded.description,
		   updated_at = excluded.updated_at`,
		a.ID, a.SubnetID, a.Address, a.Hostname, a.MAC, a.Status,
		a.Description, ts, ts)
	a.UpdatedAt = parseTime(ts)
	return err
}

// DeleteIPAddress forgets one address. Forgetting is the right word:
// the address still exists in the range, we just know nothing about it.
func (s *Store) DeleteIPAddress(ctx context.Context, subnetID, address string) error {
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM ip_addresses WHERE subnet_id = ? AND address = ?`, subnetID, address)
	return err
}
