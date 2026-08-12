// Package hypervisor defines the abstraction over VM backends (Proxmox,
// mock, and future drivers). The rest of the app only talks to Driver.
package hypervisor

import (
	"context"
	"errors"
)

// Status values mirror GCP Compute Engine instance states.
type Status string

const (
	StatusProvisioning Status = "PROVISIONING"
	StatusStaging      Status = "STAGING"
	StatusRunning      Status = "RUNNING"
	StatusStopping     Status = "STOPPING"
	StatusTerminated   Status = "TERMINATED" // stopped, in GCP parlance
)

// ErrNotFound is returned when a driver instance no longer exists.
var ErrNotFound = errors.New("hypervisor: instance not found")

// Zone is a placement target. On Proxmox this is a cluster node.
type Zone struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

// Image is a bootable source for new instances. On Proxmox this is a
// template VM identified by its VMID.
type Image struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// Disk is a virtual disk attached to an instance.
type Disk struct {
	ID      string `json:"id"`      // driver-scoped, e.g. "101/scsi0"
	Name    string `json:"name"`    // volume name, e.g. "vm-101-disk-0"
	InUseBy string `json:"inUseBy"` // VM name the disk is attached to
	Zone    string `json:"zone"`
	Storage string `json:"storage"` // storage pool
	SizeGB  int    `json:"sizeGb"`
}

// Snapshot is a point-in-time VM snapshot.
type Snapshot struct {
	ID          string `json:"id"` // driver-scoped, e.g. "101/pre-upgrade"
	Name        string `json:"name"`
	VMName      string `json:"vmName"`
	Zone        string `json:"zone"`
	Description string `json:"description"`
	// CreatedAt is unix seconds; 0 when the hypervisor doesn't report it.
	CreatedAt int64 `json:"createdAt"`
	// IncludesRAM reports whether the snapshot captured VM memory state.
	IncludesRAM bool `json:"includesRam"`
}

// InstanceSpec describes an instance to create.
type InstanceSpec struct {
	Name     string
	Zone     string
	CPUs     int
	MemoryMB int
	DiskGB   int
	ImageID  string

	// Networking (optional). Empty bridge keeps the image's network config.
	NetworkBridge string
	VLANTag       int

	// Cloud-init access (optional; drivers may ignore if unsupported).
	CloudInitUser string
	SSHKeys       string // authorized public keys, one per line

	// Description is free-form metadata, mirrored to the hypervisor
	// where supported.
	Description string
}

// InstanceState is the driver's live view of an instance.
type InstanceState struct {
	DriverID   string
	Name       string
	Zone       string
	Status     Status
	CPUs       int
	MemoryMB   int
	DiskGB     int
	InternalIP string
	ExternalIP string
}

// Driver is the hypervisor backend contract. Implementations must be
// safe for concurrent use.
type Driver interface {
	// Name identifies the driver, e.g. "proxmox" or "mock".
	Name() string
	Zones(ctx context.Context) ([]Zone, error)
	Images(ctx context.Context) ([]Image, error)
	Disks(ctx context.Context) ([]Disk, error)
	Snapshots(ctx context.Context) ([]Snapshot, error)

	// Create provisions an instance and returns its driver-specific ID.
	// It should return quickly; provisioning continues asynchronously
	// and progress is observed via Get.
	Create(ctx context.Context, spec InstanceSpec) (driverID string, err error)
	Get(ctx context.Context, driverID string) (*InstanceState, error)
	// List returns every (non-template) VM on the backend in one cheap
	// call. Implementations may omit IPs here; callers use Get for
	// per-instance detail.
	List(ctx context.Context) ([]InstanceState, error)
	Start(ctx context.Context, driverID string) error
	Stop(ctx context.Context, driverID string) error
	Reset(ctx context.Context, driverID string) error
	Delete(ctx context.Context, driverID string) error
}

// ContainerDriver is an optional capability for backends that support
// system containers (Proxmox LXC). Containers are deliberately a
// separate resource from VMs: they list, provision, and behave
// differently. Check with a type assertion:
//
//	cd, ok := driver.(hypervisor.ContainerDriver)
type ContainerDriver interface {
	ListContainers(ctx context.Context) ([]InstanceState, error)
	GetContainer(ctx context.Context, driverID string) (*InstanceState, error)
	StartContainer(ctx context.Context, driverID string) error
	StopContainer(ctx context.Context, driverID string) error
	RestartContainer(ctx context.Context, driverID string) error
	DeleteContainer(ctx context.Context, driverID string) error
}
