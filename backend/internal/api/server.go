// Package api exposes the REST API consumed by the frontend.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"lab-cloud-manager/internal/database"
	"lab-cloud-manager/internal/dns"
	"lab-cloud-manager/internal/hypervisor"
	"lab-cloud-manager/internal/store"
)

var nameRe = regexp.MustCompile(`^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$`)

type Server struct {
	store       *store.Store
	registry    *hypervisor.Registry
	dnsRegistry *dns.Registry
	dbRegistry  *database.Registry
	log         *slog.Logger
	staticDir   string
	builds      *buildRegistry
}

func New(
	st *store.Store,
	registry *hypervisor.Registry,
	dnsRegistry *dns.Registry,
	dbRegistry *database.Registry,
	log *slog.Logger,
	staticDir string,
) *Server {
	return &Server{
		store: st, registry: registry, dnsRegistry: dnsRegistry, dbRegistry: dbRegistry,
		log: log, staticDir: staticDir,
		builds: newBuildRegistry(),
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/zones", s.listZones)
		r.Get("/bridges", s.listBridges)
		r.Get("/images", s.listImages)
		r.Get("/disks", s.listDisks)
		r.Get("/snapshots", s.listSnapshots)
		r.Get("/isos", s.listISOs)
		r.Post("/isos/download", s.downloadISO)
		r.Post("/isos/upload", s.uploadVolume("iso", isoExtensions))
		r.Delete("/isos", s.deleteVolume("iso", "an ISO image"))
		r.Delete("/ct-templates", s.deleteVolume("vztmpl", "a CT template"))
		r.Delete("/images/{id}", s.deleteImage)
		r.Get("/cloud-images", s.listCloudImages)
		r.Post("/cloud-images/download", s.downloadCloudImage)
		r.Post("/cloud-images/upload", s.uploadVolume("import", cloudImageExtensions))
		r.Delete("/cloud-images", s.deleteVolume("import", "a cloud image"))
		r.Post("/vm-templates/build", s.buildTemplate)
		r.Get("/vm-templates/builds/{id}", s.templateBuildStatus)
		r.Get("/tasks/{taskId}", s.taskStatus)
		r.Get("/datastores", s.listDatastores)
		r.Get("/ct-templates", s.listCTTemplates)
		r.Get("/machine-types", s.listMachineTypes)
		r.Post("/machine-types", s.createMachineType)
		r.Delete("/machine-types/{name}", s.deleteMachineType)

		r.Get("/server-types", s.listServerTypes)
		r.Get("/servers", s.listServers)
		r.Post("/servers", s.createServer)
		r.Put("/servers/{id}", s.updateServer)
		r.Delete("/servers/{id}", s.deleteServer)

		s.containerRoutes(r)
		s.dnsRoutes(r)
		s.databaseRoutes(r)

		r.Get("/instances", s.listInstances)
		r.Post("/instances", s.createInstance)
		r.Route("/instances/{instance}", func(r chi.Router) {
			r.Get("/", s.getInstance)
			r.Get("/describe", s.describeInstance)
			r.Get("/metrics", s.instanceMetrics)
			r.Get("/os-info", s.instanceOSInfo)
			r.Delete("/", s.deleteInstance)
			r.Post("/start", s.instanceAction("start"))
			r.Post("/stop", s.instanceAction("stop"))
			r.Post("/reset", s.instanceAction("reset"))
			r.Post("/protection", s.setInstanceProtection)
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

// --- machine types ---

func (s *Server) listMachineTypes(w http.ResponseWriter, r *http.Request) {
	types, err := s.store.ListMachineTypes(r.Context())
	if err != nil {
		s.fail(w, err, "machine types")
		return
	}
	s.json(w, http.StatusOK, types)
}

func (s *Server) createMachineType(w http.ResponseWriter, r *http.Request) {
	var mt store.MachineType
	if err := json.NewDecoder(r.Body).Decode(&mt); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !nameRe.MatchString(mt.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return
	}
	if mt.CPUs < 1 || mt.MemoryMB < 128 {
		s.err(w, http.StatusBadRequest, "cpus must be >= 1 and memoryMb >= 128")
		return
	}
	if mt.Description == "" {
		mt.Description = describeMachineType(mt.CPUs, mt.MemoryMB)
	}
	if existing, err := s.store.GetMachineType(r.Context(), mt.Name); err == nil && existing != nil {
		s.err(w, http.StatusConflict, "a machine type with this name already exists")
		return
	}
	if err := s.store.CreateMachineType(r.Context(), &mt); err != nil {
		s.fail(w, err, "creating machine type")
		return
	}
	s.json(w, http.StatusCreated, mt)
}

func (s *Server) deleteMachineType(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteMachineType(r.Context(), chi.URLParam(r, "name")); err != nil {
		s.fail(w, err, "deleting machine type")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func describeMachineType(cpus, memoryMB int) string {
	mem := fmt.Sprintf("%d MB", memoryMB)
	if memoryMB%1024 == 0 {
		mem = fmt.Sprintf("%d GB", memoryMB/1024)
	}
	return fmt.Sprintf("%d vCPU, %s", cpus, mem)
}

// --- instances ---

func (s *Server) listInstances(w http.ResponseWriter, r *http.Request) {
	instances, err := s.store.ListInstances(r.Context())
	if err != nil {
		s.fail(w, err, "instances")
		return
	}
	s.json(w, http.StatusOK, instances)
}

func (s *Server) getInstance(w http.ResponseWriter, r *http.Request) {
	inst, err := s.store.GetInstance(r.Context(), chi.URLParam(r, "instance"))
	if err != nil {
		s.fail(w, err, "instance")
		return
	}
	s.json(w, http.StatusOK, inst)
}

// instanceDriver resolves an instance by name to its live driver.
func (s *Server) instanceDriver(w http.ResponseWriter, r *http.Request) (*store.Instance, hypervisor.Driver) {
	inst, err := s.store.GetInstance(r.Context(), chi.URLParam(r, "instance"))
	if err != nil {
		s.fail(w, err, "instance")
		return nil, nil
	}
	driver, ok := s.registry.Get(inst.ServerID)
	if !ok {
		s.err(w, http.StatusConflict, "the server backing this instance is no longer registered")
		return nil, nil
	}
	return inst, driver
}

// describeInstance reads full config straight from the hypervisor. This
// is the documented exception to "handlers don't poll the driver": VM
// config isn't mirrored in the store, and the detail view fetches it on
// demand rather than on the list's polling interval.
func (s *Server) describeInstance(w http.ResponseWriter, r *http.Request) {
	inst, driver := s.instanceDriver(w, r)
	if driver == nil {
		return
	}
	detail, err := driver.Describe(r.Context(), inst.DriverID)
	if err != nil {
		s.fail(w, err, "describing instance")
		return
	}
	s.json(w, http.StatusOK, detail)
}

func (s *Server) instanceMetrics(w http.ResponseWriter, r *http.Request) {
	inst, driver := s.instanceDriver(w, r)
	if driver == nil {
		return
	}
	timeframe := hypervisor.MetricTimeframe(r.URL.Query().Get("timeframe"))
	switch timeframe {
	case "", hypervisor.TimeframeHour, hypervisor.TimeframeDay,
		hypervisor.TimeframeWeek, hypervisor.TimeframeMonth:
	default:
		s.err(w, http.StatusBadRequest, "timeframe must be hour, day, week or month")
		return
	}
	points, err := driver.Metrics(r.Context(), inst.DriverID, timeframe)
	if err != nil {
		s.fail(w, err, "instance metrics")
		return
	}
	if points == nil {
		points = []hypervisor.MetricPoint{}
	}
	s.json(w, http.StatusOK, points)
}

func (s *Server) instanceOSInfo(w http.ResponseWriter, r *http.Request) {
	inst, driver := s.instanceDriver(w, r)
	if driver == nil {
		return
	}
	info, err := driver.OSInfo(r.Context(), inst.DriverID)
	if err != nil {
		s.fail(w, err, "instance os info")
		return
	}
	s.json(w, http.StatusOK, info)
}

func (s *Server) createInstance(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string           `json:"name"`
		ServerID    string           `json:"serverId"`
		Zone        string           `json:"zone"`
		MachineType string           `json:"machineType"`
		CPUs        int              `json:"cpus"`
		MemoryMB    int              `json:"memoryMb"`
		DiskGB      int              `json:"diskGb"`
		ImageID     string           `json:"imageId"`
		NetBridge   string           `json:"netBridge"`
		VLANTag     int              `json:"vlanTag"`
		CloudInit   cloudInitRequest `json:"cloudInit"`
		Description string           `json:"description"`
		Protected   bool             `json:"protected"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return
	}
	if req.ServerID == "" || req.Zone == "" || req.ImageID == "" {
		s.err(w, http.StatusBadRequest, "serverId, zone and imageId are required")
		return
	}
	driver, ok := s.registry.Get(req.ServerID)
	if !ok {
		s.err(w, http.StatusBadRequest, "unknown serverId")
		return
	}
	// Resolve sizing from machine type unless custom values are given.
	if req.MachineType != "" && req.MachineType != "custom" {
		mt, err := s.store.GetMachineType(r.Context(), req.MachineType)
		if errors.Is(err, store.ErrNotFound) {
			s.err(w, http.StatusBadRequest, "unknown machineType")
			return
		}
		if err != nil {
			s.fail(w, err, "machine type")
			return
		}
		req.CPUs, req.MemoryMB = mt.CPUs, mt.MemoryMB
	}
	if req.CPUs < 1 || req.MemoryMB < 128 {
		s.err(w, http.StatusBadRequest, "cpus and memoryMb are required (machineType or custom values)")
		return
	}
	if req.DiskGB == 0 {
		req.DiskGB = 10
	}
	if existing, err := s.store.GetInstance(r.Context(), req.Name); err == nil && existing != nil {
		s.err(w, http.StatusConflict, "an instance with this name already exists")
		return
	}

	cloudInit, err := req.CloudInit.toCloudInit()
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}

	driverID, err := driver.Create(r.Context(), hypervisor.InstanceSpec{
		Name:          req.Name,
		Zone:          req.Zone,
		CPUs:          req.CPUs,
		MemoryMB:      req.MemoryMB,
		DiskGB:        req.DiskGB,
		ImageID:       req.ImageID,
		NetworkBridge: req.NetBridge,
		VLANTag:       req.VLANTag,
		CloudInit:     cloudInit,
		Description:   req.Description,
	})
	if err != nil {
		s.fail(w, err, "creating instance")
		return
	}
	inst := &store.Instance{
		ID:          uuid.NewString(),
		Name:        req.Name,
		ServerID:    req.ServerID,
		Zone:        req.Zone,
		MachineType: req.MachineType,
		CPUs:        req.CPUs,
		MemoryMB:    req.MemoryMB,
		DiskGB:      req.DiskGB,
		ImageID:     req.ImageID,
		Status:      string(hypervisor.StatusProvisioning),
		DriverID:    driverID,
		NetBridge:   req.NetBridge,
		VLANTag:     req.VLANTag,
		Description: req.Description,
		Protected:   req.Protected,
	}
	if err := s.store.CreateInstance(r.Context(), inst); err != nil {
		s.fail(w, err, "saving instance")
		return
	}
	s.json(w, http.StatusCreated, inst)
}

func (s *Server) instanceAction(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inst, err := s.store.GetInstance(r.Context(), chi.URLParam(r, "instance"))
		if err != nil {
			s.fail(w, err, "instance")
			return
		}
		driver, ok := s.registry.Get(inst.ServerID)
		if !ok {
			s.err(w, http.StatusConflict, "the server backing this instance is no longer registered")
			return
		}
		var optimistic hypervisor.Status
		switch action {
		case "start":
			err = driver.Start(r.Context(), inst.DriverID)
			optimistic = hypervisor.StatusStaging
		case "stop":
			err = driver.Stop(r.Context(), inst.DriverID)
			optimistic = hypervisor.StatusStopping
		case "reset":
			err = driver.Reset(r.Context(), inst.DriverID)
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

// setInstanceProtection toggles deletion protection (GCP-style).
func (s *Server) setInstanceProtection(w http.ResponseWriter, r *http.Request) {
	inst, err := s.store.GetInstance(r.Context(), chi.URLParam(r, "instance"))
	if err != nil {
		s.fail(w, err, "instance")
		return
	}
	var req struct {
		Protected bool `json:"protected"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := s.store.SetInstanceProtection(r.Context(), inst.ID, req.Protected); err != nil {
		s.fail(w, err, "updating protection")
		return
	}
	inst.Protected = req.Protected
	s.json(w, http.StatusOK, inst)
}

func (s *Server) deleteInstance(w http.ResponseWriter, r *http.Request) {
	inst, err := s.store.GetInstance(r.Context(), chi.URLParam(r, "instance"))
	if err != nil {
		s.fail(w, err, "instance")
		return
	}
	if inst.Protected {
		s.err(w, http.StatusConflict, "deletion protection is enabled on this instance")
		return
	}
	driver, ok := s.registry.Get(inst.ServerID)
	if !ok {
		s.err(w, http.StatusConflict, "the server backing this instance is no longer registered")
		return
	}
	if err := driver.Delete(r.Context(), inst.DriverID); err != nil && !errors.Is(err, hypervisor.ErrNotFound) {
		s.fail(w, err, "deleting instance")
		return
	}
	if err := s.store.DeleteInstance(r.Context(), inst.ID); err != nil {
		s.fail(w, err, "removing instance record")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
