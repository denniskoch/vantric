package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/hypervisor"
	"vantric/internal/store"
)

// Container handlers. Containers (LXC) are a separate resource from VM
// instances; only drivers implementing hypervisor.ContainerDriver
// support them.

func (s *Server) containerRoutes(r chi.Router) {
	r.Get("/containers", s.listContainersHandler)
	r.Post("/containers", s.createContainer)
	r.Route("/containers/{container}", func(r chi.Router) {
		r.Get("/", s.getContainer)
		r.Delete("/", s.deleteContainerHandler)
		r.Post("/start", s.containerAction("start"))
		r.Post("/stop", s.containerAction("stop"))
		r.Post("/reset", s.containerAction("reset"))
		r.Post("/protection", s.setContainerProtection)
		r.Post("/backups", s.takeBackup)
	})
}

// containerDriver resolves a container's server to a ContainerDriver.
func (s *Server) containerDriver(w http.ResponseWriter, serverID string) hypervisor.ContainerDriver {
	driver, ok := s.registry.Get(serverID)
	if !ok {
		s.err(w, http.StatusConflict, "the server backing this container is no longer registered")
		return nil
	}
	cd, ok := driver.(hypervisor.ContainerDriver)
	if !ok {
		s.err(w, http.StatusConflict, "this server's hypervisor does not support containers")
		return nil
	}
	return cd
}

func (s *Server) listContainersHandler(w http.ResponseWriter, r *http.Request) {
	containers, err := s.store.ListContainers(r.Context())
	if err != nil {
		s.fail(w, err, "containers")
		return
	}
	s.json(w, http.StatusOK, containers)
}

func (s *Server) getContainer(w http.ResponseWriter, r *http.Request) {
	ct, err := s.store.GetContainer(r.Context(), chi.URLParam(r, "container"))
	if err != nil {
		s.fail(w, err, "container")
		return
	}
	s.json(w, http.StatusOK, ct)
}

func (s *Server) containerAction(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ct, err := s.store.GetContainer(r.Context(), chi.URLParam(r, "container"))
		if err != nil {
			s.fail(w, err, "container")
			return
		}
		cd := s.containerDriver(w, ct.HypervisorID)
		if cd == nil {
			return
		}
		var optimistic hypervisor.Status
		var taskID, verb, done string
		switch action {
		case "start":
			taskID, err = cd.StartContainer(r.Context(), ct.DriverID)
			optimistic, verb, done = hypervisor.StatusStaging, "Starting", "Started"
		case "stop":
			taskID, err = cd.StopContainer(r.Context(), ct.DriverID)
			optimistic, verb, done = hypervisor.StatusStopping, "Stopping", "Stopped"
		case "reset":
			taskID, err = cd.RestartContainer(r.Context(), ct.DriverID)
			optimistic, verb, done = hypervisor.StatusStaging, "Restarting", "Restarted"
		}
		if err != nil {
			s.fail(w, err, action)
			return
		}
		_ = s.store.SetContainerStatus(r.Context(), ct.ID, string(optimistic))
		// Same as a VM's power actions: the task is what says when the
		// container has actually stopped, so the bell follows it.
		driver, _ := s.registry.Get(ct.HypervisorID)
		op := s.ops.start(verb+" container "+ct.Name,
			"container", ct.Name, ct.HypervisorID, "/compute/containers/"+ct.Name)
		s.watchOrFinish(op, driver, taskID, done)
		s.json(w, http.StatusAccepted, op)
	}
}

