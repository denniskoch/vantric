package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"vantric/internal/docker"
	dockerfactory "vantric/internal/docker/factory"
	"vantric/internal/store"
	"vantric/internal/tlspin"
)

// Docker hosts, and what runs on them.
//
// LISTINGS SPAN EVERY HOST and stamp each row with its hostId, the way
// the hypervisor catalog listings do. `?host=` narrows to one. A host
// that errors is skipped and logged rather than failing the page —
// one unreachable daemon should not hide the containers on the others.

func (s *Server) dockerRoutes(r chi.Router) {
	r.Get("/docker/hosts", s.listDockerHosts)
	r.Post("/docker/hosts", s.createDockerHost)
	r.Put("/docker/hosts/{id}", s.updateDockerHost)
	r.Delete("/docker/hosts/{id}", s.deleteDockerHost)
	// The fingerprint a host is currently presenting, so somebody can
	// compare it with what the host itself says. See peekDockerHost.
	r.Post("/docker/hosts/peek", s.peekDockerHost)

	r.Get("/docker/containers", s.listDockerContainers)
	r.Get("/docker/containers/{id}/logs", s.dockerContainerLogs)
	r.Post("/docker/containers/{id}/{action}", s.dockerContainerAction)
	r.Get("/docker/images", s.listDockerImages)
	r.Get("/docker/volumes", s.listDockerVolumes)
	r.Get("/docker/networks", s.listDockerNetworks)
}

type dockerHostView struct {
	store.DockerHost
	HasToken bool         `json:"hasToken"`
	Status   string       `json:"status"` // connected | unreachable | mismatch | unknown
	Info     *docker.Info `json:"info,omitempty"`
	Error    string       `json:"error,omitempty"`
	// Instance is the guest this daemon runs inside, where the console
	// knows one — THE CORRELATION THIS SECTION EXISTS FOR. Docker knows
	// its containers and Proxmox knows its guests, and neither knows
	// that the host called "paperless" is a VM you could take a backup
	// of.
	Instance string `json:"instance,omitempty"`
}

func (s *Server) probeDockerHost(ctx context.Context, h store.DockerHost) dockerHostView {
	view := dockerHostView{DockerHost: h, HasToken: h.Token != "", Status: "unknown"}
	provider, ok := s.dockerRegistry.Get(h.ID)
	if !ok {
		view.Error = "no driver — the record was saved but could not be built"
		return view
	}
	info, err := provider.Check(ctx)
	switch {
	case errors.Is(err, tlspin.ErrMismatch):
		// ITS OWN STATUS, not "unreachable". A host presenting the wrong
		// certificate and a host that is switched off look identical in
		// a list of red dots, and exactly one of them means somebody is
		// standing in the middle.
		view.Status = "mismatch"
		view.Error = err.Error()
	case err != nil:
		view.Status = "unreachable"
		view.Error = err.Error()
	default:
		view.Status = "connected"
		view.Info = info
	}
	return view
}

func (s *Server) listDockerHosts(w http.ResponseWriter, r *http.Request) {
	hosts, err := s.store.ListDockerHosts(r.Context())
	if err != nil {
		s.fail(w, err, "Docker hosts")
		return
	}
	// The guest list, once, to match daemons against. Best effort: a
	// hypervisor that is down costs the correlation, not the page.
	instances, _ := s.store.ListInstances(r.Context())
	containers, _ := s.store.ListContainers(r.Context())

	out := make([]dockerHostView, 0, len(hosts))
	for _, h := range hosts {
		view := s.probeDockerHost(r.Context(), h)
		if view.Info != nil {
			view.Instance = guestNamed(view.Info.Name, instances, containers)
		}
		out = append(out, view)
	}
	s.json(w, http.StatusOK, out)
}

// guestNamed finds the guest a Docker daemon is running inside.
//
// MATCHED ON THE HOSTNAME the daemon reports, which is the only thing
// the two systems share. Weaker than the SMBIOS UUID that joins
// instances to inventory hosts — a daemon in a container reports the
// container's hostname, not the guest's — and said so on the page
// rather than presented as certain.
func guestNamed(hostname string, instances []store.Instance, containers []store.Container) string {
	name := strings.ToLower(strings.TrimSpace(hostname))
	if name == "" {
		return ""
	}
	for _, i := range instances {
		if strings.ToLower(i.Name) == name {
			return i.Name
		}
	}
	for _, c := range containers {
		if strings.ToLower(c.Name) == name {
			return c.Name
		}
	}
	return ""
}

type dockerHostInput struct {
	Name        string `json:"name"`
	BaseURL     string `json:"baseUrl"`
	Token       string `json:"token"`
	Fingerprint string `json:"fingerprint"`
	InsecureTLS bool   `json:"insecureTls"`
}

