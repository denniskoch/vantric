// Package mock is an in-memory hypervisor driver for development. It
// simulates realistic async state transitions so the UI behaves like it
// would against a real cluster.
package mock

import (
	"context"
	"fmt"
	"io"
	"math"
	"math/rand"
	"sync"
	"time"

	"github.com/google/uuid"

	"lab-cloud-manager/internal/hypervisor"
)

type instance struct {
	state   hypervisor.InstanceState
	created time.Time
	// uuid stands in for the SMBIOS system UUID a real guest carries,
	// so the fields that correlate with outside tools have something
	// to show in development.
	uuid        string
	serial      string
	description string
	// pending transition, applied when 'at' passes
	next hypervisor.Status
	at   time.Time
}

// task is a simulated long-running import.
type task struct {
	done    time.Time
	iso     hypervisor.ISO
	applied bool
}

type Driver struct {
	mu          sync.Mutex
	nextID      int
	nextTask    int
	vms         map[string]*instance
	cts         map[string]*instance
	isos        []hypervisor.ISO
	images      []hypervisor.Image
	ctTemplates []hypervisor.CTTemplate
	tasks       map[string]*task
}

func New() *Driver {
	d := &Driver{
		nextID: 100,
		vms:    map[string]*instance{},
		cts:    map[string]*instance{},
		tasks:  map[string]*task{},
		isos: []hypervisor.ISO{
			{ID: "local:iso/debian-12.7.0-amd64-netinst.iso", Name: "debian-12.7.0-amd64-netinst.iso",
				Zone: "lab-node-a", Storage: "local", SizeBytes: 663748608, CreatedAt: time.Now().Add(-90 * 24 * time.Hour).Unix()},
			{ID: "local:iso/ubuntu-24.04.1-live-server-amd64.iso", Name: "ubuntu-24.04.1-live-server-amd64.iso",
				Zone: "lab-node-a", Storage: "local", SizeBytes: 2754981888, CreatedAt: time.Now().Add(-30 * 24 * time.Hour).Unix()},
		},
		images: []hypervisor.Image{
			{ID: "9000", Name: "debian-12-cloudinit", Zone: "lab-node-a",
				Description:  "Debian GNU/Linux 12 (bookworm)\ncloud-init, qemu-guest-agent",
				Architecture: "x86_64", CreatedAt: time.Now().Add(-40 * 24 * time.Hour).Unix()},
			{ID: "9001", Name: "ubuntu-2404-cloudinit", Zone: "lab-node-a",
				Architecture: "x86_64", CreatedAt: time.Now().Add(-12 * 24 * time.Hour).Unix()},
			{ID: "9002", Name: "alpine-321", Zone: "lab-node-b",
				Architecture: "x86_64", CreatedAt: time.Now().Add(-5 * 24 * time.Hour).Unix()},
		},
		ctTemplates: []hypervisor.CTTemplate{
			{ID: "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst", Name: "debian-12-standard_12.7-1_amd64.tar.zst",
				Zone: "lab-node-a", Storage: "local", SizeBytes: 130150400, CreatedAt: time.Now().Add(-60 * 24 * time.Hour).Unix()},
			{ID: "local:vztmpl/alpine-3.21-default_20241217_amd64.tar.xz", Name: "alpine-3.21-default_20241217_amd64.tar.xz",
				Zone: "lab-node-a", Storage: "local", SizeBytes: 3355443, CreatedAt: time.Now().Add(-20 * 24 * time.Hour).Unix()},
		},
	}
	// Seed a couple of containers so the CT pages have data in dev.
	d.cts["200"] = &instance{
		created: time.Now(),
		state: hypervisor.InstanceState{
			DriverID: "200", Name: "pihole", Zone: "lab-node-a",
			Status: hypervisor.StatusRunning, CPUs: 1, MemoryMB: 512, DiskGB: 4,
			InternalIP: "10.20.0.53",
		},
	}
	d.cts["201"] = &instance{
		created: time.Now(),
		state: hypervisor.InstanceState{
			DriverID: "201", Name: "docker-host", Zone: "lab-node-b",
			Status: hypervisor.StatusTerminated, CPUs: 2, MemoryMB: 2048, DiskGB: 16,
		},
	}
	return d
}

func (d *Driver) Name() string { return "mock" }

func (d *Driver) Zones(ctx context.Context) ([]hypervisor.Zone, error) {
	return []hypervisor.Zone{
		{ID: "lab-node-a", Name: "lab-node-a", Status: "online"},
		{ID: "lab-node-b", Name: "lab-node-b", Status: "online"},
	}, nil
}

