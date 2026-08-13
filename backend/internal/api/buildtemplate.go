package api

import (
	"context"
	"encoding/json"
	"net/http"
	"path"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"lab-cloud-manager/internal/hypervisor"
)

// Template builds run past the request that starts them (importing a
// disk takes minutes), so progress is tracked here and polled by the
// wizard. State is in memory: a build interrupted by a restart leaves a
// VM behind on the hypervisor rather than a template, which the VM
// instances list will surface.

type TemplateBuild struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	ServerID  string    `json:"serverId"`
	Step      string    `json:"step"`
	Steps     []string  `json:"steps"`
	Running   bool      `json:"running"`
	ImageID   string    `json:"imageId"`
	Error     string    `json:"error"`
	StartedAt time.Time `json:"startedAt"`
}

type buildRegistry struct {
	mu     sync.Mutex
	builds map[string]*TemplateBuild
}

func newBuildRegistry() *buildRegistry {
	return &buildRegistry{builds: map[string]*TemplateBuild{}}
}

func (b *buildRegistry) start(name, serverID string) *TemplateBuild {
	b.mu.Lock()
	defer b.mu.Unlock()
	build := &TemplateBuild{
		ID: uuid.NewString(), Name: name, ServerID: serverID,
		Running: true, StartedAt: time.Now(),
	}
	b.builds[build.ID] = build
	return build
}

func (b *buildRegistry) step(id, step string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if build, ok := b.builds[id]; ok {
		build.Step = step
		build.Steps = append(build.Steps, step)
	}
}

func (b *buildRegistry) finish(id, imageID string, err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	build, ok := b.builds[id]
	if !ok {
		return
	}
	build.Running = false
	build.ImageID = imageID
	if err != nil {
		build.Error = err.Error()
	}
}

func (b *buildRegistry) get(id string) (TemplateBuild, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	build, ok := b.builds[id]
	if !ok {
		return TemplateBuild{}, false
	}
	return *build, true
}

// cloudImageExtensions are the disk formats Proxmox can import.
var cloudImageExtensions = []string{".qcow2", ".raw", ".img", ".vmdk"}

func (s *Server) listCloudImages(w http.ResponseWriter, r *http.Request) {
	images, err := listAcrossServers(s, r,
		func(ctx context.Context, d hypervisor.Driver) ([]hypervisor.CloudImage, error) {
			return d.CloudImages(ctx)
		},
		func(i *hypervisor.CloudImage, id string) { i.ServerID = id })
	if err != nil {
		s.fail(w, err, "cloud images")
		return
	}
	slices.SortFunc(images, func(a, b hypervisor.CloudImage) int {
		return strings.Compare(a.Name, b.Name)
	})
	s.json(w, http.StatusOK, images)
}

