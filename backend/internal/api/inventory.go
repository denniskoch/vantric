package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"sort"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"lab-cloud-manager/internal/inventory"
	inventoryfactory "lab-cloud-manager/internal/inventory/factory"
	"lab-cloud-manager/internal/store"
)

// Device inventory (FleetDM). Same shape as every other backend here: a
// DB record holding credentials, one live provider per record in a
// registry, verified before it's stored.
//
// What it adds is the one thing neither side can do alone. Fleet knows
// what's installed inside a machine and which CVEs that carries; the
// hypervisor knows the machine. Joining them on the SMBIOS UUID puts a
// guest's packages and vulnerabilities on the page that already shows
// its disks and its address.

func (s *Server) inventoryRoutes(r chi.Router) {
	r.Get("/inventory/provider-types", func(w http.ResponseWriter, r *http.Request) {
		s.json(w, http.StatusOK, inventoryfactory.Types)
	})
	r.Get("/inventory/providers", s.listInventoryProviders)
	r.Post("/inventory/providers", s.createInventoryProvider)
	r.Put("/inventory/providers/{id}", s.updateInventoryProvider)
	r.Delete("/inventory/providers/{id}", s.deleteInventoryProvider)
	r.Get("/inventory/hosts", s.listInventoryHosts)
	r.Get("/inventory/hosts/{id}", s.getInventoryHost)
	r.Get("/inventory/vulnerabilities", s.listInventoryVulnerabilities)
}

type inventoryProviderView struct {
	store.InventoryProvider
	HasToken bool            `json:"hasToken"`
	Status   string          `json:"status"` // connected | unreachable | unknown
	Info     *inventory.Info `json:"info,omitempty"`
	Error    string          `json:"error,omitempty"`
}

func (s *Server) probeInventoryProvider(ctx context.Context, p store.InventoryProvider) inventoryProviderView {
	view := inventoryProviderView{InventoryProvider: p, HasToken: p.Token != "", Status: "unknown"}
	provider, ok := s.inventoryRegistry.Get(p.ID)
	if !ok {
		view.Error = "no provider loaded"
		return view
	}
	info, err := provider.Verify(ctx)
	if err != nil {
		view.Status = "unreachable"
		view.Error = err.Error()
		return view
	}
	view.Status = "connected"
	view.Info = info
	return view
}

func (s *Server) listInventoryProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := s.store.ListInventoryProviders(r.Context())
	if err != nil {
		s.fail(w, err, "inventory providers")
		return
	}
	views := make([]inventoryProviderView, len(providers))
	var wg sync.WaitGroup
	for i := range providers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			views[i] = s.probeInventoryProvider(r.Context(), providers[i])
		}(i)
	}
	wg.Wait()
	s.json(w, http.StatusOK, views)
}

type inventoryProviderRequest struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	BaseURL     string `json:"baseUrl"`
	Token       string `json:"token"`
	InsecureTLS bool   `json:"insecureTls"`
}

func (s *Server) validateInventoryProvider(w http.ResponseWriter, req *inventoryProviderRequest) bool {
	if !nameRe.MatchString(req.Name) {
		s.err(w, http.StatusBadRequest, "name must be lowercase letters, digits, hyphens (start with a letter)")
		return false
	}
	if !slices.Contains(inventoryfactory.Types, req.Type) {
		s.err(w, http.StatusBadRequest, "unsupported inventory provider type")
		return false
	}
	if !strings.HasPrefix(req.BaseURL, "http://") && !strings.HasPrefix(req.BaseURL, "https://") {
		s.err(w, http.StatusBadRequest, "base URL must start with http:// or https://")
		return false
	}
	return true
}

