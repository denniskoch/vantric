package main

import (
	"context"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"

	"lab-cloud-manager/internal/api"
	"lab-cloud-manager/internal/config"
	"lab-cloud-manager/internal/dns"
	dnsfactory "lab-cloud-manager/internal/dns/factory"
	"lab-cloud-manager/internal/hypervisor"
	"lab-cloud-manager/internal/hypervisor/factory"
	"lab-cloud-manager/internal/store"
)

func main() {
	configPath := flag.String("config", "", "path to config.yaml (optional)")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Error("loading config", "error", err)
		os.Exit(1)
	}

	st, err := store.Open(cfg.Database.Driver, cfg.Database.DSN)
	if err != nil {
		log.Error("opening store", "error", err)
		os.Exit(1)
	}
	defer st.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ensureDefaultMachineTypes(ctx, st, log)
	seedServerFromConfig(ctx, st, cfg, log)

	registry := hypervisor.NewRegistry()
	loadRegistry(ctx, st, registry, log)
	dnsRegistry := dns.NewRegistry()
	loadDNSRegistry(ctx, st, dnsRegistry, log)

	server := api.New(st, registry, dnsRegistry, log, cfg.StaticDir)
	reconciler := api.NewReconciler(st, registry, log, 2*time.Second)
	go reconciler.Run(ctx)

	httpServer := &http.Server{Addr: cfg.Listen, Handler: server.Router()}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	log.Info("lab-cloud-manager listening", "addr", cfg.Listen, "db", cfg.Database.Driver)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Error("server", "error", err)
		os.Exit(1)
	}
}

// loadRegistry builds a live driver for every registered server.
func loadRegistry(ctx context.Context, st *store.Store, registry *hypervisor.Registry, log *slog.Logger) {
	servers, err := st.ListServers(ctx)
	if err != nil {
		log.Error("listing servers", "error", err)
		return
	}
	for i := range servers {
		driver, err := factory.Build(&servers[i])
		if err != nil {
			log.Error("building driver", "server", servers[i].Name, "error", err)
			continue
		}
		registry.Set(servers[i].ID, driver)
	}
	log.Info("hypervisor registry loaded", "servers", len(servers))
}

// loadDNSRegistry builds a live provider for every configured DNS
// account.
func loadDNSRegistry(ctx context.Context, st *store.Store, registry *dns.Registry, log *slog.Logger) {
	providers, err := st.ListDNSProviders(ctx)
	if err != nil {
		log.Error("listing dns providers", "error", err)
		return
	}
	for i := range providers {
		provider, err := dnsfactory.Build(&providers[i])
		if err != nil {
			log.Error("building dns provider", "provider", providers[i].Name, "error", err)
			continue
		}
		registry.Set(providers[i].ID, provider)
	}
	log.Info("dns registry loaded", "providers", len(providers))
}

// seedServerFromConfig registers an initial server on first run, driven
// by the legacy config (LCM_DRIVER etc). After that, servers are managed
// in the GUI under Compute Engine → Bare Metal Solution → Servers.
func seedServerFromConfig(ctx context.Context, st *store.Store, cfg config.Config, log *slog.Logger) {
	n, err := st.CountServers(ctx)
	if err != nil {
		log.Error("counting servers", "error", err)
		return
	}
	if n > 0 {
		return
	}
	var sv *store.Server
	switch cfg.Driver {
	case "proxmox":
		sv = &store.Server{
			ID:          uuid.NewString(),
			Name:        "pve",
			Type:        "proxmox",
			BaseURL:     cfg.Proxmox.BaseURL,
			TokenID:     cfg.Proxmox.TokenID,
			Secret:      cfg.Proxmox.Secret,
			InsecureTLS: cfg.Proxmox.InsecureSkipVerify,
		}
	case "mock", "":
		sv = &store.Server{ID: uuid.NewString(), Name: "lab-sim", Type: "mock"}
	default:
		log.Error("unknown driver in config", "driver", cfg.Driver)
		return
	}
	if err := st.CreateServer(ctx, sv); err != nil {
		log.Error("seeding server", "error", err)
		return
	}
	log.Info("seeded server from config", "name", sv.Name, "type", sv.Type)
}

// ensureDefaultMachineTypes seeds the preset catalog on first run; after
// that it's user-managed via Settings → Machine types.
func ensureDefaultMachineTypes(ctx context.Context, st *store.Store, log *slog.Logger) {
	n, err := st.CountMachineTypes(ctx)
	if err != nil {
		log.Error("counting machine types", "error", err)
		return
	}
	if n > 0 {
		return
	}
	defaults := []store.MachineType{
		{Name: "hl-micro", Description: "1 vCPU, 512 MB", CPUs: 1, MemoryMB: 512},
		{Name: "hl-small", Description: "1 vCPU, 1 GB", CPUs: 1, MemoryMB: 1024},
		{Name: "hl-standard-2", Description: "2 vCPU, 2 GB", CPUs: 2, MemoryMB: 2048},
		{Name: "hl-standard-4", Description: "4 vCPU, 4 GB", CPUs: 4, MemoryMB: 4096},
		{Name: "hl-highmem-4", Description: "4 vCPU, 8 GB", CPUs: 4, MemoryMB: 8192},
		{Name: "hl-highmem-8", Description: "8 vCPU, 16 GB", CPUs: 8, MemoryMB: 16384},
	}
	for i := range defaults {
		if err := st.CreateMachineType(ctx, &defaults[i]); err != nil {
			log.Error("seeding machine type", "name", defaults[i].Name, "error", err)
			return
		}
	}
	log.Info("seeded default machine types", "count", len(defaults))
}