func (d *Driver) Images(ctx context.Context) ([]hypervisor.Image, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]hypervisor.Image{}, d.images...), nil
}

func (d *Driver) Bridges(ctx context.Context) ([]hypervisor.Bridge, error) {
	return []hypervisor.Bridge{
		{Name: "vmbr0", Zone: "lab-node-a", CIDR: "10.20.0.2/24", Comment: "lab LAN",
			Active: true, VLANAware: true, Ports: "eno1"},
		{Name: "vmbr1", Zone: "lab-node-a", Comment: "isolated", Active: true},
		{Name: "vmbr0", Zone: "lab-node-b", CIDR: "10.20.0.3/24", Active: true, VLANAware: true, Ports: "eno1"},
	}, nil
}

func (d *Driver) CloudImages(ctx context.Context) ([]hypervisor.CloudImage, error) {
	return []hypervisor.CloudImage{
		{ID: "local:import/debian-13-genericcloud-amd64.qcow2", Name: "debian-13-genericcloud-amd64.qcow2",
			Zone: "lab-node-a", Storage: "local", SizeBytes: 361758720, CreatedAt: time.Now().Add(-3 * 24 * time.Hour).Unix()},
		{ID: "local:import/noble-server-cloudimg-amd64.img", Name: "noble-server-cloudimg-amd64.img",
			Zone: "lab-node-a", Storage: "local", SizeBytes: 601309184, CreatedAt: time.Now().Add(-9 * 24 * time.Hour).Unix()},
	}, nil
}

// BuildTemplate walks the same steps as the real driver so the wizard's
// progress display can be exercised in development.
func (d *Driver) BuildTemplate(ctx context.Context, spec hypervisor.TemplateSpec, progress func(string)) (string, error) {
	for _, step := range []string{
		"Allocating a VM ID",
		"Creating the VM and importing the disk",
		fmt.Sprintf("Resizing the disk to %d GB", spec.DiskGB),
		"Converting to a template",
	} {
		if progress != nil {
			progress(step)
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.nextID++
	id := fmt.Sprintf("%d", d.nextID)
	d.images = append(d.images, hypervisor.Image{
		ID: id, Name: spec.Name, Zone: spec.Zone,
		Description:  "Built from " + spec.SourceVolume,
		Architecture: "x86_64", CreatedAt: time.Now().Unix(),
	})
	if progress != nil {
		progress("Template ready")
	}
	return id, nil
}

func (d *Driver) DeleteImage(ctx context.Context, imageID string) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for i, img := range d.images {
		if img.ID == imageID {
			d.images = append(d.images[:i], d.images[i+1:]...)
			return "", nil
		}
	}
	return "", hypervisor.ErrNotFound
}

// Disks reports one boot disk per VM, mimicking Proxmox naming.
func (d *Driver) Disks(ctx context.Context) ([]hypervisor.Disk, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	disks := []hypervisor.Disk{}
	for id, vm := range d.vms {
		disks = append(disks, hypervisor.Disk{
			ID:      id + "/scsi0",
			Name:    fmt.Sprintf("vm-%s-disk-0", id),
			InUseBy: vm.state.Name,
			Zone:    vm.state.Zone,
			Storage: "local-lvm",
			SizeGB:  vm.state.DiskGB,
		})
	}
	return disks, nil
}

// Snapshots reports one post-provision snapshot per VM so the UI has
// something realistic to show in development.
func (d *Driver) Snapshots(ctx context.Context) ([]hypervisor.Snapshot, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	snapshots := []hypervisor.Snapshot{}
	for id, vm := range d.vms {
		snapshots = append(snapshots, hypervisor.Snapshot{
			ID:          id + "/clean-install",
			Name:        "clean-install",
			VMName:      vm.state.Name,
			Zone:        vm.state.Zone,
			Description: "Automatic post-provision snapshot (mock)",
			CreatedAt:   vm.created.Unix(),
		})
	}
	return snapshots, nil
}

func (d *Driver) Create(ctx context.Context, spec hypervisor.InstanceSpec) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.nextID++
	id := fmt.Sprintf("%d", d.nextID)
	d.vms[id] = &instance{
		created: time.Now(),
		uuid:    uuid.NewString(),
		serial:  spec.Serial,
		state: hypervisor.InstanceState{
			DriverID: id,
			Name:     spec.Name,
			Zone:     spec.Zone,
			Status:   hypervisor.StatusProvisioning,
			CPUs:     spec.CPUs,
			MemoryMB: spec.MemoryMB,
			DiskGB:   spec.DiskGB,
		},
		next: hypervisor.StatusStaging,
		at:   time.Now().Add(3 * time.Second),
	}
	return id, nil
}