func (s *Server) createInventoryProvider(w http.ResponseWriter, r *http.Request) {
	var req inventoryProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateInventoryProvider(w, &req) {
		return
	}
	if strings.TrimSpace(req.Token) == "" {
		s.err(w, http.StatusBadRequest, "an API token is required")
		return
	}
	if existing, err := s.store.GetInventoryProviderByName(r.Context(), req.Name); err == nil && existing != nil {
		s.err(w, http.StatusConflict, "a provider with this name already exists")
		return
	}
	p := &store.InventoryProvider{
		ID:          uuid.NewString(),
		Name:        req.Name,
		Type:        req.Type,
		BaseURL:     strings.TrimRight(strings.TrimSpace(req.BaseURL), "/"),
		Token:       strings.TrimSpace(req.Token),
		InsecureTLS: req.InsecureTLS,
	}
	provider, err := inventoryfactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	// Reject credentials that don't work rather than storing a provider
	// that can never connect.
	if _, err := provider.Verify(r.Context()); err != nil {
		s.log.Warn("inventory provider rejected", "name", p.Name, "type", p.Type, "error", err)
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.CreateInventoryProvider(r.Context(), p); err != nil {
		s.fail(w, err, "creating provider")
		return
	}
	s.inventoryRegistry.Set(p.ID, provider)
	s.json(w, http.StatusCreated, s.probeInventoryProvider(r.Context(), *p))
}

func (s *Server) updateInventoryProvider(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetInventoryProvider(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "provider")
		return
	}
	var req inventoryProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.err(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if !s.validateInventoryProvider(w, &req) {
		return
	}
	p.Name = req.Name
	p.Type = req.Type
	p.BaseURL = strings.TrimRight(strings.TrimSpace(req.BaseURL), "/")
	p.InsecureTLS = req.InsecureTLS
	// A blank token means "keep the one you have", so editing the URL
	// doesn't require retyping a secret the API never gave back.
	if token := strings.TrimSpace(req.Token); token != "" {
		p.Token = token
	}
	provider, err := inventoryfactory.Build(p)
	if err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := provider.Verify(r.Context()); err != nil {
		s.err(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.UpdateInventoryProvider(r.Context(), p); err != nil {
		s.fail(w, err, "updating provider")
		return
	}
	s.inventoryRegistry.Set(p.ID, provider)
	s.json(w, http.StatusOK, s.probeInventoryProvider(r.Context(), *p))
}

func (s *Server) deleteInventoryProvider(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.store.DeleteInventoryProvider(r.Context(), id); err != nil {
		s.fail(w, err, "deleting provider")
		return
	}
	s.inventoryRegistry.Remove(id)
	w.WriteHeader(http.StatusNoContent)
}

// instanceInventory is the OS Info tab's second half: what the agent
// inside this guest reports.
//
// The correlation is the point, so the answer distinguishes the three
// states rather than collapsing them into an empty list: no inventory
// service configured at all, a service that has never heard of this
// machine, and a machine it knows. The middle one is a real finding —
// an unenrolled guest — not an error.
type instanceInventoryView struct {
	// Configured is false when no inventory service is connected, which
	// is why the tab has nothing rather than the guest being unknown.
	Configured bool                  `json:"configured"`
	Enrolled   bool                  `json:"enrolled"`
	Detail     *inventory.HostDetail `json:"detail,omitempty"`
	// UUID is what was searched for, so an unenrolled guest can say
	// which identity failed to match.
	UUID  string `json:"uuid"`
	Error string `json:"error,omitempty"`
}

func (s *Server) instanceInventory(w http.ResponseWriter, r *http.Request) {
	inst, err := s.store.GetInstance(r.Context(), chi.URLParam(r, "instance"))
	if err != nil {
		s.fail(w, err, "instance")
		return
	}
	view := instanceInventoryView{UUID: inst.UUID}
	provider, ok := s.inventoryRegistry.Any()
	if !ok {
		s.json(w, http.StatusOK, view)
		return
	}
	view.Configured = true
	if inst.UUID == "" {
		// Nothing to search by yet: the reconciler fills the UUID on a
		// slow beat, so a freshly created guest lands here briefly.
		view.Error = "this instance's system UUID hasn't been read from the hypervisor yet"
		s.json(w, http.StatusOK, view)
		return
	}
	detail, err := provider.HostByUUID(r.Context(), inst.UUID)
	if errors.Is(err, inventory.ErrNotFound) {
		s.json(w, http.StatusOK, view)
		return
	}
	if err != nil {
		view.Error = err.Error()
		s.json(w, http.StatusOK, view)
		return
	}
	view.Enrolled = true
	view.Detail = detail
	s.json(w, http.StatusOK, view)
}

// inventoryHostView is a host the inventory service knows, with the
// one thing it can't know: whether this console runs the machine.
//
// That correlation is the reason this section exists. Fleet holds
// laptops and bare metal as readily as VMs and has never heard of a
// hypervisor; this console knows the guests and nothing about a
// MacBook. Neither can see that a VM is missing an agent, or that an
// agent is still reporting for a VM that was deleted.
type inventoryHostView struct {
	inventory.Host
	// Instance is the VM in this console reporting the same system
	// UUID, empty when there is none.
	Instance string `json:"instance"`
	// Managed says the machine is one this console runs. False means
	// physical, or somebody else's — expected, not a fault.
	Managed bool `json:"managed"`
}

type inventoryHostsResponse struct {
	Configured bool                `json:"configured"`
	Hosts      []inventoryHostView `json:"hosts"`
	// Unenrolled are instances this console runs that no agent reports:
	// the other direction of the same drift, and the one that means
	// somebody has to go and install something.
	Unenrolled []string `json:"unenrolled"`
	Error      string   `json:"error,omitempty"`
}

func (s *Server) listInventoryHosts(w http.ResponseWriter, r *http.Request) {
	out := inventoryHostsResponse{Hosts: []inventoryHostView{}, Unenrolled: []string{}}
	provider, ok := s.inventoryRegistry.Any()
	if !ok {
		s.json(w, http.StatusOK, out)
		return
	}
	out.Configured = true
	hosts, err := provider.Hosts(r.Context())
	if err != nil {
		out.Error = err.Error()
		s.json(w, http.StatusOK, out)
		return
	}
	instances, err := s.store.ListInstances(r.Context())
	if err != nil {
		s.fail(w, err, "instances")
		return
	}
	byUUID := map[string]string{}
	for _, inst := range instances {
		if inst.UUID != "" {
			byUUID[strings.ToLower(inst.UUID)] = inst.Name
		}
	}
	seen := map[string]bool{}
	for _, host := range hosts {
		view := inventoryHostView{Host: host}
		if name, found := byUUID[strings.ToLower(host.UUID)]; found {
			view.Instance = name
			view.Managed = true
			seen[name] = true
		}
		out.Hosts = append(out.Hosts, view)
	}
	for _, inst := range instances {
		if !seen[inst.Name] {
			out.Unenrolled = append(out.Unenrolled, inst.Name)
		}
	}
	sort.Strings(out.Unenrolled)
	sort.SliceStable(out.Hosts, func(i, j int) bool {
		return out.Hosts[i].Hostname < out.Hosts[j].Hostname
	})
	s.json(w, http.StatusOK, out)
}

type inventoryVulnerabilitiesResponse struct {
	Configured bool `json:"configured"`
	// Supported is false when the service is connected but can't answer
	// this — an older Fleet, or one without the licence. A missing
	// feature, not a broken connection, and it reads differently.
	Supported       bool                             `json:"supported"`
	Vulnerabilities []inventory.VulnerabilitySummary `json:"vulnerabilities"`
	Error           string                           `json:"error,omitempty"`
}

func (s *Server) listInventoryVulnerabilities(w http.ResponseWriter, r *http.Request) {
	out := inventoryVulnerabilitiesResponse{Vulnerabilities: []inventory.VulnerabilitySummary{}}
	provider, ok := s.inventoryRegistry.Any()
	if !ok {
		s.json(w, http.StatusOK, out)
		return
	}
	out.Configured, out.Supported = true, true
	vulns, err := provider.Vulnerabilities(r.Context())
	if errors.Is(err, inventory.ErrUnsupported) {
		out.Supported = false
		s.json(w, http.StatusOK, out)
		return
	}
	if err != nil {
		out.Error = err.Error()
		s.json(w, http.StatusOK, out)
		return
	}
	out.Vulnerabilities = vulns
	s.json(w, http.StatusOK, out)
}

// inventoryHostDetailView is one machine's page: everything the service
// holds about it, plus the instance here reporting the same UUID.
type inventoryHostDetailView struct {
	*inventory.HostDetail
	// Instance is the VM in this console that is this machine, empty
	// when it's physical or somebody else's.
	Instance string `json:"instance"`
	Managed  bool   `json:"managed"`
}

func (s *Server) getInventoryHost(w http.ResponseWriter, r *http.Request) {
	provider, ok := s.inventoryRegistry.Any()
	if !ok {
		s.err(w, http.StatusNotFound, "no inventory service is connected")
		return
	}
	detail, err := provider.HostByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.fail(w, err, "host")
		return
	}
	view := inventoryHostDetailView{HostDetail: detail}
	// The correlation again, from the other end: this page knows the
	// host and wants the guest, where the list knew the guests.
	if detail.Host.UUID != "" {
		instances, err := s.store.ListInstances(r.Context())
		if err != nil {
			s.fail(w, err, "instances")
			return
		}
		for _, inst := range instances {
			if strings.EqualFold(inst.UUID, detail.Host.UUID) {
				view.Instance, view.Managed = inst.Name, true
				break
			}
		}
	}
	s.json(w, http.StatusOK, view)
}
