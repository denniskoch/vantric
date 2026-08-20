// Package api exposes the REST API consumed by the frontend.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/netip"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"vantric/internal/database"
	"vantric/internal/dns"
	"vantric/internal/hypervisor"
	"vantric/internal/identity"
	"vantric/internal/inventory"
	"vantric/internal/kev"
	"vantric/internal/network"
	"vantric/internal/nvd"
	"vantric/internal/storage"
	"vantric/internal/store"
)

var nameRe = regexp.MustCompile(`^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$`)

// pveIDRe is what a node or a storage may be called.
//
// Nothing SECURITY rests on it: internal/hypervisor/proxmox escapes
// every value it interpolates into a path, which is what makes a
// hostile one harmless. This is so a typo is a 400 from the console
// rather than a puzzling error from the hypervisor three calls later.
//
// It is looser than nameRe deliberately. nameRe is what THIS console
// names a guest, and it forbids dots, underscores and capitals — while
// Proxmox happily calls a storage local_zfs or pbs.backup, and refusing
// a name the hypervisor accepts would make the console unusable on a
// lab that already has one.
var pveIDRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$`)

// placementError names the first unusable placement field, or "".
// Blank passes: the field is optional in some of these flows, and the
// handlers that require it say so themselves.
func placementError(node, storage string) string {
	if node != "" && !pveIDRe.MatchString(node) {
		return "that isn't a valid node name"
	}
	if storage != "" && !pveIDRe.MatchString(storage) {
		return "that isn't a valid storage name"
	}
	return ""
}

// How long to keep trying to boot a freshly created instance, and how
// often. A full clone of a large template holds the VM lock for as long
// as the copy takes, so this has to outlast a slow disk rather than a
// slow API.
const (
	startRetryFor   = 10 * time.Minute
	startRetryEvery = 5 * time.Second
)

type Server struct {
	store       *store.Store
	registry    *hypervisor.Registry
	dnsRegistry *dns.Registry
	dbRegistry  *database.Registry
	// identityRegistry holds the live identity providers (authentik).
	identityRegistry *identity.Registry
	// networkRegistry holds the live network controllers (UniFi).
	networkRegistry *network.Registry
	// storageRegistry holds the live object stores (RustFS).
	storageRegistry *storage.Registry
	// inventoryRegistry holds the live device inventory services
	// (FleetDM) — what's installed inside the guests.
	inventoryRegistry *inventory.Registry
	// nvd looks CVEs up in the public vulnerability database. No
	// credential, cached, and never fatal — see internal/nvd.
	nvd *nvd.Client
	// kev is CISA's catalogue of what is actually being exploited.
	// Same shape as nvd: a public reference, not a configured backend.
	kev *kev.Client
	// enrich fills the CVE cache in the background — see enricher.go.
	enrich    *enricher
	log       *slog.Logger
	staticDir string
	// signIns bounds password guessing — see loginlimit.go.
	signIns *signInLimiter
	// trustedProxies are the peers whose forwarding headers this app
	// believes. Empty means none — see clientaddr.go.
	trustedProxies []netip.Prefix
	// siteURL is the address the outside world reaches this console at,
	// when that isn't the one the request arrived on. See config.SiteURL.
	siteURL string
	// dataDir is where the store lives; the console's SSH key sits
	// beside it.
	dataDir string
	ssh     SSHOptions
	// ops tracks the work that outlives its request — see operations.go.
	ops *opRegistry
}

// SSHOptions is what the browser terminal is allowed to do to a guest
// before it connects. See config.SSH, which supplies it.
type SSHOptions struct {
	Provision bool
	Sudo      bool
}

func New(
	st *store.Store,
	registry *hypervisor.Registry,
	dnsRegistry *dns.Registry,
	dbRegistry *database.Registry,
	identityRegistry *identity.Registry,
	networkRegistry *network.Registry,
	inventoryRegistry *inventory.Registry,
	storageRegistry *storage.Registry,
	log *slog.Logger,
	staticDir string,
	dataDir string,
	siteURL string,
	trustedProxies string,
	sshOpts SSHOptions,
) *Server {
	client := nvd.New()
	srv := &Server{
		store: st, registry: registry, dnsRegistry: dnsRegistry, dbRegistry: dbRegistry,
		identityRegistry: identityRegistry, networkRegistry: networkRegistry,
		inventoryRegistry: inventoryRegistry,
		storageRegistry:   storageRegistry,
		nvd:               client,
		kev:               kev.New(),
		log:               log, staticDir: staticDir, dataDir: dataDir, siteURL: siteURL, ssh: sshOpts,
		ops:            newOpRegistry(),
		trustedProxies: parseTrustedProxies(trustedProxies, log),
		signIns:        newSignInLimiter(),
	}
	srv.enrich = newEnricher(st, inventoryRegistry, client, log)
	// The key is a stored setting rather than config, so it's loaded
	// here and re-applied whenever it's changed through the API.
	if key, err := st.GetSetting(context.Background(), nvdAPIKeySetting); err == nil {
		client.SetAPIKey(key)
	}
	if value, err := st.GetSetting(context.Background(), nvdEnrichSetting); err == nil {
		srv.enrich.SetEnabled(value != "off")
	}
	return srv
}

// EnrichCVEs runs the background pass that fills the CVE cache. Started
// by main alongside the reconciler; returns when the context ends.
func (s *Server) EnrichCVEs(ctx context.Context) { s.enrich.Run(ctx) }

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	// Not middleware.RealIP: it believes X-Forwarded-For from anyone.
	// See clientaddr.go.
	r.Use(middleware.RequestID, s.realIP, middleware.Recoverer)

	r.Route("/api/v1", func(r chi.Router) {
		// Sign-in itself can't require being signed in, and /auth/me is
		// how the app finds out which it is.
		r.Post("/auth/login", s.login)
		r.Post("/auth/logout", s.logout)
		r.Get("/auth/me", s.currentUser)
		// Which doors exist, and the round trip through the identity
		// provider — all necessarily reachable before anyone is signed in.
		r.Get("/auth/providers", s.authProviders)
		r.Get("/auth/oidc/start", s.oidcStart)
		r.Get("/auth/oidc/callback", s.oidcCallback)

		// The one route outside the session, and it carries its own key:
		// a machine being enrolled has no account to sign in with. See
		// installers.go.
		r.Get("/installers/{name}/download", s.serveInstaller)

		r.Group(func(r chi.Router) {
			// Order matters: requireAuth first so both of the others
			// know who the actor is, and requireRole before auditing so
			// a refusal is recorded as the 403 it was.
			r.Use(s.requireAuth, s.auditing, s.requireRole)
			s.protectedRoutes(r)
		})
	})

	if s.staticDir != "" {
		r.Handle("/*", spaHandler(s.staticDir))
	}
	return r
}

// protectedRoutes is everything behind a session — which is everything
// else. A console that lets an anonymous visitor list your hypervisors
// has already given away the map.
func (s *Server) protectedRoutes(r chi.Router) {
	{
		r.Post("/auth/password", s.changeOwnPassword)
		s.iamRoutes(r)

		r.Get("/overview", s.overview)
		r.Get("/security/overview", s.securityOverview)
		r.Get("/nodes", s.listNodes)
		r.Get("/nodes/{node}", s.nodeStatus)
		r.Get("/nodes/{node}/metrics", s.nodeMetrics)
		r.Get("/bridges", s.listBridges)
		r.Get("/images", s.listImages)
		r.Get("/disks", s.listDisks)
		r.Get("/snapshots", s.listSnapshots)
		r.Get("/isos", s.listISOs)
		r.Post("/isos/download", s.downloadISO)
		r.Post("/isos/upload", s.uploadVolume("iso", isoExtensions))
		r.Delete("/isos", s.deleteVolume("iso", "ISO", "iso"))
		r.Delete("/ct-templates", s.deleteVolume("vztmpl", "CT template", "ctTemplate"))
		r.Get("/backups", s.listBackups)
		r.Delete("/backups", s.deleteVolume("backup", "backup", "backup"))
		r.Get("/images/{id}", s.describeImage)
		r.Post("/images/{id}/description", s.setImageDescription)
		r.Delete("/images/{id}", s.deleteImage)
		r.Get("/cloud-images", s.listCloudImages)
		r.Post("/cloud-images/download", s.downloadCloudImage)
		r.Post("/cloud-images/upload", s.uploadVolume("import", cloudImageExtensions))
		r.Delete("/cloud-images", s.deleteVolume("import", "cloud image", "cloudImage"))
		r.Post("/vm-templates/build", s.buildTemplate)

		// Everything long-running reports here rather than making each
		// page that starts something responsible for watching it.
		r.Get("/audit", s.listAudit)
		r.Get("/operations", s.listOperations)
		r.Delete("/operations", s.clearOperations)
		r.Delete("/operations/{id}", s.dismissOperation)
		r.Get("/datastores", s.listDatastores)
		r.Get("/ct-templates", s.listCTTemplates)

		// Your SSH identity, not the console's — see ssh.go.
		r.Get("/ssh-key", s.mySSHKey)
		r.Post("/ssh-key/rotate", s.rotateMySSHKey)
		r.Put("/ssh-key", s.importMySSHKey)
		r.Get("/hypervisor-types", s.listHypervisorTypes)
		r.Get("/hypervisors", s.listHypervisors)
		r.Post("/hypervisors", s.createHypervisor)
		r.Put("/hypervisors/{id}", s.updateHypervisor)
		r.Delete("/hypervisors/{id}", s.deleteHypervisor)

		s.containerRoutes(r)
		s.dnsRoutes(r)
		s.databaseRoutes(r)
		s.identityRoutes(r)
		s.networkRoutes(r)
		s.inventoryRoutes(r)
		s.installerRoutes(r)
		s.storageRoutes(r)

		r.Get("/instances", s.listInstances)
		r.Post("/instances", s.createInstance)
		r.Route("/instances/{instance}", func(r chi.Router) {
			r.Get("/", s.getInstance)
			r.Get("/describe", s.describeInstance)
			r.Get("/metrics", s.instanceMetrics)
			r.Get("/os-info", s.instanceOSInfo)
			r.Get("/inventory", s.instanceInventory)
			r.Post("/sftp/upload", s.sftpUpload)
			r.Get("/sftp/download", s.sftpDownload)
			r.Get("/backups", s.instanceBackups)
			r.Get("/ssh", s.instanceSSH)
			r.Delete("/", s.deleteInstance)
			r.Post("/start", s.instanceAction("start"))
			r.Post("/stop", s.instanceAction("stop"))
			r.Post("/reset", s.instanceAction("reset"))
			r.Post("/protection", s.setInstanceProtection)
			r.Post("/description", s.setInstanceDescription)
			r.Post("/rename", s.renameInstance)
		})
	}
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
	if errors.Is(err, store.ErrNotFound) || errors.Is(err, hypervisor.ErrNotFound) ||
		errors.Is(err, storage.ErrNotFound) {
		s.err(w, http.StatusNotFound, context+": not found")
		return
	}
	s.log.Error(context, "error", err)
	s.err(w, http.StatusInternalServerError, context+": "+err.Error())
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

// claimAdopted turns the reconciler's adoption of a VM this app just
// created into the record the create flow meant to write. It returns
// nil when the clash is a real one — a different instance that happens
// to share the name — so that still reports as a conflict.
func (s *Server) claimAdopted(ctx context.Context, inst *store.Instance) (*store.Instance, error) {
	existing, err := s.store.GetInstance(ctx, inst.Name)
	if err != nil {
		return nil, err
	}
	sameVM := existing.HypervisorID == inst.HypervisorID &&
		(existing.DriverID == inst.DriverID || existing.DriverID == "")
	if !sameVM {
		return nil, nil
	}
	inst.ID = existing.ID
	if err := s.store.ClaimInstance(ctx, inst); err != nil {
		return nil, err
	}
	s.log.Info("claimed an instance the reconciler adopted mid-create",
		"name", inst.Name, "driverId", inst.DriverID)
	return inst, nil
}

// instanceDriver resolves an instance by name to its live driver.
func (s *Server) instanceDriver(w http.ResponseWriter, r *http.Request) (*store.Instance, hypervisor.Driver) {
	inst, err := s.store.GetInstance(r.Context(), chi.URLParam(r, "instance"))
	if err != nil {
		s.fail(w, err, "instance")
		return nil, nil
	}
	driver, ok := s.registry.Get(inst.HypervisorID)
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

// readTimeframe validates the ?timeframe= a metrics query carries.
// Shared by guests and hosts: both read the same RRD resolutions, and
// one of them silently accepting a fifth value would be a bug found
// only by whoever typed it.
func (s *Server) readTimeframe(w http.ResponseWriter, r *http.Request) (hypervisor.MetricTimeframe, bool) {
	timeframe := hypervisor.MetricTimeframe(r.URL.Query().Get("timeframe"))
	switch timeframe {
	case "", hypervisor.TimeframeHour, hypervisor.TimeframeDay,
		hypervisor.TimeframeWeek, hypervisor.TimeframeMonth:
		return timeframe, true
	}
	s.err(w, http.StatusBadRequest, "timeframe must be hour, day, week or month")
	return "", false
}

func (s *Server) instanceMetrics(w http.ResponseWriter, r *http.Request) {
	inst, driver := s.instanceDriver(w, r)
	if driver == nil {
		return
	}
	timeframe, ok := s.readTimeframe(w, r)
	if !ok {
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
		Name         string           `json:"name"`
		HypervisorID string           `json:"hypervisorId"`
		Node         string           `json:"node"`
		CPUs         int              `json:"cpus"`
		MemoryMB     int              `json:"memoryMb"`
		DiskGB       int              `json:"diskGb"`
		ImageID      string           `json:"imageId"`
		NetBridge    string           `json:"netBridge"`
		VLANTag      int              `json:"vlanTag"`
		CloudInit    cloudInitRequest `json:"cloudInit"`
		Description  string           `json:"description"`
		Serial       string           `json:"serial"`
		Protected    bool             `json:"protected"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return
	}
	if req.HypervisorID == "" || req.Node == "" || req.ImageID == "" {
		s.err(w, http.StatusBadRequest, "serverId, node and imageId are required")
		return
	}
	if msg := placementError(req.Node, ""); msg != "" {
		s.err(w, http.StatusBadRequest, msg)
		return
	}
	driver, ok := s.registry.Get(req.HypervisorID)
	if !ok {
		s.err(w, http.StatusBadRequest, "unknown serverId")
		return
	}
	// Sizing is typed in, not chosen from a catalog of presets: a lab
	// has one of everything and "4 vCPU, 8 GB" is the answer, not the
	// name of a shape somebody has to define first.
	if req.CPUs < 1 || req.CPUs > 128 {
		s.err(w, http.StatusBadRequest, "cpus must be between 1 and 128")
		return
	}
	if req.MemoryMB < 128 {
		s.err(w, http.StatusBadRequest, "memoryMb must be at least 128")
		return
	}
	if req.DiskGB == 0 {
		req.DiskGB = 10
	}
	if existing, err := s.store.GetInstance(r.Context(), req.Name); err == nil && existing != nil {
		s.err(w, http.StatusConflict, "an instance with this name already exists")
		return
	}

	if len(req.Serial) > 64 {
		s.err(w, http.StatusBadRequest, "serial must be 64 characters or fewer")
		return
	}

	cloudInit, err := req.CloudInit.toCloudInit()
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}

	spec := hypervisor.InstanceSpec{
		Name:          req.Name,
		Node:          req.Node,
		CPUs:          req.CPUs,
		MemoryMB:      req.MemoryMB,
		DiskGB:        req.DiskGB,
		ImageID:       req.ImageID,
		NetworkBridge: req.NetBridge,
		VLANTag:       req.VLANTag,
		CloudInit:     cloudInit,
		Description:   req.Description,
		Serial:        req.Serial,
	}

	// Everything above answers "is this a valid request", which is the
	// part the form is entitled to hear about. The clone itself can run
	// for minutes, so it goes to the background and the console reports
	// it in the notification bell.
	op := s.ops.start("Creating instance "+req.Name, "instance", req.Name,
		req.HypervisorID, "/compute/instances/"+req.Name)
	s.run(op, "Instance created", func(ctx context.Context, step func(string)) error {
		step("Cloning " + req.ImageID)
		driverID, err := driver.Create(ctx, spec)
		// A CREATE CAN HALF-SUCCEED: the VM exists but its settings
		// didn't apply. When that happens the driver hands back the id
		// alongside the error, and the record is written anyway — a
		// machine with no record here is worse than one whose record is
		// followed by a failed operation, because the reconciler would
		// adopt it under a name nobody chose and mark it protected.
		if driverID == "" {
			return err
		}
		step("Recording the instance")
		if saveErr := s.saveNewInstance(ctx, &store.Instance{
			ID:           uuid.NewString(),
			Name:         req.Name,
			HypervisorID: req.HypervisorID,
			Node:         req.Node,
			CPUs:         req.CPUs,
			MemoryMB:     req.MemoryMB,
			DiskGB:       req.DiskGB,
			ImageID:      req.ImageID,
			Status:       string(hypervisor.StatusProvisioning),
			DriverID:     driverID,
			NetBridge:    req.NetBridge,
			VLANTag:      req.VLANTag,
			Description:  req.Description,
			Protected:    req.Protected,
		}); saveErr != nil {
			return saveErr
		}
		if err != nil {
			// The machine is recorded and will appear in the list; the
			// operation still fails, because what it was asked to build
			// is not what exists.
			return err
		}
		step("Starting " + req.Name)
		return s.startNewInstance(ctx, driver, driverID)
	})
	s.json(w, http.StatusAccepted, op)
}

