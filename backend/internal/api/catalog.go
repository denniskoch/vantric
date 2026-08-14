package api

import (
	"context"
	"net/http"
	"slices"
	"strings"

	"lab-cloud-manager/internal/hypervisor"
	"lab-cloud-manager/internal/store"
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
		func(*hypervisor.Zone, string) {}) // zones are per-server by nature
	if err != nil {
		s.fail(w, err, "zones")
		return
	}
	s.json(w, http.StatusOK, zones)
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
