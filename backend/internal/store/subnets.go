package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Subnet is an address range this lab has assigned a meaning to.
//
// This is the one place the console keeps network facts of its own,
// and Source is why that isn't a second registry: it records where a
// range came from. A subnet typed in by hand is "manual" and this
// console owns it, because a lab without an IPAM has nowhere else to
// write it down. One discovered from a controller will carry that
// controller's name instead and be read-only here, the same rule
// every other section follows — the owner of the data stays the owner.
//
// It earns its place on the correlation the app already promises:
// what's running, versus what DNS publishes, versus what the addresses
// were meant to be for.
type Subnet struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Source is "manual" today. Anything else names the system that
	// reported the range, and marks it read-only in this console.
	Source string `json:"source"`
	// SourceID is the upstream object's own id, empty for a manual
	// range. It is how a re-import recognises what it already created
	// instead of making a second copy.
	SourceID string `json:"sourceId"`
	// StackType is "IPv4" for now. IPv6 is a second pair of fields
	// rather than a second meaning, so this is the seam for it.
	StackType string `json:"stackType"`
	// VLAN is the 802.1Q tag, or 0 for an untagged range. Stored
	// because a subnet and its VLAN are the same fact to everyone who
	// has to configure one.
	VLAN        int       `json:"vlan"`
	IPv4Range   string    `json:"ipv4Range"`
	IPv4Gateway string    `json:"ipv4Gateway"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// SourceManual is a range somebody typed in here.
const SourceManual = "manual"

const subnetCols = `id, name, source, source_id, stack_type, vlan, ipv4_range, ipv4_gateway,
	description, created_at, updated_at`

func scanSubnet(scan func(dest ...any) error) (*Subnet, error) {
	var s Subnet
	var created, updated string
	if err := scan(&s.ID, &s.Name, &s.Source, &s.SourceID, &s.StackType, &s.VLAN, &s.IPv4Range,
		&s.IPv4Gateway, &s.Description, &created, &updated); err != nil {
		return nil, err
	}
	s.CreatedAt = parseTime(created)
	s.UpdatedAt = parseTime(updated)
	return &s, nil
}

func (s *Store) ListSubnets(ctx context.Context) ([]Subnet, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+subnetCols+` FROM subnets ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	subnets := []Subnet{}
	for rows.Next() {
		subnet, err := scanSubnet(rows.Scan)
		if err != nil {
			return nil, err
		}
		subnets = append(subnets, *subnet)
	}
	return subnets, rows.Err()
}

func (s *Store) GetSubnet(ctx context.Context, id string) (*Subnet, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+subnetCols+` FROM subnets WHERE id = ?`, id)
	subnet, err := scanSubnet(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return subnet, err
}

func (s *Store) CreateSubnet(ctx context.Context, subnet *Subnet) error {
	ts := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO subnets (`+subnetCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		subnet.ID, subnet.Name, subnet.Source, subnet.SourceID, subnet.StackType, subnet.VLAN, subnet.IPv4Range,
		subnet.IPv4Gateway, subnet.Description, ts, ts)
	subnet.CreatedAt = parseTime(ts)
	subnet.UpdatedAt = subnet.CreatedAt
	return err
}

func (s *Store) UpdateSubnet(ctx context.Context, subnet *Subnet) error {
	ts := now()
	res, err := s.db.ExecContext(ctx,
		`UPDATE subnets SET name = ?, stack_type = ?, vlan = ?, ipv4_range = ?,
		        ipv4_gateway = ?, description = ?, updated_at = ? WHERE id = ?`,
		subnet.Name, subnet.StackType, subnet.VLAN, subnet.IPv4Range, subnet.IPv4Gateway,
		subnet.Description, ts, subnet.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	subnet.UpdatedAt = parseTime(ts)
	return nil
}

func (s *Store) DeleteSubnet(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM subnets WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