// startNewInstance boots a VM the console has just created.
//
// A new instance powers on by itself — GCP's behaviour, and the one
// people expect from a console — but the request can't simply be fired
// once: a full clone leaves the VM locked for as long as the copy
// takes, and a start issued into that lock fails. The old code fired it
// from inside the driver and dropped the error, which turned a
// transient lock into a VM that sat stopped for no stated reason. So it
// retries while the lock clears, and if it never does, the operation
// says so — the record is already written by then, so Start is one
// click away.
func (s *Server) startNewInstance(ctx context.Context, driver hypervisor.Driver, driverID string) error {
	deadline := time.Now().Add(startRetryFor)
	var err error
	for {
		if err = driver.Start(ctx, driverID); err == nil {
			return nil
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			return fmt.Errorf("the instance was created but wouldn't start: %w", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(startRetryEvery):
		}
	}
}

// saveNewInstance writes the record for a VM the driver has just built,
// against a reconciler that may already have found it.
//
// The reconciler sweeps every two seconds and adopts anything on the
// hypervisor it doesn't recognise, so it can easily have taken this VM
// already — under our name, or under vm-<vmid> if Proxmox hadn't named
// it yet. Either way there's a record for this machine and it should
// become ours rather than a second row or an error: the failure this
// replaced was "UNIQUE constraint failed: instances.name" reported over
// a machine that had in fact been created.
func (s *Server) saveNewInstance(ctx context.Context, inst *store.Instance) error {
	if adopted, err := s.store.GetInstanceByDriverID(ctx, inst.HypervisorID, inst.DriverID); err == nil {
		inst.ID = adopted.ID
		if err := s.store.ClaimInstance(ctx, inst); err != nil {
			return err
		}
		s.log.Info("claimed an instance the reconciler adopted mid-create",
			"name", inst.Name, "adoptedAs", adopted.Name, "driverId", inst.DriverID)
		return nil
	}
	if err := s.store.CreateInstance(ctx, inst); err != nil {
		claimed, claimErr := s.claimAdopted(ctx, inst)
		if claimErr != nil {
			return claimErr
		}
		if claimed == nil {
			return err
		}
	}
	return nil
}

func (s *Server) instanceAction(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		inst, err := s.store.GetInstance(r.Context(), chi.URLParam(r, "instance"))
		if err != nil {
			s.fail(w, err, "instance")
			return
		}
		driver, ok := s.registry.Get(inst.HypervisorID)
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

// The hypervisor's notes field is generous, but a console shouldn't be
// the way somebody discovers its ceiling.
const maxDescription = 4096

// setInstanceDescription writes notes to the HYPERVISOR and mirrors
// them here. Proxmox shows the same field in its own Notes panel, so
// this is editing one thing in two places rather than keeping a
// private copy — and the store's copy exists only so the list is right
// without a Describe per row.
func (s *Server) setInstanceDescription(w http.ResponseWriter, r *http.Request) {
	inst, driver := s.instanceDriver(w, r)
	if inst == nil {
		return
	}
	description, ok := s.readDescription(w, r)
	if !ok {
		return
	}
	if err := driver.SetDescription(r.Context(), inst.DriverID, description); err != nil {
		s.fail(w, err, "saving the description")
		return
	}
	if err := s.store.SetInstanceDescription(r.Context(), inst.ID, description); err != nil {
		s.fail(w, err, "saving the description")
		return
	}
	inst.Description = description
	s.json(w, http.StatusOK, inst)
}

// instanceNameRe is what Proxmox accepts as a VM name: a DNS label.
var instanceNameRe = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`)

// renameInstance changes the guest's name on the HYPERVISOR and then
// here, in that order — the hypervisor is the source of truth for the
// shape of a guest, and the reconciler syncs names back from it every
// sweep. Writing our copy first would mean a failed hypervisor call
// leaves a name that gets silently reverted seconds later.
//
// A rename is a LABEL on the hypervisor. The guest never sees it: no
// hostname changes, nothing inside the machine is touched. Renaming
// the operating system's own hostname is a separate act, done in the
// guest.
//
// The cost is that the name is this console's key — every route is
// /instances/{name} — so the caller has to follow the guest to its new
// URL, and an open SSH window is addressed by the old one.
func (s *Server) renameInstance(w http.ResponseWriter, r *http.Request) {
	inst, driver := s.instanceDriver(w, r)
	if inst == nil {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	name := strings.TrimSpace(req.Name)
	switch {
	case name == inst.Name:
		s.json(w, http.StatusOK, inst) // nothing to do
		return
	case !instanceNameRe.MatchString(name):
		s.err(w, http.StatusBadRequest,
			"name must be letters, digits and hyphens, starting and ending with one")
		return
	}
	// Names are unique here even though a hypervisor may allow
	// duplicates, because this console addresses guests by name.
	if existing, err := s.store.GetInstance(r.Context(), name); err == nil && existing != nil {
		s.err(w, http.StatusConflict, "an instance called "+name+" already exists")
		return
	}
	if err := driver.SetName(r.Context(), inst.DriverID, name); err != nil {
		s.fail(w, err, "renaming on the hypervisor")
		return
	}
	if err := s.store.RenameInstance(r.Context(), inst.ID, name); err != nil {
		// The hypervisor already took it, and the reconciler will
		// bring our copy in line on its next sweep, so this is worth
		// logging rather than failing the rename.
		s.log.Error("renamed on the hypervisor but not here",
			"instance", inst.Name, "to", name, "error", err)
	}
	inst.Name = name
	s.json(w, http.StatusOK, inst)
}

func (s *Server) readDescription(w http.ResponseWriter, r *http.Request) (string, bool) {
	var req struct {
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return "", false
	}
	if len(req.Description) > maxDescription {
		s.err(w, http.StatusBadRequest,
			fmt.Sprintf("description must be %d characters or fewer", maxDescription))
		return "", false
	}
	return req.Description, true
}

// poweredOn is "the guest is up", as opposed to merely mid-transition.
func poweredOn(status string) bool {
	return status == string(hypervisor.StatusRunning) || status == string(hypervisor.StatusStaging)
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
	// A powered-on VM is one somebody may still be using, and destroying
	// it takes its disks with it. Stopping first is one click and makes
	// the decision twice; pulling the power as a side effect of Delete
	// makes it never. Transitional states are deliberately allowed
	// through: a create that died in PROVISIONING has to be removable.
	if poweredOn(inst.Status) {
		s.err(w, http.StatusConflict,
			"stop "+inst.Name+" before deleting it — it is "+strings.ToLower(inst.Status))
		return
	}
	driver, ok := s.registry.Get(inst.HypervisorID)
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
