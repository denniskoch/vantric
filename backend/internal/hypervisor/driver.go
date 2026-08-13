// Package hypervisor defines the abstraction over VM backends (Proxmox,
// mock, and future drivers). The rest of the app only talks to Driver.
package hypervisor

import (
	"context"
	"errors"
	"io"
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
	// ServerID is filled in by the API layer, not the driver.
	ServerID    string `json:"serverId"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Zone        string `json:"zone"`
	Description string `json:"description"`
}

// Disk is a virtual disk attached to an instance.
type Disk struct {
	// ServerID is filled in by the API layer, not the driver.
	ServerID string `json:"serverId"`
	ID       string `json:"id"`      // driver-scoped, e.g. "101/scsi0"
	Name     string `json:"name"`    // volume name, e.g. "vm-101-disk-0"
	InUseBy  string `json:"inUseBy"` // VM name the disk is attached to
	Zone     string `json:"zone"`
	Storage  string `json:"storage"` // storage pool
	SizeGB   int    `json:"sizeGb"`
}

// Volume is a file on a datastore. ISOs, container templates and cloud
// images differ only in content type, so they share this shape.
type Volume struct {
	// ServerID is filled in by the API layer, not the driver.
	ServerID  string `json:"serverId"`
	ID        string `json:"id"` // volume ID, e.g. "local:iso/debian-12.iso"
	Name      string `json:"name"`
	Zone      string `json:"zone"`
	Storage   string `json:"storage"`
	SizeBytes int64  `json:"sizeBytes"`
	// CreatedAt is unix seconds; 0 when unknown.
	CreatedAt int64 `json:"createdAt"`
}

// ISO is an installer/media image available on a datastore.
type ISO = Volume

// CloudImage is a disk image (qcow2/raw) a VM template can be built
// from, held in a datastore's "import" content.
type CloudImage = Volume

// ISODownloadSpec asks the hypervisor to fetch an image itself, so the
// bytes never pass through this app.
type ISODownloadSpec struct {
	Zone     string // node to run the download on
	Storage  string
	Filename string
	URL      string
	// Content is the datastore content type: "iso" (default) or
	// "import" for cloud disk images.
	Content string
	// Checksum is optional; ChecksumAlgorithm must be set alongside it
	// (md5, sha1, sha224, sha256, sha384, sha512).
	Checksum          string
	ChecksumAlgorithm string
	// VerifyCertificates guards TLS verification of the source URL.
	VerifyCertificates bool
}

// ISOUploadSpec describes an image streamed up from the browser.
type ISOUploadSpec struct {
	Zone     string
	Storage  string
	Filename string
	// Content is the datastore content type: "iso" (default) or
	// "import" for cloud disk images.
	Content string
	// SizeBytes must be exact: Proxmox rejects chunked transfer
	// encoding, so the upload needs a Content-Length up front.
	SizeBytes int64
}

// TaskStatus is a long-running hypervisor operation (image import,
// clone, …). Status is "running" or "stopped"; ExitStatus is set once
// stopped ("OK" on success).
type TaskStatus struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	ExitStatus string `json:"exitStatus"`
	Running    bool   `json:"running"`
	Succeeded  bool   `json:"succeeded"`
}

// CTTemplate is a container root-filesystem template (Proxmox vztmpl
// tarball) that containers are provisioned from.
type CTTemplate = Volume

// Bridge is a network bridge a NIC can attach to. Bridges are per-node.
type Bridge struct {
	// ServerID is filled in by the API layer, not the driver.
	ServerID string `json:"serverId"`
	Name     string `json:"name"` // vmbr0
	Zone     string `json:"zone"`
	// CIDR is the bridge's own address, when it has one.
	CIDR      string `json:"cidr"`
	Comment   string `json:"comment"`
	Active    bool   `json:"active"`
	VLANAware bool   `json:"vlanAware"`
	Ports     string `json:"ports"`
}

// Datastore is a storage pool VMs and media live on.
type Datastore struct {
	// ServerID is filled in by the API layer, not the driver.
	ServerID   string `json:"serverId"`
	ID         string `json:"id"` // e.g. "pve1/local-lvm"
	Name       string `json:"name"`
	Zone       string `json:"zone"`
	Type       string `json:"type"`    // lvmthin, zfspool, dir, nfs, ...
	Content    string `json:"content"` // comma-separated content types
	TotalBytes int64  `json:"totalBytes"`
	UsedBytes  int64  `json:"usedBytes"`
	Active     bool   `json:"active"`
	Shared     bool   `json:"shared"`
}

// Snapshot is a point-in-time VM snapshot.
type Snapshot struct {
	// ServerID is filled in by the API layer, not the driver.
	ServerID    string `json:"serverId"`
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

// NIC is one virtual network interface of an instance.
type NIC struct {
	Name      string `json:"name"`  // net0
	Model     string `json:"model"` // virtio, e1000, ...
	MAC       string `json:"mac"`
	Bridge    string `json:"bridge"`
	VLANTag   int    `json:"vlanTag"`
	Firewall  bool   `json:"firewall"`
	IPAddress string `json:"ipAddress"` // from the guest agent, when available
}

// AttachedDisk is a disk as seen from an instance's own config, which
// includes removable media and firmware volumes the datastore-wide Disk
// listing skips.
type AttachedDisk struct {
	Interface string `json:"interface"` // scsi0, ide2, efidisk0, unused0, ...
	Name      string `json:"name"`      // volume name or ISO volume ID
	Storage   string `json:"storage"`
	// SizeBytes is exact: firmware volumes are measured in KB/MB, so a
	// GB-rounded size would misreport them.
	SizeBytes int64 `json:"sizeBytes"`
	// Media is "disk", "cdrom", "efi", "tpm" or "unused".
	Media   string `json:"media"`
	SSD     bool   `json:"ssd"`
	Discard bool   `json:"discard"`
}

// Device is a hardware device attached to an instance. Devices of the
// same kind can repeat (serial0/serial1, usb0…usb4, hostpci0…), so they
// are reported as a list rather than fixed fields.
type Device struct {
	Key   string `json:"key"`   // serial0, usb1, hostpci0
	Kind  string `json:"kind"`  // Serial port, USB device, PCI passthrough, …
	Value string `json:"value"` // raw hypervisor configuration
}

// InstanceDetail is the full hypervisor-side description of an
// instance, read on demand for the detail view. Fields a driver can't
// supply stay zero.
type InstanceDetail struct {
	InstanceState
	Description    string   `json:"description"`
	Tags           []string `json:"tags"`
	OSType         string   `json:"osType"`
	CPUType        string   `json:"cpuType"` // GCP calls this "CPU platform"
	Architecture   string   `json:"architecture"`
	Sockets        int      `json:"sockets"`
	BootOrder      string   `json:"bootOrder"`
	BIOS           string   `json:"bios"`           // seabios, ovmf (UEFI)
	MachineType    string   `json:"machineType"`    // i440fx, q35 (chipset)
	Display        string   `json:"display"`        // std, qxl, virtio, serial0, none
	SCSIController string   `json:"scsiController"` // virtio-scsi-single, lsi, …
	OnBoot         bool     `json:"onBoot"`
	GuestAgent     bool     `json:"guestAgent"`
	HostProtected  bool     `json:"hostProtected"` // hypervisor-side protection flag
	// CreatedAt is unix seconds as recorded by the hypervisor; 0 when unknown.
	CreatedAt     int64          `json:"createdAt"`
	CloudInitUser string         `json:"cloudInitUser"`
	SSHKeys       []string       `json:"sshKeys"`
	NICs          []NIC          `json:"nics"`
	Disks         []AttachedDisk `json:"disks"`
	Devices       []Device       `json:"devices"`
}

// TemplateSpec describes a cloud-image VM template to build. The
// result is a template configured the way cloud images expect: an
// imported disk, a cloud-init drive, and a serial console.
type TemplateSpec struct {
	Name string
	Zone string
	// SourceVolume is a datastore volume holding the disk image, e.g.
	// "local:import/debian-13-genericcloud-amd64.qcow2".
	SourceVolume string
	DiskStorage  string
	// DiskGB grows the imported disk when larger than the image.
	DiskGB        int
	CPUs          int
	MemoryMB      int
	NetworkBridge string
	VLANTag       int
	CloudInitUser string
	SSHKeys       string
	// IPConfig is "dhcp" or a Proxmox ipconfig string.
	IPConfig    string
	BIOS        string // seabios (default) or ovmf
	MachineType string // i440fx or q35
	EnableAgent bool
	Description string
}

// MetricPoint is one sample of an instance's resource usage.
type MetricPoint struct {
	Time           int64   `json:"time"` // unix seconds
	CPUPercent     float64 `json:"cpuPercent"`
	MemoryBytes    float64 `json:"memoryBytes"`
	MaxMemoryBytes float64 `json:"maxMemoryBytes"`
	DiskReadBytes  float64 `json:"diskReadBytes"`
	DiskWriteBytes float64 `json:"diskWriteBytes"`
	NetInBytes     float64 `json:"netInBytes"`
	NetOutBytes    float64 `json:"netOutBytes"`
}

// MetricTimeframe selects the resolution/range of a metrics query.
type MetricTimeframe string

const (
	TimeframeHour  MetricTimeframe = "hour"
	TimeframeDay   MetricTimeframe = "day"
	TimeframeWeek  MetricTimeframe = "week"
	TimeframeMonth MetricTimeframe = "month"
)

// OSInfo is guest operating system detail, reported by a guest agent.
type OSInfo struct {
	// Available is false when no agent answered; other fields are then
	// best-effort from the hypervisor's own config.
	Available     bool   `json:"available"`
	Hostname      string `json:"hostname"`
	Name          string `json:"name"` // "Debian GNU/Linux 12 (bookworm)"
	Version       string `json:"version"`
	KernelRelease string `json:"kernelRelease"`
	KernelVersion string `json:"kernelVersion"`
	Machine       string `json:"machine"`
	OSType        string `json:"osType"` // hypervisor's configured guest type
}

// InstanceState is the driver's live view of an instance.
type InstanceState struct {
	DriverID   string `json:"driverId"`
	Name       string `json:"name"`
	Zone       string `json:"zone"`
	Status     Status `json:"status"`
	CPUs       int    `json:"cpus"`
	MemoryMB   int    `json:"memoryMb"`
	DiskGB     int    `json:"diskGb"`
	InternalIP string `json:"internalIp"`
	ExternalIP string `json:"externalIp"`
	// UptimeSeconds is 0 when the instance is stopped or the driver
	// doesn't report it (List omits it; Get/Describe supply it).
	UptimeSeconds int64 `json:"uptimeSeconds"`
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
	ISOs(ctx context.Context) ([]ISO, error)
	Datastores(ctx context.Context) ([]Datastore, error)
	// DownloadISO has the hypervisor fetch an image from a URL and
	// returns the id of the task doing the work.
	DownloadISO(ctx context.Context, spec ISODownloadSpec) (taskID string, err error)
	// UploadISO streams an image to the hypervisor. content is consumed
	// as it arrives; implementations must not buffer it whole.
	UploadISO(ctx context.Context, spec ISOUploadSpec, content io.Reader) (taskID string, err error)
	// DeleteVolume removes a storage volume (an ISO or a container
	// template) by volume id. taskID may be empty when the backend
	// deletes synchronously.
	DeleteVolume(ctx context.Context, zone, volumeID string) (taskID string, err error)
	// Bridges lists the network bridges instances can attach to.
	Bridges(ctx context.Context) ([]Bridge, error)
	// CloudImages lists disk images available to build templates from.
	CloudImages(ctx context.Context) ([]CloudImage, error)
	// BuildTemplate creates a VM from a cloud image and converts it to a
	// template, reporting each step. It blocks for the whole sequence
	// (disk import can take minutes), so callers run it detached.
	BuildTemplate(ctx context.Context, spec TemplateSpec, progress func(step string)) (imageID string, err error)
	// DeleteImage destroys a VM template. This removes a real VM and its
	// disks, unlike DeleteVolume which removes a file.
	DeleteImage(ctx context.Context, imageID string) (taskID string, err error)
	// TaskStatus reports on a task previously returned by this driver.
	TaskStatus(ctx context.Context, taskID string) (*TaskStatus, error)

	// Create provisions an instance and returns its driver-specific ID.
	// It should return quickly; provisioning continues asynchronously
	// and progress is observed via Get.
	Create(ctx context.Context, spec InstanceSpec) (driverID string, err error)
	Get(ctx context.Context, driverID string) (*InstanceState, error)
	// Describe returns the instance's full configuration. It is read on
	// demand for the detail view (not by the reconciler), so it may make
	// several backend calls.
	Describe(ctx context.Context, driverID string) (*InstanceDetail, error)
	// Metrics returns resource-usage samples, oldest first.
	Metrics(ctx context.Context, driverID string, timeframe MetricTimeframe) ([]MetricPoint, error)
	// OSInfo reports guest OS detail; Available is false without an agent.
	OSInfo(ctx context.Context, driverID string) (*OSInfo, error)
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
	CTTemplates(ctx context.Context) ([]CTTemplate, error)
	ListContainers(ctx context.Context) ([]InstanceState, error)
	GetContainer(ctx context.Context, driverID string) (*InstanceState, error)
	StartContainer(ctx context.Context, driverID string) error
	StopContainer(ctx context.Context, driverID string) error
	RestartContainer(ctx context.Context, driverID string) error
	DeleteContainer(ctx context.Context, driverID string) error
}
