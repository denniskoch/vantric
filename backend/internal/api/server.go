// Package api exposes the REST API consumed by the frontend.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"lab-cloud-manager/internal/hypervisor"
	"lab-cloud-manager/internal/store"
)

// MachineType is a sizing preset, GCP-style. Custom sizing is also
// accepted on create.
type MachineType struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	CPUs        int    `json:"cpus"`
	MemoryMB    int    `json:"memoryMb"`
}

var machineTypes = []MachineType{
	{Name: "hl-micro", Description: "1 vCPU, 512 MB", CPUs: 1, MemoryMB: 512},
	{Name: "hl-small", Description: "1 vCPU, 1 GB", CPUs: 1, MemoryMB: 1024},
	{Name: "hl-standard-2", Description: "2 vCPU, 2 GB", CPUs: 2, MemoryMB: 2048},
	{Name: "hl-standard-4", Description: "4 vCPU, 4 GB", CPUs: 4, MemoryMB: 4096},
	{Name: "hl-highmem-4", Description: "4 vCPU, 8 GB", CPUs: 4, MemoryMB: 8192},
	{Name: "hl-highmem-8", Description: "8 vCPU, 16 GB", CPUs: 8, MemoryMB: 16384},
}

var nameRe = regexp.MustCompile(`^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$`)

type Server struct {
	store     *store.Store
	driver    hypervisor.Driver
	log       *slog.Logger
	staticDir string
}

func New(st *store.Store, driver hypervisor.Driver, log *slog.Logger, staticDir string) *Server {
	return &Server{store: st, driver: driver, log: log, staticDir: staticDir}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/zones", s.listZones)
		r.Get("/images", s.listImages)
		r.Get("/machine-types", s.listMachineTypes)

		r.Get("/projects", s.listProjects)
		r.Post("/projects", s.createProject)

		r.Route("/projects/{project}", func(r chi.Router) {
			r.Get("/instances", s.listInstances)
			r.Post("/instances", s.createInstance)
			r.Route("/instances/{instance}", func(r chi.Router) {
				r.Get("/", s.getInstance)
				r.Delete("/", s.deleteInstance)
				r.Post("/start", s.instanceAction("start"))
				r.Post("/stop", s.instanceAction("stop"))
				r.Post("/reset", s.instanceAction("reset"))
			})
		})
	})

	if s.staticDir != "" {
		r.Handle("/*", spaHandler(s.staticDir))
	}
	return r
}

// --- helpers ---

func (s *Server) json(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

type apiError struct {
	Error string `json:"error"`
}

func (s *Server) err(w http.ResponseWriter, code int, msg string) {
	s.json(w, code, apiError{Error: msg})
}

func (s *Server) fail(w http.ResponseWriter, err error, context string) {
	if errors.Is(err, store.ErrNotFound) || errors.Is(err, hypervisor.ErrNotFound) {
		s.err(w, http.StatusNotFound, context+": not found")
		return
	}
	s.log.Error(context, "error", err)
	s.err(w, http.StatusInternalServerError, context+": "+err.Error())
}

// project resolves the {project} URL param.
func (s *Server) project(w http.ResponseWriter, r *http.Request) *store.Project {
	p, err := s.store.GetProjectByName(r.Context(), chi.URLParam(r, "project"))
	if err != nil {
		s.fail(w, err, "project")
		return nil
	}
	return p
}

// --- catalog ---

func (s *Server) listZones(w http.ResponseWriter, r *http.Request) {
	zones, err := s.driver.Zones(r.Context())
	if err != nil {
		s.fail(w, err, "zones")
		return
	}
	s.json(w, http.StatusOK, zones)
}

func (s *Server) listImages(w http.ResponseWriter, r *http.Request) {
	images, err := s.driver.Images(r.Context())
	if err != nil {
		s.fail(w, err, "images")
		return
	}
	if images == nil {
		images = []hypervisor.Image{}
	}
	s.json(w, http.StatusOK, images)
}

func (s *Server) listMachineTypes(w http.ResponseWriter, r *http.Request) {
	s.json(w, http.StatusOK, machineTypes)
}

// --- projects ---

func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.store.ListProjects(r.Context())
	if err != nil {
		s.fail(w, err, "projects")
		return
	}
	s.json(w, http.StatusOK, projects)
}