// tick applies any due transition. Called with lock held.
func (d *Driver) tick(vm *instance) {
	if vm.next == "" || time.Now().Before(vm.at) {
		return
	}
	vm.state.Status = vm.next
	switch vm.next {
	case hypervisor.StatusStaging:
		vm.next = hypervisor.StatusRunning
		vm.at = time.Now().Add(4 * time.Second)
	case hypervisor.StatusRunning:
		if vm.state.InternalIP == "" {
			vm.state.InternalIP = fmt.Sprintf("10.20.0.%d", 10+rand.Intn(240))
		}
		vm.next = ""
	case hypervisor.StatusTerminated:
		vm.next = ""
	default:
		vm.next = ""
	}
}

func (d *Driver) List(ctx context.Context) ([]hypervisor.InstanceState, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	states := []hypervisor.InstanceState{}
	for _, vm := range d.vms {
		d.tick(vm)
		states = append(states, vm.state)
	}
	return states, nil
}

func (d *Driver) Get(ctx context.Context, driverID string) (*hypervisor.InstanceState, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	vm, ok := d.vms[driverID]
	if !ok {
		return nil, hypervisor.ErrNotFound
	}
	d.tick(vm)
	s := vm.state
	return &s, nil
}

func (d *Driver) Describe(ctx context.Context, driverID string) (*hypervisor.InstanceDetail, error) {
	d.mu.Lock()
	vm, ok := d.vms[driverID]
	if !ok {
		d.mu.Unlock()
		return nil, hypervisor.ErrNotFound
	}
	d.tick(vm)
	state := vm.state
	created := vm.created
	guestUUID := vm.uuid
	serial := vm.serial
	description := vm.description
	if description == "" {
		description = "Mock instance for development"
	}
	d.mu.Unlock()

	return &hypervisor.InstanceDetail{
		InstanceState:  state,
		Description:    description,
		Tags:           []string{"mock", "lab"},
		OSType:         "l26",
		UUID:           guestUUID,
		Serial:         serial,
		CPUType:        "host",
		Architecture:   "x86_64",
		Sockets:        1,
		BootOrder:      "order=scsi0;net0",
		BIOS:           "ovmf",
		MachineType:    "q35",
		Display:        "std (default)",
		SCSIController: "virtio-scsi-single",
		OnBoot:         true,
		GuestAgent:     true,
		CreatedAt:      created.Unix(),
		CloudInitUser:  "labadmin",
		SSHKeys:        []string{"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAMOCKKEY labadmin@mock"},
		NICs: []hypervisor.NIC{{
			Name: "net0", Model: "virtio", MAC: "BC:24:11:00:" + driverID[:2] + ":0A",
			Bridge: "vmbr0", Firewall: true, IPAddress: state.InternalIP,
		}},
		Disks: []hypervisor.AttachedDisk{
			{Interface: "scsi0", Name: fmt.Sprintf("vm-%s-disk-0", driverID), Storage: "local-lvm",
				SizeBytes: int64(state.DiskGB) << 30, Media: "disk", SSD: true, Discard: true},
			{Interface: "ide2", Name: "iso/debian-12.7.0-amd64-netinst.iso", Storage: "local", Media: "cdrom"},
			{Interface: "efidisk0", Name: fmt.Sprintf("vm-%s-disk-1", driverID), Storage: "local-lvm", Media: "efi"},
		},
		Devices: []hypervisor.Device{
			{Key: "serial0", Kind: "Serial port", Value: "socket"},
			{Key: "usb0", Kind: "USB device", Value: "host=1d6b:0002"},
		},
	}, nil
}

