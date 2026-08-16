package api

import (
	"context"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"vantric/internal/hypervisor"
	"vantric/internal/store"
)

// Catalog handlers list hypervisor-side inventory (zones, templates,
// storage). They span every registered server by default so the UI can
// show one table with a Server column, the way instance lists do.
// `?server=` narrows to a single server, which the create flows use.

// listAcrossServers concatenates one listing call per registered server,
// stamping each item with the server it came from. A server that fails
// is logged and skipped rather than failing the whole page: one
// unreachable host shouldn't blank out the others' inventory.
func listAcrossServers[T any](
	s *Server,
	r *http.Request,
	list func(context.Context, hypervisor.Driver) ([]T, error),
	stamp func(item *T, serverID string),
) ([]T, error) {
	servers, err := s.store.ListServers(r.Context())
	if err != nil {
		return nil, err
	}
	if only := r.URL.Query().Get("server"); only != "" {
		servers = slices.DeleteFunc(servers, func(sv store.Server) bool { return sv.ID != only })
	}
	items := []T{}
	for _, sv := range servers {
		driver, ok := s.registry.Get(sv.ID)
		if !ok {
			continue
		}
		found, err := list(r.Context(), driver)
		if err != nil {
			s.log.Warn("catalog listing failed", "server", sv.Name, "error", err)
			continue
		}
		for i := range found {
			stamp(&found[i], sv.ID)
		}
		items = append(items, found...)
	}
	return items, nil
}

func (s *Server) listZones(w http.ResponseWriter, r *http.Request) {
	zones, err := listAcrossServers(s, r,
		func(ctx context.Context, d hypervisor.Driver) ([]hypervisor.Zone, error) {
			return d.Zones(ctx)
		},
		// Stamped like every other catalog listing. A zone name is only
		// unique WITHIN a server — two hypervisors may each call their
		// host "pve1" — so the pair is what addresses one.
		func(z *hypervisor.Zone, id string) { z.ServerID = id })
	if err != nil {
		s.fail(w, err, "zones")
		return
	}
	s.json(w, http.StatusOK, zones)
}

// zoneStatus and zoneMetrics describe one host, read on demand for the
// zone detail view. They take ?server= like every other single-item
// catalog read, since the name alone doesn't identify a host.

func (s *Server) zoneStatus(w http.ResponseWriter, r *http.Request) {
	driver := s.driverForServer(w, r)
	if driver == nil {
		return
	}
	status, err := driver.NodeStatus(r.Context(), chi.URLParam(r, "zone"))
	if err != nil {
		s.fail(w, err, "zone")
		return
	}
	status.ServerID = r.URL.Query().Get("server")
	s.json(w, http.StatusOK, status)
}

func (s *Server) zoneMetrics(w http.ResponseWriter, r *http.Request) {
	driver := s.driverForServer(w, r)
	if driver == nil {
		return
	}
	timeframe, ok := s.readTimeframe(w, r)
	if !ok {
		return
	}
	points, err := driver.NodeMetrics(r.Context(), chi.URLParam(r, "zone"), timeframe)
	if err != nil {
		s.fail(w, err, "zone metrics")
		return
	}
	if points == nil {
		points = []hypervisor.MetricPoint{}
	}
	s.json(w, http.StatusOK, points)
}

func (s *Server) listBridges(w http.ResponseWriter, r *http.Request) {
	bridges, err := listAcrossServers(s, r,
		func(ctx context.Context, d hypervisor.Driver) ([]hypervisor.Bridge, error) {
			return d.Bridges(ctx)
		},
		func(b *hypervisor.Bridge, id string) { b.ServerID = id })
	if err != nil {
		s.fail(w, err, "bridges")
		return
	}
	slices.SortFunc(bridges, func(a, b hypervisor.Bridge) int {
		if c := strings.Compare(a.Zone, b.Zone); c != 0 {
			return c
		}
		return strings.Compare(a.Name, b.Name)
	})
	s.json(w, http.StatusOK, bridges)
}

