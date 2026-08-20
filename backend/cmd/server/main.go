package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"vantric/internal/api"
	"vantric/internal/config"
	"vantric/internal/database"
	dbfactory "vantric/internal/database/factory"
	"vantric/internal/dns"
	dnsfactory "vantric/internal/dns/factory"
	"vantric/internal/hypervisor"
	"vantric/internal/hypervisor/factory"
	"vantric/internal/identity"
	identityfactory "vantric/internal/identity/factory"
	"vantric/internal/inventory"
	inventoryfactory "vantric/internal/inventory/factory"
	"vantric/internal/network"
	networkfactory "vantric/internal/network/factory"
	"vantric/internal/storage"
	storagefactory "vantric/internal/storage/factory"
	"vantric/internal/store"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	cfg := config.Load()
	// Honoured, but said out loud: silently accepting the old names
	// forever is how a rename never finishes.
	if old := config.Legacy(); len(old) > 0 {
		log.Warn("using LCM_* environment variables, which are deprecated — rename them to VANTRIC_*",
			"variables", strings.Join(old, ", "))
	}

	// An existing database keeps being found after the rename, rather
	// than being silently replaced by an empty one at the new path.
	dsn, wanted := config.ResolveSQLite(cfg.Database.Driver, cfg.Database.DSN)
	if wanted != "" {
		log.Warn("opening the pre-rename database; rename it (and its -wal/-shm) to finish the move",
			"opening", dsn, "expected", wanted)
		cfg.Database.DSN = dsn
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

	inventoryRegistry := inventory.NewRegistry()
	loadInventoryRegistry(ctx, st, inventoryRegistry, log)
	storageRegistry := storage.NewRegistry()
	loadStorageRegistry(ctx, st, storageRegistry, log)

	// The console's SSH key lives beside the database.
	dataDir := filepath.Dir(cfg.Database.DSN)
	server := api.New(st, registry, dnsRegistry, dbRegistry, identityRegistry,
		networkRegistry, inventoryRegistry, storageRegistry, log, cfg.StaticDir, dataDir, cfg.SiteURL,
		cfg.TrustedProxies,
		api.SSHOptions{Provision: cfg.SSH.Provision, Sudo: cfg.SSH.ProvisionSudo})
	reconciler := api.NewReconciler(st, registry, log, 2*time.Second)
	go reconciler.Run(ctx)
	// Fills in what each CVE actually is, slowly, in NVD's own time.
	go server.EnrichCVEs(ctx)

	// Bounded where it can be, and DELIBERATELY NOT where it can't.
	//
	// Go's defaults here are "wait forever", which is a non-event on a
	// LAN and the cheapest denial of service there is behind a public
	// tunnel: a handful of connections that open and never finish
	// sending headers hold goroutines and file descriptors indefinitely.
	//
	// ReadTimeout and WriteTimeout are missing ON PURPOSE and must stay
	// missing. They bound a whole request, so a ReadTimeout would cap a
	// multi-gigabyte ISO upload at whatever number was chosen, and a
	// WriteTimeout would sever the SSH terminal mid-session — both of
	// them silently, and both looking like a broken feature rather than
	// a setting. Anyone tempted to complete the set should add the bound
	// to the handler that needs it instead. ReadHeaderTimeout covers the
	// case those two are usually reached for, since a request that never
	// finishes its headers never reaches a handler at all.
	httpServer := &http.Server{
		Addr:              cfg.Listen,
		Handler:           server.Router(),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
		// Go's own default, said out loud so every bound is in one place.
		MaxHeaderBytes: 1 << 20,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	log.Info("vantric listening", "addr", cfg.Listen, "db", cfg.Database.Driver)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Error("server", "error", err)
		os.Exit(1)
	}
}

// loadRegistry builds a live driver for every registered server.
func loadRegistry(ctx context.Context, st *store.Store, registry *hypervisor.Registry, log *slog.Logger) {
	servers, err := st.ListHypervisors(ctx)
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

func loadInventoryRegistry(ctx context.Context, st *store.Store, registry *inventory.Registry, log *slog.Logger) {
	providers, err := st.ListInventoryProviders(ctx)
	if err != nil {
		log.Error("listing inventory providers", "error", err)
		return
	}
	for i := range providers {
		provider, err := inventoryfactory.Build(&providers[i])
		if err != nil {
			log.Error("building inventory provider", "provider", providers[i].Name, "error", err)
			continue
		}
		registry.Set(providers[i].ID, provider)
	}
	log.Info("inventory registry loaded", "providers", len(providers))
}

func loadStorageRegistry(ctx context.Context, st *store.Store, registry *storage.Registry, log *slog.Logger) {
	providers, err := st.ListStorageProviders(ctx)
	if err != nil {
		log.Error("listing storage providers", "error", err)
		return
	}
	for i := range providers {
		provider, err := storagefactory.Build(&providers[i])
		if err != nil {
			log.Error("building storage provider", "provider", providers[i].Name, "error", err)
			continue
		}
		registry.Set(providers[i].ID, provider)
	}
	log.Info("storage registry loaded", "providers", len(providers))
}
