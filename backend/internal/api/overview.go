package api

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	"vantric/internal/aiaccount"
	"vantric/internal/hypervisor"
)

// The Cloud Overview: what's wrong right now, and how much of
// everything there is.
//
// It answers the first question anyone brings to a console, which every
// other page here answers only if you already know where to look. The
// point is that it needs NO new integration — every problem below is
// derived from data the app already collects, so this is a reading of
// what it knows rather than another thing to connect.
//
// Everything fans out in parallel behind one request, because it draws
// on every backend at once and a page that takes as long as its slowest
// hypervisor isn't a home page. A backend that errors contributes a
// problem instead of failing the page.

const (
	// A datastore this full is a problem before it's an outage.
	datastoreWarnPercent = 85
	datastoreFullPercent = 95
	// A guest whose newest backup is older than this is drifting out of
	// whatever schedule was meant to cover it.
	backupStaleAfter = 8 * 24 * time.Hour
	// The whole page, not per backend. Slower than this and it isn't a
	// dashboard.
	overviewTimeout = 15 * time.Second
)

// unhealthy reports whether a probe came back as anything other than a
// working backend, and says why. The five probes share a vocabulary:
// "connected", "unreachable" (it answered badly or not at all) and
// "unknown" (no driver was ever built for the record, usually bad
// stored credentials). Checking only for "unreachable" is the bug this
// avoids — a server whose driver failed to load looks fine.
func unhealthy(status, detail string) (string, bool) {
	if status == "connected" {
		return "", false
	}
	if detail == "" {
		detail = "The console has no working connection to it."
	}
	return detail, true
}

// problem is one thing worth someone's attention, with the place to go
// and deal with it.
type problem struct {
	// Severity is "error" for something broken now, "warning" for
	// something that will be.
	Severity string `json:"severity"`
	Title    string `json:"title"`
	Detail   string `json:"detail"`
	// To is the route that shows it.
	To string `json:"to"`
}

// counts is the "how much of everything" half.
type counts struct {
	Instances  int `json:"instances"`
	Running    int `json:"running"`
	Containers int `json:"containers"`
	// ContainersRunning mirrors Running for CTs.
	ContainersRunning int `json:"containersRunning"`
	Hypervisors       int `json:"hypervisors"`
	Databases         int `json:"databases"`
	DatabaseServers   int `json:"databaseServers"`
	DNSZones          int `json:"dnsZones"`
	IdentityUsers     int `json:"identityUsers"`
	NetworkClients    int `json:"networkClients"`
	Accounts          int `json:"accounts"`
}

type datastoreUsage struct {
	Name         string  `json:"name"`
	Node         string  `json:"node"`
	HypervisorID string  `json:"hypervisorId"`
	UsedBytes    int64   `json:"usedBytes"`
	TotalBytes   int64   `json:"totalBytes"`
	Percent      float64 `json:"percent"`
}

type overviewResponse struct {
	Problems   []problem        `json:"problems"`
	Counts     counts           `json:"counts"`
	Datastores []datastoreUsage `json:"datastores"`
}