func (s *Server) setContainerProtection(w http.ResponseWriter, r *http.Request) {
	ct, err := s.store.GetContainer(r.Context(), chi.URLParam(r, "container"))
	if err != nil {
		s.fail(w, err, "container")
		return
	}
	var req struct {
		Protected bool `json:"protected"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := s.store.SetContainerProtection(r.Context(), ct.ID, req.Protected); err != nil {
		s.fail(w, err, "updating protection")
		return
	}
	ct.Protected = req.Protected
	s.json(w, http.StatusOK, ct)
}

func (s *Server) deleteContainerHandler(w http.ResponseWriter, r *http.Request) {
	ct, err := s.store.GetContainer(r.Context(), chi.URLParam(r, "container"))
	if err != nil {
		s.fail(w, err, "container")
		return
	}
	if ct.Protected {
		s.err(w, http.StatusConflict, "deletion protection is enabled on this container")
		return
	}
	// Same rule as an instance, for the same reason: this destroys the
	// root filesystem, and a running container is one somebody may be
	// using. Proxmox refuses it too, but the refusal belongs here so it
	// holds whatever calls the API — and so the message names the
	// container rather than arriving as a backend error.
	if poweredOn(ct.Status) {
		s.err(w, http.StatusConflict,
			"stop "+ct.Name+" before deleting it — it is "+strings.ToLower(ct.Status))
		return
	}
	cd := s.containerDriver(w, ct.HypervisorID)
	if cd == nil {
		return
	}
	if err := cd.DeleteContainer(r.Context(), ct.DriverID); err != nil && !errors.Is(err, hypervisor.ErrNotFound) {
		s.fail(w, err, "deleting container")
		return
	}
	if err := s.store.DeleteContainer(r.Context(), ct.ID); err != nil {
		s.fail(w, err, "removing container record")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// createContainer provisions an LXC.
//
// It mirrors createInstance in shape — validate, hand the slow part to
// an operation, claim whatever the reconciler adopted meanwhile — but
// not in content. There is no template guest to clone, so every setting
// is stated rather than inherited, and the addressing goes on the
// interface rather than through cloud-init.
func (s *Server) createContainer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name         string `json:"name"`
		HypervisorID string `json:"hypervisorId"`
		Node         string `json:"node"`
		Template     string `json:"template"`
		Storage      string `json:"storage"`
		CPUs         int    `json:"cpus"`
		MemoryMB     int    `json:"memoryMb"`
		SwapMB       int    `json:"swapMb"`
		DiskGB       int    `json:"diskGb"`
		NetBridge    string `json:"netBridge"`
		VLANTag      int    `json:"vlanTag"`
		DHCP         bool   `json:"dhcp"`
		Address      string `json:"address"`
		Gateway      string `json:"gateway"`
		Nameservers  string `json:"nameservers"`
		SearchDomain string `json:"searchDomain"`
		Password     string `json:"password"`
		SSHKeys      string `json:"sshKeys"`
		Unprivileged bool   `json:"unprivileged"`
		Nesting      bool   `json:"nesting"`
		StartOnBoot  bool   `json:"startOnBoot"`
		Description  string `json:"description"`
		Protected    bool   `json:"protected"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest,
			"name must be lowercase letters, digits, hyphens (start with a letter)")
		return
	}
	if req.Template == "" {
		s.err(w, http.StatusBadRequest, "a container template is required")
		return
	}
	if msg := placementError(req.Node, req.Storage); msg != "" {
		s.err(w, http.StatusBadRequest, msg)
		return
	}
	if req.Storage == "" {
		s.err(w, http.StatusBadRequest, "a storage pool for the root filesystem is required")
		return
	}
	if req.Node == "" {
		s.err(w, http.StatusBadRequest, "a node is required")
		return
	}
	// A container has no template disk to inherit a size from, so these
	// are floors rather than fallbacks-for-blank.
	if req.CPUs <= 0 {
		req.CPUs = 1
	}
	if req.MemoryMB <= 0 {
		req.MemoryMB = 512
	}
	if req.DiskGB <= 0 {
		req.DiskGB = 8
	}
	// Neither a password nor a key means a container nobody can log in
	// to. Proxmox allows it; a console shouldn't hand it to you silently.
	if req.Password == "" && req.SSHKeys == "" {
		s.err(w, http.StatusBadRequest,
			"set a root password or an SSH key, or there is no way in")
		return
	}
	if existing, err := s.store.GetContainer(r.Context(), req.Name); err == nil && existing != nil {
		s.err(w, http.StatusConflict, "a container with this name already exists")
		return
	}
	cd := s.containerDriver(w, req.HypervisorID)
	if cd == nil {
		return
	}

	spec := hypervisor.ContainerSpec{
		Name:          req.Name,
		Node:          req.Node,
		Template:      req.Template,
		Storage:       req.Storage,
		CPUs:          req.CPUs,
		MemoryMB:      req.MemoryMB,
		SwapMB:        req.SwapMB,
		DiskGB:        req.DiskGB,
		NetworkBridge: req.NetBridge,
		VLANTag:       req.VLANTag,
		IP: hypervisor.IPConfig{
			DHCP:    req.DHCP,
			Address: req.Address,
			Gateway: req.Gateway,
		},
		Nameservers:  req.Nameservers,
		SearchDomain: req.SearchDomain,
		Password:     req.Password,
		SSHKeys:      req.SSHKeys,
		Unprivileged: req.Unprivileged,
		Nesting:      req.Nesting,
		StartOnBoot:  req.StartOnBoot,
		Description:  req.Description,
	}

	op := s.ops.start("Creating container "+req.Name, "container", req.Name,
		req.HypervisorID, "/compute/containers/"+req.Name)
	s.run(op, "Container created", func(ctx context.Context, step func(string)) error {
		step("Extracting " + req.Template)
		driverID, err := cd.CreateContainer(ctx, spec)
		if err != nil {
			return err
		}
		step("Recording the container")
		if err := s.saveNewContainer(ctx, &store.Container{
			ID:           uuid.NewString(),
			Name:         req.Name,
			HypervisorID: req.HypervisorID,
			Node:         req.Node,
			CPUs:         req.CPUs,
			MemoryMB:     req.MemoryMB,
			DiskGB:       req.DiskGB,
			Status:       string(hypervisor.StatusProvisioning),
			DriverID:     driverID,
			Description:  req.Description,
			Protected:    req.Protected,
		}); err != nil {
			return err
		}
		// A container starts in seconds rather than minutes, so this is
		// one attempt rather than the retry loop a clone needs — but it
		// is still a STEP of the create, so a failure to start says so
		// instead of leaving a built container sitting stopped.
		step("Starting " + req.Name)
		_, err = cd.StartContainer(ctx, driverID)
		return err
	})
	s.json(w, http.StatusAccepted, op)
}

// saveNewContainer writes the record, or takes over the one the
// reconciler adopted while the container was being created. Same race as
// saveNewInstance, tighter: a container appears in seconds.
func (s *Server) saveNewContainer(ctx context.Context, ct *store.Container) error {
	if adopted, err := s.store.GetContainerByDriverID(ctx, ct.HypervisorID, ct.DriverID); err == nil {
		ct.ID = adopted.ID
		if err := s.store.ClaimContainer(ctx, ct); err != nil {
			return err
		}
		s.log.Info("claimed a container the reconciler adopted mid-create",
			"name", ct.Name, "adoptedAs", adopted.Name, "driverId", ct.DriverID)
		return nil
	}
	return s.store.CreateContainer(ctx, ct)
}
