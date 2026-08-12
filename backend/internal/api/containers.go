package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"lab-cloud-manager/internal/hypervisor"
)

// Container handlers. Containers (LXC) are a separate resource from VM
// instances; only drivers implementing hypervisor.ContainerDriver
// support them.

func (s *Server) containerRoutes(r chi.Router) {
	r.Get("/containers", s.listContainersHandler)
	r.Route("/containers/{container}", func(r chi.Router) {
		r.Get("/", s.getContainer)
		r.Delete("/", s.deleteContainerHandler)
		r.Post("/start", s.containerAction("start"))
		r.Post("/stop", s.containerAction("stop"))
		r.Post("/reset", s.containerAction("reset"))
		r.Post("/protection", s.setContainerProtection)
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
		cd := s.containerDriver(w, ct.ServerID)
		if cd == nil {
			return
		}
		var optimistic hypervisor.Status
		switch action {
		case "start":
			err = cd.StartContainer(r.Context(), ct.DriverID)
			optimistic = hypervisor.StatusStaging
		case "stop":
			err = cd.StopContainer(r.Context(), ct.DriverID)
			optimistic = hypervisor.StatusStopping
		case "reset":
			err = cd.RestartContainer(r.Context(), ct.DriverID)
			optimistic = hypervisor.StatusStaging
		}
		if err != nil {
			s.fail(w, err, action)
			return
		}
		_ = s.store.SetContainerStatus(r.Context(), ct.ID, string(optimistic))
		ct.Status = string(optimistic)
		s.json(w, http.StatusOK, ct)
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
	cd := s.containerDriver(w, ct.ServerID)
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