func (s *Server) overview(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), overviewTimeout)
	defer cancel()

	var (
		mu       sync.Mutex
		problems []problem
		out      counts
		stores   []datastoreUsage
	)
	add := func(p problem) {
		mu.Lock()
		problems = append(problems, p)
		mu.Unlock()
	}

	var wg sync.WaitGroup
	run := func(f func()) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			f()
		}()
	}

	// The store's own numbers are free, and the guests it knows about
	// are where "running but silent" comes from.
	run(func() {
		instances, err := s.store.ListInstances(ctx)
		if err != nil {
			return
		}
		mu.Lock()
		out.Instances = len(instances)
		mu.Unlock()
		var silent []string
		for _, inst := range instances {
			if inst.Status == string(hypervisor.StatusRunning) {
				mu.Lock()
				out.Running++
				mu.Unlock()
				if inst.InternalIP == "" {
					silent = append(silent, inst.Name)
				}
			}
		}
		// No IP from a running guest means the hypervisor can't talk to
		// it, which is the qemu-guest-agent gap — and it's what takes
		// away Connect and OS info while everything else looks fine.
		if len(silent) > 0 {
			add(problem{
				Severity: "warning",
				Title:    plural(len(silent), "guest is", "guests are") + " running without a guest agent",
				Detail: join(silent) +
					" — no address is reported, so Connect and OS info have nothing to work with. " +
					"Install qemu-guest-agent in the guest.",
				To: "/compute/instances",
			})
		}
	})

	run(func() {
		containers, err := s.store.ListContainers(ctx)
		if err != nil {
			return
		}
		mu.Lock()
		out.Containers = len(containers)
		for _, ct := range containers {
			if ct.Status == string(hypervisor.StatusRunning) {
				out.ContainersRunning++
			}
		}
		mu.Unlock()
	})

	run(func() {
		users, err := s.store.ListUsers(ctx)
		if err != nil {
			return
		}
		mu.Lock()
		out.Accounts = len(users)
		mu.Unlock()
	})

	// Every backend, asked whether it's still there.
	run(func() {
		servers, err := s.store.ListHypervisors(ctx)
		if err != nil {
			return
		}
		mu.Lock()
		out.Hypervisors = len(servers)
		mu.Unlock()
		var inner sync.WaitGroup
		for i := range servers {
			inner.Add(1)
			go func(i int) {
				defer inner.Done()
				view := s.probeHypervisor(ctx, servers[i])
				if detail, bad := unhealthy(view.Status, view.Error); bad {
					add(problem{
						Severity: "error",
						Title:    "Hypervisor " + servers[i].Name + " is unreachable",
						Detail:   detail,
						To:       "/compute/settings/hypervisors",
					})
				}
			}(i)
		}
		inner.Wait()
	})

	run(func() {
		servers, err := s.store.ListDatabaseServers(ctx)
		if err != nil {
			return
		}
		mu.Lock()
		out.DatabaseServers = len(servers)
		mu.Unlock()
		var inner sync.WaitGroup
		for i := range servers {
			inner.Add(1)
			go func(i int) {
				defer inner.Done()
				view := s.probeDatabaseServer(ctx, servers[i])
				if detail, bad := unhealthy(view.Status, view.Error); bad {
					add(problem{
						Severity: "error",
						Title:    "Database server " + servers[i].Name + " is unreachable",
						Detail:   detail,
						To:       "/databases/instances",
					})
					return
				}
				if view.Info != nil {
					mu.Lock()
					out.Databases += view.Info.Databases
					mu.Unlock()
				}
			}(i)
		}
		inner.Wait()
	})

	run(func() {
		providers, err := s.store.ListDNSProviders(ctx)
		if err != nil {
			return
		}
		for i := range providers {
			view := s.probeDNSProvider(ctx, providers[i])
			if detail, bad := unhealthy(view.Status, view.Error); bad {
				add(problem{
					Severity: "error",
					Title:    "DNS provider " + providers[i].Name + " is unreachable",
					Detail:   detail,
					To:       "/dns/providers",
				})
				continue
			}
			mu.Lock()
			out.DNSZones += view.Zones
			mu.Unlock()
		}
	})

	run(func() {
		providers, err := s.store.ListIdentityProviders(ctx)
		if err != nil {
			return
		}
		for i := range providers {
			view := s.probeIdentityProvider(ctx, providers[i])
			if detail, bad := unhealthy(view.Status, view.Error); bad {
				add(problem{
					Severity: "error",
					Title:    "Identity provider " + providers[i].Name + " is unreachable",
					Detail:   detail,
					To:       "/identity/providers",
				})
				continue
			}
			if view.Info != nil {
				mu.Lock()
				out.IdentityUsers += view.Info.Users
				mu.Unlock()
			}
		}
	})

	// The AI gateway and the accounts behind it. A gateway that stops
	// answering is the same class of problem as any other backend; a
	// provider account running out is the one that stops work without
	// anything breaking, which is exactly what a front page is for.
	run(func() {
		gateways, err := s.store.ListAIGateways(ctx)
		if err != nil {
			return
		}
		for i := range gateways {
			view := s.probeAIGateway(ctx, gateways[i])
			if detail, bad := unhealthy(view.Status, view.Error); bad {
				add(problem{
					Severity: "error",
					Title:    "AI gateway " + gateways[i].Name + " is unreachable",
					Detail:   detail,
					To:       "/ai/settings/gateway",
				})
			}
		}
	})

	run(func() {
		accounts, err := s.store.ListAIAccounts(ctx)
		if err != nil {
			return
		}
		for i := range accounts {
			view := s.probeAIAccount(ctx, accounts[i])
			switch {
			case view.Status == "unreachable":
				add(problem{
					Severity: "error",
					Title:    "Can't read the balance at " + accounts[i].Name,
					Detail:   view.Error,
					To:       "/ai/accounts",
				})
			case view.Balance != nil && view.Balance.Remaining != nil:
				// A THRESHOLD PER UNIT, because the numbers aren't
				// comparable: five is nearly empty in dollars and
				// nothing at all in characters. A provider whose unit
				// isn't known here contributes no warning rather than a
				// wrong one.
				if low, detail := lowBalance(accounts[i].Name, view.Balance); low {
					add(problem{
						Severity: "warning",
						Title:    accounts[i].Name + " is nearly out of credit",
						Detail:   detail,
						To:       "/ai/accounts",
					})
				}
			}
		}
	})

	run(func() {
		providers, err := s.store.ListNetworkProviders(ctx)
		if err != nil {
			return
		}
		for i := range providers {
			view := s.probeNetworkProvider(ctx, providers[i])
			if detail, bad := unhealthy(view.Status, view.Error); bad {
				add(problem{
					Severity: "error",
					Title:    "Network controller " + providers[i].Name + " is unreachable",
					Detail:   detail,
					To:       "/network/controllers",
				})
				continue
			}
			if view.Info != nil {
				mu.Lock()
				out.NetworkClients += view.Info.Clients
				mu.Unlock()
			}
		}
	})

	// Capacity: a datastore fills up long before it fails, and this is
	// the only place that watches it.
	run(func() {
		datastores, err := eachDriver(s, ctx,
			func(ctx context.Context, d hypervisor.Driver) ([]hypervisor.Datastore, error) {
				return d.Datastores(ctx)
			},
			func(ds *hypervisor.Datastore, serverID string) { ds.HypervisorID = serverID })
		if err != nil {
			return
		}
		// Shared storage is reported once per node it's mounted on. The
		// Datastores page lists those rows because they're per-node
		// facts; here they're one bar and one warning, or a shared NFS
		// mount fills the page with copies of itself.
		seen := map[string]bool{}
		for _, ds := range datastores {
			if ds.TotalBytes <= 0 {
				continue
			}
			key := ds.HypervisorID + "/" + ds.Name
			if !ds.Shared {
				key += "/" + ds.Node
			}
			if seen[key] {
				continue
			}
			seen[key] = true
			pct := float64(ds.UsedBytes) / float64(ds.TotalBytes) * 100
			mu.Lock()
			stores = append(stores, datastoreUsage{
				Name: ds.Name, Node: ds.Node, HypervisorID: ds.HypervisorID,
				UsedBytes: ds.UsedBytes, TotalBytes: ds.TotalBytes, Percent: pct,
			})
			mu.Unlock()
			switch {
			case pct >= datastoreFullPercent:
				add(problem{
					Severity: "error",
					Title:    "Datastore " + ds.Name + " is " + pctString(pct) + " full",
					Detail:   "On " + ds.Node + ". Backups and new disks will start failing.",
					To:       "/compute/datastores",
				})
			case pct >= datastoreWarnPercent:
				add(problem{
					Severity: "warning",
					Title:    "Datastore " + ds.Name + " is " + pctString(pct) + " full",
					Detail:   "On " + ds.Node + ".",
					To:       "/compute/datastores",
				})
			}
		}
	})

	// Backups: the newest one per guest is the only number that matters,
	// and "none at all" is the answer worth shouting about.
	run(func() {
		backups, err := eachDriver(s, ctx,
			func(ctx context.Context, d hypervisor.Driver) ([]hypervisor.Backup, error) {
				bd, ok := d.(hypervisor.BackupDriver)
				if !ok {
					return nil, nil
				}
				return bd.Backups(ctx)
			},
			func(b *hypervisor.Backup, serverID string) { b.HypervisorID = serverID })
		if err != nil || len(backups) == 0 {
			return
		}
		newest := map[string]int64{}
		for _, b := range backups {
			key := b.GuestName
			if key == "" {
				// A backup outlives its guest, so the name is gone
				// exactly when the archive matters most. The vmid is
				// what's left to group by.
				key = fmt.Sprintf("VM %d", b.VMID)
			}
			if b.CreatedAt > newest[key] {
				newest[key] = b.CreatedAt
			}
		}
		cutoff := time.Now().Add(-backupStaleAfter).Unix()
		var stale []string
		for guest, at := range newest {
			if at < cutoff {
				stale = append(stale, guest)
			}
		}
		if len(stale) > 0 {
			sort.Strings(stale)
			add(problem{
				Severity: "warning",
				Title:    plural(len(stale), "guest hasn't", "guests haven't") + " been backed up in over a week",
				Detail:   join(stale),
				To:       "/compute/backups",
			})
		}
	})

	wg.Wait()

	// Broken before merely worrying, then alphabetically, so the same
	// state renders the same way twice.
	sort.SliceStable(problems, func(i, j int) bool {
		if problems[i].Severity != problems[j].Severity {
			return problems[i].Severity == "error"
		}
		return problems[i].Title < problems[j].Title
	})
	sort.SliceStable(stores, func(i, j int) bool { return stores[i].Percent > stores[j].Percent })

	if problems == nil {
		problems = []problem{}
	}
	if stores == nil {
		stores = []datastoreUsage{}
	}
	s.json(w, http.StatusOK, overviewResponse{Problems: problems, Counts: out, Datastores: stores})
}

