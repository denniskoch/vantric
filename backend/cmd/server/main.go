package main

import (
	"context"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"lab-cloud-manager/internal/api"
	"lab-cloud-manager/internal/config"
	"lab-cloud-manager/internal/database"
	dbfactory "lab-cloud-manager/internal/database/factory"
	"lab-cloud-manager/internal/dns"
	dnsfactory "lab-cloud-manager/internal/dns/factory"
	"lab-cloud-manager/internal/hypervisor"
	"lab-cloud-manager/internal/hypervisor/factory"
	"lab-cloud-manager/internal/identity"
	identityfactory "lab-cloud-manager/internal/identity/factory"
	"lab-cloud-manager/internal/network"
	networkfactory "lab-cloud-manager/internal/network/factory"
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

	if err := api.EnsureBootstrapUser(ctx, st, log,
		cfg.Auth.BootstrapEmail, cfg.Auth.BootstrapPassword); err != nil {
		log.Error("seeding the first account", "error", err)
		os.Exit(1)
	}

	registry := hypervisor.NewRegistry()
	loadRegistry(ctx, st, registry, log)
	dnsRegistry := dns.NewRegistry()
	loadDNSRegistry(ctx, st, dnsRegistry, log)

	dbRegistry := database.NewRegistry()
	loadDatabaseRegistry(ctx, st, dbRegistry, log)

	identityRegistry := identity.NewRegistry()
	loadIdentityRegistry(ctx, st, identityRegistry, log)

	networkRegistry := network.NewRegistry()
	loadNetworkRegistry(ctx, st, networkRegistry, log)

	// The console's SSH key lives beside the database.
	dataDir := filepath.Dir(cfg.Database.DSN)
	server := api.New(st, registry, dnsRegistry, dbRegistry, identityRegistry,
		networkRegistry, log, cfg.StaticDir, dataDir,
		api.SSHOptions{Provision: cfg.SSH.Provision, Sudo: cfg.SSH.ProvisionSudo})
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

// loadDatabaseRegistry builds a live driver for every configured
// database server. A driver that can't be built is skipped, not fatal:
// the console still runs with the rest.
func loadDatabaseRegistry(ctx context.Context, st *store.Store, registry *database.Registry, log *slog.Logger) {
	servers, err := st.ListDatabaseServers(ctx)
	if err != nil {
		log.Error("listing database servers", "error", err)
		return
	}
	for i := range servers {
		driver, err := dbfactory.Build(&servers[i])
		if err != nil {
			log.Error("building database driver", "server", servers[i].Name, "error", err)
			continue
		}
		registry.Set(servers[i].ID, driver)
	}
	log.Info("database registry loaded", "servers", len(servers))
}

// loadIdentityRegistry builds a live provider for every configured
// identity backend.
func loadIdentityRegistry(ctx context.Context, st *store.Store, registry *identity.Registry, log *slog.Logger) {
	providers, err := st.ListIdentityProviders(ctx)
	if err != nil {
		log.Error("listing identity providers", "error", err)
		return
	}
	for i := range providers {
		provider, err := identityfactory.Build(&providers[i])
		if err != nil {
			log.Error("building identity provider", "provider", providers[i].Name, "error", err)
			continue
		}
		registry.Set(providers[i].ID, provider)
	}
	log.Info("identity registry loaded", "providers", len(providers))
}

// loadNetworkRegistry builds a live provider for every configured
// network controller.
func loadNetworkRegistry(ctx context.Context, st *store.Store, registry *network.Registry, log *slog.Logger) {
	providers, err := st.ListNetworkProviders(ctx)
	if err != nil {
		log.Error("listing network providers", "error", err)
		return
	}
	for i := range providers {
		provider, err := networkfactory.Build(&providers[i])
		if err != nil {
			log.Error("building network provider", "provider", providers[i].Name, "error", err)
			continue
		}
		registry.Set(providers[i].ID, provider)
	}
	log.Info("network registry loaded", "providers", len(providers))
}
