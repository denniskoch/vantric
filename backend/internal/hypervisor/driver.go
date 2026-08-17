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

// Node is a placement target. On Proxmox this is a cluster node — a
// real machine, which is why it carries usage as well as a name.
type Node struct {
	// ServerID is filled in by the API layer, not the driver.
	ServerID string `json:"serverId"`
	ID       string `json:"id"`
	Name     string `json:"name"`
	Status   string `json:"status"`
	// The usage below costs NOTHING EXTRA: a host listing reports it
	// alongside the name we came for, and this app decoded only the
	// name for as long as nodes were nothing but a dropdown. Zero
	// where the backend doesn't say.
	CPUs             int     `json:"cpus"`
	CPUPercent       float64 `json:"cpuPercent"`
	MemoryUsedBytes  int64   `json:"memoryUsedBytes"`
	MemoryTotalBytes int64   `json:"memoryTotalBytes"`
	DiskUsedBytes    int64   `json:"diskUsedBytes"`
	DiskTotalBytes   int64   `json:"diskTotalBytes"`
	UptimeSeconds    int64   `json:"uptimeSeconds"`
}

// NodeStatus is a virtualization host's own description of itself,
// read on demand for the node detail view the way InstanceDetail is
// for a guest. It is the one thing in this console that describes the
// SUBSTRATE rather than something running on it: every other page can
// show a full datastore and a healthy guest while the host underneath
// is out of memory and swapping.
//
// Fields a driver can't supply stay zero, and a zero here means "not
// reported" rather than "zero" — the UI says so rather than printing
// a confident 0.
type NodeStatus struct {
	// ServerID is filled in by the API layer, not the driver.
	ServerID      string `json:"serverId"`
	ID            string `json:"id"`
	Name          string `json:"name"`
	UptimeSeconds int64  `json:"uptimeSeconds"`

	// CPUModel is what GCP calls a CPU platform, spelled the way the
	// silicon spells it: "Intel(R) Core(TM) i5-8500T CPU @ 2.10GHz".
	CPUModel   string `json:"cpuModel"`
	CPUSockets int    `json:"cpuSockets"`
	CPUCores   int    `json:"cpuCores"`
	CPUs       int    `json:"cpus"` // logical, i.e. threads
	CPUMHz     string `json:"cpuMhz"`
	CPUPercent float64 `json:"cpuPercent"`
	// IOWaitPercent is time the host spent waiting on storage. It is
	// reported separately from CPU because it's the number that
	// explains a host which is busy without doing anything.
	IOWaitPercent float64 `json:"ioWaitPercent"`
	// LoadAverage is 1/5/15 minutes, kept as the strings the host
	// reported rather than parsed: they are read, not computed with.
	LoadAverage []string `json:"loadAverage"`

	MemoryTotalBytes int64 `json:"memoryTotalBytes"`
	MemoryUsedBytes  int64 `json:"memoryUsedBytes"`
	SwapTotalBytes   int64 `json:"swapTotalBytes"`
	// SwapUsedBytes is the number worth reading on a lab host: a
	// hypervisor that has started swapping is one whose guests are
	// about to feel it.
	SwapUsedBytes int64 `json:"swapUsedBytes"`
	// KSMSharedBytes is memory reclaimed by same-page merging, which
	// is how a host can run guests whose memory adds up to more than
	// it has.
	KSMSharedBytes int64 `json:"ksmSharedBytes"`
	// Root* is the host's OWN filesystem, not a datastore. Filling it
	// is what stops a hypervisor working, and nothing else in this
	// console looks at it.
	RootTotalBytes int64 `json:"rootTotalBytes"`
	RootUsedBytes  int64 `json:"rootUsedBytes"`

	KernelVersion string `json:"kernelVersion"`
	// Version is the hypervisor software's own version string.
	Version string `json:"version"`
	// BootMode is "efi" or "legacy-bios" where the backend reports it.
	BootMode   string `json:"bootMode"`
	SecureBoot bool   `json:"secureBoot"`
}

// Image is a bootable source for new instances. On Proxmox this is a
// template VM identified by its VMID.
type Image struct {
	// ServerID is filled in by the API layer, not the driver.
	ServerID string `json:"serverId"`
	ID       string `json:"id"`
	Name     string `json:"name"`
	Node     string `json:"node"`
	// Description is the hypervisor's notes field. Its first line is
	// the template's friendly name where someone has written one — the
	// only part of what a picker shows that a machine can't work out.
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	// Architecture and CreatedAt are the rest of what a picker shows —
	// "amd64, built 15 Aug 2026" — and neither should ever be typed by
	// hand: one is a fact about the image, the other goes stale the
	// moment the template is rebuilt.
	Architecture string `json:"architecture"`
	// CreatedAt is unix seconds; 0 when the hypervisor doesn't record it.
	CreatedAt int64 `json:"createdAt"`
}

