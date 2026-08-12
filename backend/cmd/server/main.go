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
	"lab-cloud-manager/internal/hypervisor"
	"lab-cloud-manager/internal/hypervisor/mock"
	"lab-cloud-manager/internal/hypervisor/proxmox"
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

	var driver hypervisor.Driver
	switch cfg.Driver {
	case "proxmox":
		driver = proxmox.New(proxmox.Config{
			BaseURL:            cfg.Proxmox.BaseURL,
			TokenID:            cfg.Proxmox.TokenID,
			Secret:             cfg.Proxmox.Secret,
			InsecureSkipVerify: cfg.Proxmox.InsecureSkipVerify,
		})
	case "mock", "":
		driver = mock.New()
	default:
		log.Error("unknown driver", "driver", cfg.Driver)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ensureDefaultProject(ctx, st, log)

	server := api.New(st, driver, log, cfg.StaticDir)
	reconciler := api.NewReconciler(st, driver, log, 2*time.Second)
	go reconciler.Run(ctx)

	httpServer := &http.Server{Addr: cfg.Listen, Handler: server.Router()}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	log.Info("lab-cloud-manager listening", "addr", cfg.Listen, "driver", driver.Name(), "db", cfg.Database.Driver)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Error("server", "error", err)
		os.Exit(1)
	}
}

// ensureDefaultProject creates a starter project on first run so the UI
// has something to select.
func ensureDefaultProject(ctx context.Context, st *store.Store, log *slog.Logger) {
	projects, err := st.ListProjects(ctx)
	if err != nil {
		log.Error("listing projects", "error", err)
		return
	}
	if len(projects) > 0 {
		return
	}
	p := &store.Project{ID: uuid.NewString(), Name: "homelab", DisplayName: "Homelab"}
	if err := st.CreateProject(ctx, p); err != nil {
		log.Error("creating default project", "error", err)
		return
	}
	log.Info("created default project", "name", p.Name)
}