func (s *Server) listImages(w http.ResponseWriter, r *http.Request) {
	images, err := listAcrossServers(s, r,
		func(ctx context.Context, d hypervisor.Driver) ([]hypervisor.Image, error) {
			return d.Images(ctx)
		},
		func(i *hypervisor.Image, id string) { i.ServerID = id })
	if err != nil {
		s.fail(w, err, "images")
		return
	}
	slices.SortFunc(images, func(a, b hypervisor.Image) int {
		return strings.Compare(a.Name, b.Name)
	})
	s.json(w, http.StatusOK, images)
}

func (s *Server) listDisks(w http.ResponseWriter, r *http.Request) {
	disks, err := listAcrossServers(s, r,
		func(ctx context.Context, d hypervisor.Driver) ([]hypervisor.Disk, error) {
			return d.Disks(ctx)
		},
		func(i *hypervisor.Disk, id string) { i.ServerID = id })
	if err != nil {
		s.fail(w, err, "disks")
		return
	}
	slices.SortFunc(disks, func(a, b hypervisor.Disk) int {
		if c := strings.Compare(a.InUseBy, b.InUseBy); c != 0 {
			return c
		}
		return strings.Compare(a.Name, b.Name)
	})
	s.json(w, http.StatusOK, disks)
}

func (s *Server) listSnapshots(w http.ResponseWriter, r *http.Request) {
	snapshots, err := listAcrossServers(s, r,
		func(ctx context.Context, d hypervisor.Driver) ([]hypervisor.Snapshot, error) {
			return d.Snapshots(ctx)
		},
		func(i *hypervisor.Snapshot, id string) { i.ServerID = id })
	if err != nil {
		s.fail(w, err, "snapshots")
		return
	}
	slices.SortFunc(snapshots, func(a, b hypervisor.Snapshot) int {
		return int(b.CreatedAt - a.CreatedAt) // newest first
	})
	s.json(w, http.StatusOK, snapshots)
}

func (s *Server) listISOs(w http.ResponseWriter, r *http.Request) {
	isos, err := listAcrossServers(s, r,
		func(ctx context.Context, d hypervisor.Driver) ([]hypervisor.ISO, error) {
			return d.ISOs(ctx)
		},
		func(i *hypervisor.ISO, id string) { i.ServerID = id })
	if err != nil {
		s.fail(w, err, "isos")
		return
	}
	slices.SortFunc(isos, func(a, b hypervisor.ISO) int {
		return strings.Compare(a.Name, b.Name)
	})
	s.json(w, http.StatusOK, isos)
}

// listBackups spans every server that keeps a backup catalog, newest
// first — a backup list is read to answer "what can I restore right
// now", so recency beats alphabetical order here.
func (s *Server) listBackups(w http.ResponseWriter, r *http.Request) {
	backups, err := listAcrossServers(s, r,
		func(ctx context.Context, d hypervisor.Driver) ([]hypervisor.Backup, error) {
			bd, ok := d.(hypervisor.BackupDriver)
			if !ok {
				return nil, nil
			}
			return bd.Backups(ctx)
		},
		func(b *hypervisor.Backup, id string) { b.ServerID = id })
	if err != nil {
		s.fail(w, err, "backups")
		return
	}
	slices.SortFunc(backups, func(a, b hypervisor.Backup) int {
		if a.CreatedAt != b.CreatedAt {
			return int(b.CreatedAt - a.CreatedAt)
		}
		return strings.Compare(a.Name, b.Name)
	})
	s.json(w, http.StatusOK, backups)
}

