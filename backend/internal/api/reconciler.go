package api

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"lab-cloud-manager/internal/hypervisor"
	"lab-cloud-manager/internal/store"
)

// Reconciler polls the hypervisor and syncs live instance state
// (status, IPs) into the store. The driver is the source of truth for
// runtime state; the store is the source of truth for metadata.
type Reconciler struct {
	store    *store.Store
	driver   hypervisor.Driver
	log      *slog.Logger
	interval time.Duration
}

func NewReconciler(st *store.Store, driver hypervisor.Driver, log *slog.Logger, interval time.Duration) *Reconciler {
	return &Reconciler{store: st, driver: driver, log: log, interval: interval}
}

func (r *Reconciler) Run(ctx context.Context) {
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.sweep(ctx)
		}
	}
}

func (r *Reconciler) sweep(ctx context.Context) {
	instances, err := r.store.ListAllInstances(ctx)
	if err != nil {
		r.log.Error("reconciler: listing instances", "error", err)
		return
	}
	for _, inst := range instances {
		if inst.Driver != r.driver.Name() || inst.DriverID == "" {
			continue
		}
		state, err := r.driver.Get(ctx, inst.DriverID)
		if errors.Is(err, hypervisor.ErrNotFound) {
			// VM was removed out-of-band (e.g. directly in Proxmox).
			r.log.Info("reconciler: instance gone from hypervisor, removing", "name", inst.Name)
			_ = r.store.DeleteInstance(ctx, inst.ID)
			continue
		}
		if err != nil {
			r.log.Warn("reconciler: get failed", "name", inst.Name, "error", err)
			continue
		}
		if string(state.Status) != inst.Status ||
			state.InternalIP != inst.InternalIP || state.ExternalIP != inst.ExternalIP {
			if err := r.store.UpdateInstanceState(ctx, inst.ID,
				string(state.Status), state.InternalIP, state.ExternalIP); err != nil {
				r.log.Warn("reconciler: update failed", "name", inst.Name, "error", err)
			}
		}
	}
}