func (s *Server) createProject(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		DisplayName string `json:"displayName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return
	}
	if req.DisplayName == "" {
		req.DisplayName = req.Name
	}
	p := &store.Project{ID: uuid.NewString(), Name: req.Name, DisplayName: req.DisplayName}
	if err := s.store.CreateProject(r.Context(), p); err != nil {
		s.fail(w, err, "creating project")
		return
	}
	s.json(w, http.StatusCreated, p)
}

// --- instances ---

func (s *Server) listInstances(w http.ResponseWriter, r *http.Request) {
	p := s.project(w, r)
	if p == nil {
		return
	}
	instances, err := s.store.ListInstances(r.Context(), p.ID)
	if err != nil {
		s.fail(w, err, "instances")
		return
	}
	s.json(w, http.StatusOK, instances)
}

func (s *Server) getInstance(w http.ResponseWriter, r *http.Request) {
	p := s.project(w, r)
	if p == nil {
		return
	}
	inst, err := s.store.GetInstance(r.Context(), p.ID, chi.URLParam(r, "instance"))
	if err != nil {
		s.fail(w, err, "instance")
		return
	}
	s.json(w, http.StatusOK, inst)
}

func (s *Server) createInstance(w http.ResponseWriter, r *http.Request) {
	p := s.project(w, r)
	if p == nil {
		return
	}
	var req struct {
		Name        string `json:"name"`
		Zone        string `json:"zone"`
		MachineType string `json:"machineType"`
		CPUs        int    `json:"cpus"`
		MemoryMB    int    `json:"memoryMb"`
		DiskGB      int    `json:"diskGb"`
		ImageID     string `json:"imageId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return
	}
	if req.Zone == "" || req.ImageID == "" {
		s.err(w, http.StatusBadRequest, "zone and imageId are required")
		return
	}
	// Resolve sizing from machine type unless custom values are given.
	if req.MachineType != "" && req.MachineType != "custom" {
		found := false
		for _, mt := range machineTypes {
			if mt.Name == req.MachineType {
				req.CPUs, req.MemoryMB = mt.CPUs, mt.MemoryMB
				found = true
				break
			}
		}
		if !found {
			s.err(w, http.StatusBadRequest, "unknown machineType")
			return
		}
	}
	if req.CPUs < 1 || req.MemoryMB < 128 {
		s.err(w, http.StatusBadRequest, "cpus and memoryMb are required (machineType or custom values)")
		return
	}
	if req.DiskGB == 0 {
		req.DiskGB = 10
	}
	if existing, err := s.store.GetInstance(r.Context(), p.ID, req.Name); err == nil && existing != nil {
		s.err(w, http.StatusConflict, "an instance with this name already exists")
		return
	}

	driverID, err := s.driver.Create(r.Context(), hypervisor.InstanceSpec{
		Name:     req.Name,
		Zone:     req.Zone,
		CPUs:     req.CPUs,
		MemoryMB: req.MemoryMB,
		DiskGB:   req.DiskGB,
		ImageID:  req.ImageID,
	})
	if err != nil {
		s.fail(w, err, "creating instance")
		return
	}
	inst := &store.Instance{
		ID:          uuid.NewString(),
		ProjectID:   p.ID,
		Name:        req.Name,
		Zone:        req.Zone,
		MachineType: req.MachineType,
		CPUs:        req.CPUs,
		MemoryMB:    req.MemoryMB,
		DiskGB:      req.DiskGB,
		ImageID:     req.ImageID,
		Status:      string(hypervisor.StatusProvisioning),
		Driver:      s.driver.Name(),
		DriverID:    driverID,
	}
	if err := s.store.CreateInstance(r.Context(), inst); err != nil {
		s.fail(w, err, "saving instance")
		return
	}
	s.json(w, http.StatusCreated, inst)
}

func (s *Server) instanceAction(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := s.project(w, r)
		if p == nil {
			return
		}
		inst, err := s.store.GetInstance(r.Context(), p.ID, chi.URLParam(r, "instance"))
		if err != nil {
			s.fail(w, err, "instance")
			return
		}
		var optimistic hypervisor.Status
		switch action {
		case "start":
			err = s.driver.Start(r.Context(), inst.DriverID)
			optimistic = hypervisor.StatusStaging
		case "stop":
			err = s.driver.Stop(r.Context(), inst.DriverID)
			optimistic = hypervisor.StatusStopping
		case "reset":
			err = s.driver.Reset(r.Context(), inst.DriverID)
			optimistic = hypervisor.StatusStaging
		}
		if err != nil {
			s.fail(w, err, action)
			return
		}
		// Reflect the action immediately; the reconciler converges on truth.
		_ = s.store.SetInstanceStatus(r.Context(), inst.ID, string(optimistic))
		inst.Status = string(optimistic)
		s.json(w, http.StatusOK, inst)
	}
}

func (s *Server) deleteInstance(w http.ResponseWriter, r *http.Request) {
	p := s.project(w, r)
	if p == nil {
		return
	}
	inst, err := s.store.GetInstance(r.Context(), p.ID, chi.URLParam(r, "instance"))
	if err != nil {
		s.fail(w, err, "instance")
		return
	}
	if err := s.driver.Delete(r.Context(), inst.DriverID); err != nil && !errors.Is(err, hypervisor.ErrNotFound) {
		s.fail(w, err, "deleting instance")
		return
	}
	if err := s.store.DeleteInstance(r.Context(), inst.ID); err != nil {
		s.fail(w, err, "removing instance record")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