// downloadCloudImage fetches a disk image into a datastore's import
// content, from where a template can be built.
func (s *Server) downloadCloudImage(w http.ResponseWriter, r *http.Request) {
	driver := s.driverForServer(w, r)
	if driver == nil {
		return
	}
	var req struct {
		Zone               string `json:"zone"`
		Storage            string `json:"storage"`
		Filename           string `json:"filename"`
		URL                string `json:"url"`
		Checksum           string `json:"checksum"`
		ChecksumAlgorithm  string `json:"checksumAlgorithm"`
		VerifyCertificates bool   `json:"verifyCertificates"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Zone == "" || req.Storage == "" {
		s.err(w, http.StatusBadRequest, "zone and storage are required")
		return
	}
	if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
		s.err(w, http.StatusBadRequest, "url must be an http(s) address")
		return
	}
	if req.Filename == "" {
		req.Filename = path.Base(req.URL)
	}
	filename, ok := safeFilename(req.Filename, cloudImageExtensions)
	if !ok {
		s.err(w, http.StatusBadRequest,
			"filename must be a plain name ending in "+strings.Join(cloudImageExtensions, ", "))
		return
	}
	if req.Checksum != "" && !slices.Contains(checksumAlgorithms, req.ChecksumAlgorithm) {
		s.err(w, http.StatusBadRequest, "checksumAlgorithm must be one of "+strings.Join(checksumAlgorithms, ", "))
		return
	}
	taskID, err := driver.DownloadISO(r.Context(), hypervisor.ISODownloadSpec{
		Zone:               req.Zone,
		Storage:            req.Storage,
		Filename:           filename,
		URL:                req.URL,
		Content:            "import",
		Checksum:           req.Checksum,
		ChecksumAlgorithm:  req.ChecksumAlgorithm,
		VerifyCertificates: req.VerifyCertificates,
	})
	if err != nil {
		s.fail(w, err, "starting image download")
		return
	}
	s.json(w, http.StatusAccepted, map[string]string{"taskId": taskID})
}

func (s *Server) buildTemplate(w http.ResponseWriter, r *http.Request) {
	driver := s.driverForServer(w, r)
	if driver == nil {
		return
	}
	serverID := r.URL.Query().Get("server")
	var req struct {
		Name          string           `json:"name"`
		Zone          string           `json:"zone"`
		SourceVolume  string           `json:"sourceVolume"`
		DiskStorage   string           `json:"diskStorage"`
		DiskGB        int              `json:"diskGb"`
		CPUs          int              `json:"cpus"`
		MemoryMB      int              `json:"memoryMb"`
		NetworkBridge string           `json:"netBridge"`
		VLANTag       int              `json:"vlanTag"`
		CloudInit     cloudInitRequest `json:"cloudInit"`
		BIOS          string           `json:"bios"`
		MachineType   string           `json:"machineType"`
		EnableAgent   bool             `json:"enableAgent"`
		Description   string           `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return
	}
	if req.Zone == "" || req.SourceVolume == "" || req.DiskStorage == "" {
		s.err(w, http.StatusBadRequest, "zone, sourceVolume and diskStorage are required")
		return
	}
	if !strings.Contains(req.SourceVolume, ":import/") {
		s.err(w, http.StatusBadRequest, "sourceVolume must be a cloud image in a datastore's import content")
		return
	}
	if req.CPUs < 1 || req.MemoryMB < 128 {
		s.err(w, http.StatusBadRequest, "cpus must be >= 1 and memoryMb >= 128")
		return
	}
	if req.BIOS != "" && req.BIOS != "seabios" && req.BIOS != "ovmf" {
		s.err(w, http.StatusBadRequest, "bios must be seabios or ovmf")
		return
	}

	cloudInit, err := req.CloudInit.toCloudInit()
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}

	spec := hypervisor.TemplateSpec{
		Name:          req.Name,
		Zone:          req.Zone,
		SourceVolume:  req.SourceVolume,
		DiskStorage:   req.DiskStorage,
		DiskGB:        req.DiskGB,
		CPUs:          req.CPUs,
		MemoryMB:      req.MemoryMB,
		NetworkBridge: req.NetworkBridge,
		VLANTag:       req.VLANTag,
		CloudInit:     cloudInit,
		BIOS:          req.BIOS,
		MachineType:   req.MachineType,
		EnableAgent:   req.EnableAgent,
		Description:   req.Description,
	}

	build := s.builds.start(req.Name, serverID)
	// Detached from the request: the browser can navigate away while the
	// disk import runs.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
		defer cancel()
		imageID, err := driver.BuildTemplate(ctx, spec, func(step string) {
			s.builds.step(build.ID, step)
		})
		if err != nil {
			s.log.Error("building template", "name", spec.Name, "error", err)
		}
		s.builds.finish(build.ID, imageID, err)
	}()
	s.json(w, http.StatusAccepted, build)
}

func (s *Server) templateBuildStatus(w http.ResponseWriter, r *http.Request) {
	build, ok := s.builds.get(chi.URLParam(r, "id"))
	if !ok {
		s.err(w, http.StatusNotFound, "build: not found")
		return
	}
	s.json(w, http.StatusOK, build)
}