// instanceBackupsView answers three different questions with three
// different shapes, because collapsing them loses the finding: a
// backend with no backup catalog is not the same as a guest nobody has
// ever backed up, and neither is an error reading the catalog.
type instanceBackupsView struct {
	// Supported is false when this instance's hypervisor keeps no
	// backup catalog at all.
	Supported bool                `json:"supported"`
	Backups   []hypervisor.Backup `json:"backups"`
	// Stale marks a newest backup older than the console's threshold,
	// the same one the Cloud overview raises a problem for. Computed
	// here so the two can't drift apart.
	Stale          bool `json:"stale"`
	StaleAfterDays int  `json:"staleAfterDays"`
	// Error keeps a failed catalog read from blanking the tab.
	Error string `json:"error,omitempty"`
}

// instanceBackups lists the archives that belong to one guest.
//
// It asks only that guest's OWN server, unlike the estate-wide listing:
// a vmid is unique per hypervisor, not across them, so spanning servers
// would attribute another guest's archives to this one. Read on demand
// and never polled — it is the hypervisor's catalog, and it changes
// when its backup job runs, not when this page is open.
func (s *Server) instanceBackups(w http.ResponseWriter, r *http.Request) {
	inst, driver := s.instanceDriver(w, r)
	if driver == nil {
		return
	}
	view := instanceBackupsView{
		Backups:        []hypervisor.Backup{},
		StaleAfterDays: int(backupStaleAfter / (24 * time.Hour)),
	}
	bd, ok := driver.(hypervisor.BackupDriver)
	if !ok {
		s.json(w, http.StatusOK, view)
		return
	}
	view.Supported = true

	all, err := bd.Backups(r.Context())
	if err != nil {
		view.Error = err.Error()
		s.json(w, http.StatusOK, view)
		return
	}
	vmid, err := strconv.Atoi(inst.DriverID)
	if err != nil {
		// Nothing to match on; say so rather than reporting "none",
		// which would read as "this guest is not backed up".
		view.Error = "this instance has no numeric hypervisor id to match backups against"
		s.json(w, http.StatusOK, view)
		return
	}
	for _, b := range all {
		if b.VMID == vmid {
			b.ServerID = inst.ServerID
			view.Backups = append(view.Backups, b)
		}
	}
	slices.SortFunc(view.Backups, func(a, b hypervisor.Backup) int {
		if a.CreatedAt != b.CreatedAt {
			return int(b.CreatedAt - a.CreatedAt)
		}
		return strings.Compare(a.Name, b.Name)
	})
	if len(view.Backups) > 0 {
		view.Stale = view.Backups[0].CreatedAt < time.Now().Add(-backupStaleAfter).Unix()
	}
	s.json(w, http.StatusOK, view)
}

func (s *Server) listCTTemplates(w http.ResponseWriter, r *http.Request) {
	templates, err := listAcrossServers(s, r,
		func(ctx context.Context, d hypervisor.Driver) ([]hypervisor.CTTemplate, error) {
			// Servers whose hypervisor has no container support simply
			// contribute nothing.
			cd, ok := d.(hypervisor.ContainerDriver)
			if !ok {
				return nil, nil
			}
			return cd.CTTemplates(ctx)
		},
		func(i *hypervisor.CTTemplate, id string) { i.ServerID = id })
	if err != nil {
		s.fail(w, err, "ct templates")
		return
	}
	slices.SortFunc(templates, func(a, b hypervisor.CTTemplate) int {
		return strings.Compare(a.Name, b.Name)
	})
	s.json(w, http.StatusOK, templates)
}

func (s *Server) listDatastores(w http.ResponseWriter, r *http.Request) {
	datastores, err := listAcrossServers(s, r,
		func(ctx context.Context, d hypervisor.Driver) ([]hypervisor.Datastore, error) {
			return d.Datastores(ctx)
		},
		func(i *hypervisor.Datastore, id string) { i.ServerID = id })
	if err != nil {
		s.fail(w, err, "datastores")
		return
	}
	slices.SortFunc(datastores, func(a, b hypervisor.Datastore) int {
		if c := strings.Compare(a.Zone, b.Zone); c != 0 {
			return c
		}
		return strings.Compare(a.Name, b.Name)
	})
	s.json(w, http.StatusOK, datastores)
}
