package api

import (
	"context"
	"encoding/json"
	"net/http"
	"path"
	"slices"
	"strings"

	"vantric/internal/hypervisor"
)

// Cloud images are the disks templates are built from: fetched into a
// datastore's import content, then imported by BuildTemplate.

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
		Node               string `json:"node"`
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
	if req.Node == "" || req.Storage == "" {
		s.err(w, http.StatusBadRequest, "node and storage are required")
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
		Node:               req.Node,
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
	op := s.ops.start("Downloading cloud image "+filename, "cloudImage", filename,
		r.URL.Query().Get("server"), "/compute/cloud-images")
	s.watchTask(op, driver, taskID, "Downloaded to "+req.Storage)
	s.json(w, http.StatusAccepted, op)
}

func (s *Server) buildTemplate(w http.ResponseWriter, r *http.Request) {
	driver := s.driverForServer(w, r)
	if driver == nil {
		return
	}
	serverID := r.URL.Query().Get("server")
	var req struct {
		Name          string           `json:"name"`
		Node          string           `json:"node"`
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
	if req.Node == "" || req.SourceVolume == "" || req.DiskStorage == "" {
		s.err(w, http.StatusBadRequest, "node, sourceVolume and diskStorage are required")
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
		Node:          req.Node,
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

	// Detached from the request: importing a disk takes minutes, and the
	// browser is free to navigate away while it runs. A build
	// interrupted by a restart leaves a VM rather than a template, which
	// the VM instances list surfaces.
	op := s.ops.start("Building template "+req.Name, "image", req.Name,
		serverID, "/compute/vm-templates")
	s.run(op, "Template ready", func(ctx context.Context, step func(string)) error {
		_, err := driver.BuildTemplate(ctx, spec, step)
		return err
	})
	s.json(w, http.StatusAccepted, op)
}