// Metrics synthesizes a plausible series so the observability charts
// have something to render in development.
func (d *Driver) Metrics(ctx context.Context, driverID string, timeframe hypervisor.MetricTimeframe) ([]hypervisor.MetricPoint, error) {
	d.mu.Lock()
	vm, ok := d.vms[driverID]
	if !ok {
		d.mu.Unlock()
		return nil, hypervisor.ErrNotFound
	}
	maxMem := float64(vm.state.MemoryMB) * 1024 * 1024
	running := vm.state.Status == hypervisor.StatusRunning
	d.mu.Unlock()

	step, count := int64(60), 60
	switch timeframe {
	case hypervisor.TimeframeDay:
		step, count = 300, 288
	case hypervisor.TimeframeWeek:
		step, count = 1800, 336
	case hypervisor.TimeframeMonth:
		step, count = 7200, 360
	}
	start := time.Now().Unix() - int64(count)*step
	points := make([]hypervisor.MetricPoint, 0, count)
	for i := range count {
		t := start + int64(i)*step
		p := hypervisor.MetricPoint{Time: t, MaxMemoryBytes: maxMem}
		if running {
			phase := float64(i) / 8
			p.CPUPercent = 12 + 9*math.Sin(phase) + rand.Float64()*6
			p.MemoryBytes = maxMem * (0.42 + 0.08*math.Sin(phase/3) + rand.Float64()*0.03)
			p.NetInBytes = 18000 + 9000*math.Sin(phase/2) + rand.Float64()*4000
			p.NetOutBytes = 9000 + 5000*math.Cos(phase/2) + rand.Float64()*2500
			p.DiskReadBytes = rand.Float64() * 42000
			p.DiskWriteBytes = rand.Float64() * 26000
		}
		points = append(points, p)
	}
	return points, nil
}

func (d *Driver) OSInfo(ctx context.Context, driverID string) (*hypervisor.OSInfo, error) {
	d.mu.Lock()
	_, ok := d.vms[driverID]
	d.mu.Unlock()
	if !ok {
		return nil, hypervisor.ErrNotFound
	}
	return &hypervisor.OSInfo{
		Available:     true,
		Hostname:      "mock-guest",
		Name:          "Debian GNU/Linux 12 (bookworm)",
		Version:       "12 (bookworm)",
		KernelRelease: "6.1.0-25-amd64",
		KernelVersion: "#1 SMP PREEMPT_DYNAMIC Debian 6.1.106-3",
		Machine:       "x86_64",
		OSType:        "l26",
	}, nil
}

// SetDescription records notes for a guest, or for a template — the
// mock keeps templates in the same map the real driver does.
func (d *Driver) SetDescription(ctx context.Context, driverID, description string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if vm, ok := d.vms[driverID]; ok {
		vm.description = description
		return nil
	}
	for i := range d.images {
		if d.images[i].ID == driverID {
			d.images[i].Description = description
			return nil
		}
	}
	return hypervisor.ErrNotFound
}

func (d *Driver) Start(ctx context.Context, driverID string) error {
	return d.transition(driverID, hypervisor.StatusStaging, hypervisor.StatusRunning, 3*time.Second)
}

func (d *Driver) Stop(ctx context.Context, driverID string) error {
	return d.transition(driverID, hypervisor.StatusStopping, hypervisor.StatusTerminated, 4*time.Second)
}

func (d *Driver) Reset(ctx context.Context, driverID string) error {
	return d.transition(driverID, hypervisor.StatusStaging, hypervisor.StatusRunning, 3*time.Second)
}

func (d *Driver) transition(driverID string, now, then hypervisor.Status, after time.Duration) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	vm, ok := d.vms[driverID]
	if !ok {
		return hypervisor.ErrNotFound
	}
	vm.state.Status = now
	vm.next = then
	vm.at = time.Now().Add(after)
	return nil
}

func (d *Driver) ISOs(ctx context.Context) ([]hypervisor.ISO, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]hypervisor.ISO{}, d.isos...), nil
}

// DownloadISO simulates a server-side fetch: the task "runs" briefly,
// then the image appears in the listing.
func (d *Driver) DownloadISO(ctx context.Context, spec hypervisor.ISODownloadSpec) (string, error) {
	return d.startImport(spec.Zone, spec.Storage, spec.Filename, 6*time.Second, 0), nil
}

func (d *Driver) UploadISO(ctx context.Context, spec hypervisor.ISOUploadSpec, content io.Reader) (string, error) {
	// Drain the stream so the client sees a real transfer.
	n, err := io.Copy(io.Discard, content)
	if err != nil {
		return "", err
	}
	return d.startImport(spec.Zone, spec.Storage, spec.Filename, 2*time.Second, n), nil
}

func (d *Driver) startImport(zone, storage, filename string, after time.Duration, size int64) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.nextTask++
	id := fmt.Sprintf("UPID:%s:mock:%d", zone, d.nextTask)
	if size == 0 {
		size = 1 << 30
	}
	d.tasks[id] = &task{
		done: time.Now().Add(after),
		iso: hypervisor.ISO{
			ID: storage + ":iso/" + filename, Name: filename, Zone: zone,
			Storage: storage, SizeBytes: size, CreatedAt: time.Now().Unix(),
		},
	}
	return id
}