// Disk is a virtual disk attached to an instance.
type Disk struct {
	// ServerID is filled in by the API layer, not the driver.
	ServerID string `json:"serverId"`
	ID       string `json:"id"`      // driver-scoped, e.g. "101/scsi0"
	Name     string `json:"name"`    // volume name, e.g. "vm-101-disk-0"
	InUseBy  string `json:"inUseBy"` // VM name the disk is attached to
	Node     string `json:"node"`
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
	Node      string `json:"node"`
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

// Backup is a guest backup archive held on a datastore. It carries
// more than a plain volume: a backup outlives the guest it came from,
// so what it restores to has to travel with it.
type Backup struct {
	// ServerID is filled in by the API layer, not the driver.
	ServerID  string `json:"serverId"`
	ID        string `json:"id"` // volume ID
	Name      string `json:"name"`
	Node      string `json:"node"`
	Storage   string `json:"storage"`
	SizeBytes int64  `json:"sizeBytes"`
	// CreatedAt is unix seconds; 0 when unknown.
	CreatedAt int64 `json:"createdAt"`
	// VMID identifies the guest; 0 when the archive doesn't say.
	VMID int `json:"vmid"`
	// GuestName is empty once the guest is gone — which is exactly
	// when a backup matters most.
	GuestName string `json:"guestName"`
	// GuestType is "qemu" or "lxc".
	GuestType string `json:"guestType"`
	// Format is the archive format, e.g. vma.zst or tar.zst.
	Format string `json:"format"`
	Notes  string `json:"notes"`
	// Protected backups are exempt from retention pruning.
	Protected bool `json:"protected"`
}

// ISODownloadSpec asks the hypervisor to fetch an image itself, so the
// bytes never pass through this app.
type ISODownloadSpec struct {
	Node     string // node to run the download on
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
	Node     string
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
	Node     string `json:"node"`
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
	Node       string `json:"node"`
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
	Node        string `json:"node"`
	Description string `json:"description"`
	// CreatedAt is unix seconds; 0 when the hypervisor doesn't report it.
	CreatedAt int64 `json:"createdAt"`
	// IncludesRAM reports whether the snapshot captured VM memory state.
	IncludesRAM bool `json:"includesRam"`
}

// IPConfig is one NIC's cloud-init addressing. It stays structured
// here; drivers format it in their own syntax.
type IPConfig struct {
	DHCP    bool
	Address string // CIDR, e.g. 192.168.1.50/24
	Gateway string
	// DHCP6, SLAAC and Address6 are mutually exclusive; SLAAC means
	// "derive from router advertisements".
	DHCP6    bool
	SLAAC    bool
	Address6 string
	Gateway6 string
}

// CloudInit is the guest configuration handed to a VM's cloud-init
// datasource. Empty fields are left to the image's own defaults.
type CloudInit struct {
	User string
	// Password is sent to the hypervisor to hash; it is never read back.
	Password string
	SSHKeys  string // authorized public keys, one per line
	// Nameservers and SearchDomain override the host's DNS settings.
	Nameservers  string
	SearchDomain string
	// UpgradePackages runs a package upgrade on first boot.
	UpgradePackages bool
	// Datasource selects the cloud-init format ("nocloud",
	// "configdrive2"); empty leaves the hypervisor default.
	Datasource string
	IP         IPConfig
}

// InstanceSpec describes an instance to create.
type InstanceSpec struct {
	Name     string
	Node     string
	CPUs     int
	MemoryMB int
	DiskGB   int
	ImageID  string

	// Networking (optional). Empty bridge keeps the image's network config.
	NetworkBridge string
	VLANTag       int

	// CloudInit is optional; drivers may ignore it if unsupported.
	CloudInit CloudInit

	// Description is free-form metadata, mirrored to the hypervisor
	// where supported.
	Description string

	// Serial is written to the guest's SMBIOS at creation, where device
	// inventory reads it as hardware_serial. Creation is the only good
	// moment: SMBIOS is read at boot, so setting it later costs a
	// reboot, and setting it on a TEMPLATE would give every clone the
	// same one — the duplicate-host problem it exists to avoid. Empty
	// leaves the hypervisor's default, which is no serial at all.
	Serial string
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
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	OSType      string   `json:"osType"`
	// UUID is the guest's SMBIOS system UUID — what the guest itself
	// reads as /sys/class/dmi/id/product_uuid, and what inventory and
	// monitoring tools record as its identity. It's the only handle
	// that survives a rename, a migration and a vmid being reused, so
	// it's the join key between a record here and anything reporting
	// from inside the machine.
	UUID string `json:"uuid"`
	// Serial is the SMBIOS system serial number, which a hypervisor
	// leaves EMPTY unless somebody sets one. Device inventory keys on
	// it — osquery reports it as hardware_serial — so a fleet of VMs
	// that all report nothing is a fleet its own tooling can't tell
	// apart. Reported here so the gap is visible.
	Serial         string `json:"serial"`
	CPUType        string `json:"cpuType"` // GCP calls this "CPU platform"
	Architecture   string `json:"architecture"`
	Sockets        int    `json:"sockets"`
	BootOrder      string `json:"bootOrder"`
	BIOS           string `json:"bios"`           // seabios, ovmf (UEFI)
	MachineType    string `json:"machineType"`    // i440fx, q35 (chipset)
	Display        string `json:"display"`        // std, qxl, virtio, serial0, none
	SCSIController string `json:"scsiController"` // virtio-scsi-single, lsi, …
	OnBoot         bool   `json:"onBoot"`
	GuestAgent     bool   `json:"guestAgent"`
	HostProtected  bool   `json:"hostProtected"` // hypervisor-side protection flag
	// CreatedAt is unix seconds as recorded by the hypervisor; 0 when unknown.
	CreatedAt int64 `json:"createdAt"`
	// CloudInit is whether the guest has a cloud-init drive at all.
	// Without one the settings below are inert: Proxmox still reports
	// its defaults for them, and showing those as though they applied
	// describes a machine that doesn't exist.
	CloudInit       bool           `json:"cloudInit"`
	CloudInitUser   string         `json:"cloudInitUser"`
	SSHKeys         []string       `json:"sshKeys"`
	Nameservers     string         `json:"nameservers"`
	SearchDomain    string         `json:"searchDomain"`
	UpgradePackages bool           `json:"upgradePackages"`
	Datasource      string         `json:"datasource"`
	IPConfig        string         `json:"ipConfig"`
	NICs            []NIC          `json:"nics"`
	Disks           []AttachedDisk `json:"disks"`
	Devices         []Device       `json:"devices"`
}

// TemplateSpec describes a cloud-image VM template to build. The
// result is a template configured the way cloud images expect: an
// imported disk, a cloud-init drive, and a serial console.
type TemplateSpec struct {
	Name string
	Node string
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
	CloudInit     CloudInit
	BIOS          string // seabios (default) or ovmf
	MachineType   string // i440fx or q35
	EnableAgent   bool
	Description   string
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
	Node       string `json:"node"`
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
	Nodes(ctx context.Context) ([]Node, error)
	// NodeStatus describes one host in detail. Like Describe it is read
	// on demand for a detail view, not by the reconciler, so it may
	// make several backend calls.
	NodeStatus(ctx context.Context, node string) (*NodeStatus, error)
	// NodeMetrics returns the host's own resource-usage samples, in the
	// same shape as an instance's — a host is a machine too, and the
	// question "was this busy an hour ago" is the same question.
	NodeMetrics(ctx context.Context, node string, timeframe MetricTimeframe) ([]MetricPoint, error)
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
	DeleteVolume(ctx context.Context, node, volumeID string) (taskID string, err error)
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
	// SetDescription writes a guest's notes on the hypervisor, which is
	// where they belong: the hypervisor's own console shows the same
	// field, so notes written here are not a private copy that drifts.
	// Templates are VMs, so this addresses them too.
	SetDescription(ctx context.Context, driverID, description string) error
	// SetName renames the guest ON THE HYPERVISOR. It is a label
	// there and nothing more: the OS inside never sees it, so this
	// changes no hostname and touches nothing in the guest.
	SetName(ctx context.Context, driverID, name string) error
}

// BackupDriver is an optional capability for backends that keep a
// catalog of guest backups. Not every hypervisor does, and one that
// doesn't should stay simple — so this is a type assertion like
// ContainerDriver, and servers without it are skipped in the listing
// rather than reporting an error.
type BackupDriver interface {
	Backups(ctx context.Context) ([]Backup, error)
}

// ConsoleUser is the account the console signs in as, and the key it
// signs in with. Sudo is off unless the operator turns it on: creating
// the account is implied by clicking Connect, granting root across the
// fleet is not.
type ConsoleUser struct {
	Username  string
	PublicKey string
	Sudo      bool
}

// GuestProvisioner is an optional capability for backends that can
// reach inside a running guest without credentials for it — Proxmox
// through the QEMU guest agent. It exists to solve one problem: a VM
// this console adopted has never heard of the console's key, so the
// first Connect would fail forever.
//
// The method is deliberately this narrow. A general Exec would be far
// easier to write and would turn the console into an unaudited root
// shell on every guest — no sudo, nothing in the guest's auth log. So
// the capability that crosses this boundary is "make an ordinary SSH
// account exist", once, and everything afterwards goes over SSH like
// any other client: real authentication, real sudo, real logging.
//
// Implementations must be idempotent — Connect may call this whenever
// authentication fails.
type GuestProvisioner interface {
	EnsureConsoleUser(ctx context.Context, driverID string, user ConsoleUser) error
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