// eachDriver is listAcrossHypervisors without a request to read a filter
// from — the overview always wants everything.
func eachDriver[T any](
	s *Server,
	ctx context.Context,
	list func(context.Context, hypervisor.Driver) ([]T, error),
	stamp func(item *T, serverID string),
) ([]T, error) {
	servers, err := s.store.ListHypervisors(ctx)
	if err != nil {
		return nil, err
	}
	var (
		mu  sync.Mutex
		all []T
		wg  sync.WaitGroup
	)
	for _, server := range servers {
		driver, ok := s.registry.Get(server.ID)
		if !ok {
			continue
		}
		wg.Add(1)
		go func(serverID string, d hypervisor.Driver) {
			defer wg.Done()
			items, err := list(ctx, d)
			if err != nil {
				// A backend that's down is already a problem elsewhere on
				// this page; it shouldn't also empty the capacity section.
				s.log.Warn("overview: listing from a server failed", "server", serverID, "error", err)
				return
			}
			for i := range items {
				stamp(&items[i], serverID)
			}
			mu.Lock()
			all = append(all, items...)
			mu.Unlock()
		}(server.ID, driver)
	}
	wg.Wait()
	return all, nil
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}

// join lists names without turning into a paragraph.
func join(names []string) string {
	sort.Strings(names)
	if len(names) <= 4 {
		return commaSeparated(names)
	}
	return commaSeparated(names[:4]) + fmt.Sprintf(" and %d more", len(names)-4)
}

func commaSeparated(names []string) string {
	out := ""
	for i, n := range names {
		switch {
		case i == 0:
			out = n
		case i == len(names)-1:
			out += " and " + n
		default:
			out += ", " + n
		}
	}
	return out
}

func pctString(pct float64) string { return fmt.Sprintf("%.0f%%", pct) }

// lowBalance decides whether a provider account is close enough to
// empty to say so.
//
// The threshold is PER UNIT and there is no default: five is nearly
// empty in dollars and nothing at all in characters, and a single
// number applied to both would either shout about a healthy account or
// stay silent about a spent one. A unit this doesn't recognise
// contributes no warning, which is the honest answer — better than one
// derived from a comparison that doesn't hold.
func lowBalance(name string, b *aiaccount.Balance) (bool, string) {
	switch b.Unit {
	case "USD":
		if *b.Remaining < 5 {
			return true, fmt.Sprintf("$%.2f left of $%.2f", *b.Remaining, b.Granted)
		}
	case "characters":
		if *b.Remaining < 10000 {
			return true, fmt.Sprintf("%.0f characters left of %.0f", *b.Remaining, b.Granted)
		}
	}
	return false, ""
}