// peekDockerHost reports the certificate a host is presenting, so the
// connect form can show a fingerprint to confirm.
//
// THE UNSAFE MOMENT, AND THE FORM SAYS SO. Accepting what comes back
// here is trust-on-first-use — it is only as good as the network being
// clean right now, which is the assumption pinning exists to remove. It
// exists because the alternative is retyping 64 hex characters, and a
// pin nobody can obtain is a pin nobody sets.
func (s *Server) peekDockerHost(w http.ResponseWriter, r *http.Request) {
	var in struct {
		BaseURL string `json:"baseUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a URL")
		return
	}
	parsed, err := url.Parse(strings.TrimSpace(in.BaseURL))
	if err != nil || parsed.Host == "" {
		s.err(w, http.StatusBadRequest, "that doesn't look like a URL")
		return
	}
	if parsed.Scheme != "https" {
		s.err(w, http.StatusBadRequest, "there is no certificate to read over http")
		return
	}
	address := parsed.Host
	if parsed.Port() == "" {
		address += ":443"
	}
	cert, err := tlspin.Peek(address)
	if err != nil {
		s.err(w, http.StatusBadGateway, "couldn't reach that host: "+err.Error())
		return
	}
	s.json(w, http.StatusOK, map[string]any{
		"fingerprint": tlspin.Fingerprint(cert),
		"subject":     cert.Subject.CommonName,
		"notAfter":    cert.NotAfter,
	})
}

func (s *Server) validDockerHost(w http.ResponseWriter, in *dockerHostInput) bool {
	in.Name = strings.TrimSpace(in.Name)
	in.BaseURL = strings.TrimRight(strings.TrimSpace(in.BaseURL), "/")
	in.Fingerprint = tlspin.Normalize(in.Fingerprint)
	if in.Name == "" {
		s.err(w, http.StatusBadRequest, "a host needs a name")
		return false
	}
	parsed, err := url.Parse(in.BaseURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		s.err(w, http.StatusBadRequest, "the address has to be an http:// or https:// URL")
		return false
	}
	return true
}

// connect builds a driver and proves it works before the record is
// stored, the rule every backend here follows: a saved host is a
// known-good one.
func (s *Server) connectDockerHost(ctx context.Context, host *store.DockerHost) (docker.Provider, error) {
	provider, err := dockerfactory.Build(host)
	if err != nil {
		return nil, err
	}
	if _, err := provider.Check(ctx); err != nil {
		return nil, err
	}
	return provider, nil
}

func (s *Server) createDockerHost(w http.ResponseWriter, r *http.Request) {
	var in dockerHostInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a Docker host")
		return
	}
	if !s.validDockerHost(w, &in) {
		return
	}
	host := &store.DockerHost{
		ID: uuid.NewString(), Name: in.Name, BaseURL: in.BaseURL,
		Token: in.Token, Fingerprint: in.Fingerprint, InsecureTLS: in.InsecureTLS,
	}
	provider, err := s.connectDockerHost(r.Context(), host)
	if err != nil {
		s.err(w, http.StatusBadGateway, "couldn't reach that host: "+err.Error())
		return
	}
	if err := s.store.CreateDockerHost(r.Context(), host); err != nil {
		s.fail(w, err, "saving the Docker host")
		return
	}
	s.dockerRegistry.Set(host.ID, provider)
	s.json(w, http.StatusCreated, dockerHostView{DockerHost: *host, HasToken: host.Token != ""})
}

func (s *Server) updateDockerHost(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	existing, err := s.store.DockerHost(r.Context(), id)
	if err != nil {
		s.fail(w, err, "the Docker host")
		return
	}
	var in dockerHostInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		s.err(w, http.StatusBadRequest, "expected a Docker host")
		return
	}
	if !s.validDockerHost(w, &in) {
		return
	}
	host := &store.DockerHost{
		ID: id, Name: in.Name, BaseURL: in.BaseURL, Token: in.Token,
		Fingerprint: in.Fingerprint, InsecureTLS: in.InsecureTLS,
	}
	// Blank keeps, so the check has to run against what will actually
	// be stored rather than against an empty credential.
	probe := *host
	if probe.Token == "" {
		probe.Token = existing.Token
	}
	provider, err := s.connectDockerHost(r.Context(), &probe)
	if err != nil {
		s.err(w, http.StatusBadGateway, "couldn't reach that host: "+err.Error())
		return
	}
	if err := s.store.UpdateDockerHost(r.Context(), host); err != nil {
		s.fail(w, err, "saving the Docker host")
		return
	}
	s.dockerRegistry.Set(id, provider)
	s.json(w, http.StatusOK, dockerHostView{DockerHost: *host, HasToken: probe.Token != ""})
}

func (s *Server) deleteDockerHost(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteDockerHost(r.Context(), id); err != nil {
		s.fail(w, err, "removing the Docker host")
		return
	}
	s.dockerRegistry.Remove(id)
	w.WriteHeader(http.StatusNoContent)
}

// listAcrossDockerHosts is the hypervisor catalog rule, one section
// over: every host, each row stamped, one that errors skipped rather
// than fatal.
func listAcrossDockerHosts[T any](
	s *Server,
	r *http.Request,
	list func(context.Context, docker.Provider) ([]T, error),
	stamp func(item *T, hostID string),
) ([]T, error) {
	hosts, err := s.store.ListDockerHosts(r.Context())
	if err != nil {
		return nil, err
	}
	only := r.URL.Query().Get("host")
	items := []T{}
	for _, h := range hosts {
		if only != "" && h.ID != only {
			continue
		}
		provider, ok := s.dockerRegistry.Get(h.ID)
		if !ok {
			continue
		}
		found, err := list(r.Context(), provider)
		if err != nil {
			s.log.Warn("docker listing failed", "host", h.Name, "error", err)
			continue
		}
		for i := range found {
			stamp(&found[i], h.ID)
		}
		items = append(items, found...)
	}
	return items, nil
}

func (s *Server) listDockerContainers(w http.ResponseWriter, r *http.Request) {
	items, err := listAcrossDockerHosts(s, r,
		func(ctx context.Context, p docker.Provider) ([]docker.Container, error) {
			return p.Containers(ctx)
		},
		func(c *docker.Container, id string) { c.HostID = id })
	if err != nil {
		s.fail(w, err, "containers")
		return
	}
	s.json(w, http.StatusOK, items)
}

func (s *Server) listDockerImages(w http.ResponseWriter, r *http.Request) {
	items, err := listAcrossDockerHosts(s, r,
		func(ctx context.Context, p docker.Provider) ([]docker.Image, error) {
			return p.Images(ctx)
		},
		func(i *docker.Image, id string) { i.HostID = id })
	if err != nil {
		s.fail(w, err, "images")
		return
	}
	s.json(w, http.StatusOK, items)
}

func (s *Server) listDockerVolumes(w http.ResponseWriter, r *http.Request) {
	items, err := listAcrossDockerHosts(s, r,
		func(ctx context.Context, p docker.Provider) ([]docker.Volume, error) {
			return p.Volumes(ctx)
		},
		func(v *docker.Volume, id string) { v.HostID = id })
	if err != nil {
		s.fail(w, err, "volumes")
		return
	}
	s.json(w, http.StatusOK, items)
}

func (s *Server) listDockerNetworks(w http.ResponseWriter, r *http.Request) {
	items, err := listAcrossDockerHosts(s, r,
		func(ctx context.Context, p docker.Provider) ([]docker.Network, error) {
			return p.Networks(ctx)
		},
		func(n *docker.Network, id string) { n.HostID = id })
	if err != nil {
		s.fail(w, err, "networks")
		return
	}
	s.json(w, http.StatusOK, items)
}

// dockerProvider resolves the one host a container-scoped call is for.
// Required, not defaulted: a container id is only unique within its
// daemon, and guessing which one would eventually restart the wrong
// thing.
func (s *Server) dockerProvider(w http.ResponseWriter, r *http.Request) docker.Provider {
	id := r.URL.Query().Get("host")
	if id == "" {
		s.err(w, http.StatusBadRequest, "which host? a container id only means something on one")
		return nil
	}
	provider, ok := s.dockerRegistry.Get(id)
	if !ok {
		s.err(w, http.StatusNotFound, "no such Docker host")
		return nil
	}
	return provider
}

func (s *Server) dockerContainerLogs(w http.ResponseWriter, r *http.Request) {
	provider := s.dockerProvider(w, r)
	if provider == nil {
		return
	}
	lines, _ := strconv.Atoi(r.URL.Query().Get("lines"))
	out, err := provider.Logs(r.Context(), chi.URLParam(r, "id"), lines)
	if err != nil {
		s.dockerError(w, err, "the container's logs")
		return
	}
	s.json(w, http.StatusOK, map[string]string{"logs": out})
}

func (s *Server) dockerContainerAction(w http.ResponseWriter, r *http.Request) {
	provider := s.dockerProvider(w, r)
	if provider == nil {
		return
	}
	if err := provider.Act(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "action")); err != nil {
		s.dockerError(w, err, "the container")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// dockerError keeps the far end's two refusals apart. One is a setting
// somebody can change; the other never will be, and a UI offering to
// enable it would be lying.
func (s *Server) dockerError(w http.ResponseWriter, err error, doing string) {
	switch {
	case errors.Is(err, docker.ErrWriteDisabled):
		s.err(w, http.StatusForbidden,
			"this host is running read-only — its front door has writes disabled")
	case errors.Is(err, docker.ErrForbidden):
		s.err(w, http.StatusForbidden,
			"that is never allowed through this host's front door")
	case errors.Is(err, docker.ErrNotFound):
		s.err(w, http.StatusNotFound, "no such container on that host")
	default:
		s.fail(w, err, doing)
	}
}