func (d *Driver) DeleteVolume(ctx context.Context, zone, volumeID string) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for i, iso := range d.isos {
		if iso.ID == volumeID {
			d.isos = append(d.isos[:i], d.isos[i+1:]...)
			return "", nil
		}
	}
	for i, tpl := range d.ctTemplates {
		if tpl.ID == volumeID {
			d.ctTemplates = append(d.ctTemplates[:i], d.ctTemplates[i+1:]...)
			return "", nil
		}
	}
	return "", hypervisor.ErrNotFound
}

func (d *Driver) TaskStatus(ctx context.Context, taskID string) (*hypervisor.TaskStatus, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	t, ok := d.tasks[taskID]
	if !ok {
		return nil, hypervisor.ErrNotFound
	}
	if time.Now().Before(t.done) {
		return &hypervisor.TaskStatus{ID: taskID, Status: "running", Running: true}, nil
	}
	if !t.applied {
		t.applied = true
		d.isos = append(d.isos, t.iso)
	}
	return &hypervisor.TaskStatus{
		ID: taskID, Status: "stopped", ExitStatus: "OK", Succeeded: true,
	}, nil
}

func (d *Driver) Datastores(ctx context.Context) ([]hypervisor.Datastore, error) {
	return []hypervisor.Datastore{
		{ID: "lab-node-a/local", Name: "local", Zone: "lab-node-a", Type: "dir",
			Content: "iso,vztmpl,backup", TotalBytes: 100 << 30, UsedBytes: 38 << 30, Active: true},
		{ID: "lab-node-a/local-lvm", Name: "local-lvm", Zone: "lab-node-a", Type: "lvmthin",
			Content: "images,rootdir", TotalBytes: 500 << 30, UsedBytes: 213 << 30, Active: true},
		{ID: "lab-node-b/ssd-tank", Name: "ssd-tank", Zone: "lab-node-b", Type: "zfspool",
			Content: "images,rootdir", TotalBytes: 2 << 40, UsedBytes: 700 << 30, Active: true, Shared: true},
	}, nil
}

// --- hypervisor.ContainerDriver ---

func (d *Driver) CTTemplates(ctx context.Context) ([]hypervisor.CTTemplate, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]hypervisor.CTTemplate{}, d.ctTemplates...), nil
}

func (d *Driver) ListContainers(ctx context.Context) ([]hypervisor.InstanceState, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	states := []hypervisor.InstanceState{}
	for _, ct := range d.cts {
		d.tick(ct)
		states = append(states, ct.state)
	}
	return states, nil
}

func (d *Driver) GetContainer(ctx context.Context, driverID string) (*hypervisor.InstanceState, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	ct, ok := d.cts[driverID]
	if !ok {
		return nil, hypervisor.ErrNotFound
	}
	d.tick(ct)
	s := ct.state
	return &s, nil
}

func (d *Driver) ctTransition(driverID string, now, then hypervisor.Status, after time.Duration) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	ct, ok := d.cts[driverID]
	if !ok {
		return hypervisor.ErrNotFound
	}
	ct.state.Status = now
	ct.next = then
	ct.at = time.Now().Add(after)
	return nil
}

func (d *Driver) StartContainer(ctx context.Context, driverID string) error {
	// Containers start much faster than VMs.
	return d.ctTransition(driverID, hypervisor.StatusStaging, hypervisor.StatusRunning, 1*time.Second)
}

func (d *Driver) StopContainer(ctx context.Context, driverID string) error {
	return d.ctTransition(driverID, hypervisor.StatusStopping, hypervisor.StatusTerminated, 2*time.Second)
}

func (d *Driver) RestartContainer(ctx context.Context, driverID string) error {
	return d.ctTransition(driverID, hypervisor.StatusStaging, hypervisor.StatusRunning, 1*time.Second)
}

func (d *Driver) DeleteContainer(ctx context.Context, driverID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.cts[driverID]; !ok {
		return hypervisor.ErrNotFound
	}
	delete(d.cts, driverID)
	return nil
}

func (d *Driver) Delete(ctx context.Context, driverID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.vms[driverID]; !ok {
		return hypervisor.ErrNotFound
	}
	delete(d.vms, driverID)
	return nil
}
