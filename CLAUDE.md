# lab-cloud-manager

Home lab VM manager that replicates the Google Cloud Console experience
(GCP-inspired, not a pixel clone). Compute Engine–style instance management
backed by Proxmox, with the hypervisor abstracted for future backends.

## Commands

```bash
docker compose --profile dev up                # dev stack: air hot-reload :8080 + vite HMR :5173
docker compose --profile prod up --build       # production image (API + UI) on :8080
cd backend && go build ./... && go vet ./...   # build + vet backend
cd backend && go run ./cmd/server              # native API run (mock driver, :8080)
cd frontend && npx tsc -b && npm run build     # type-check + build frontend
```

Docker is the deployment target (single image: Go binary + static UI, see
Dockerfile).

## Architecture rules

- `internal/hypervisor.Driver` is the abstraction boundary. Nothing outside
  `internal/hypervisor/*` may import Proxmox specifics. New backends
  implement Driver and get wired in `cmd/server/main.go`.
- Instance statuses are GCP's: PROVISIONING, STAGING, RUNNING, STOPPING,
  TERMINATED. Drivers map native states to these.
- The driver is the source of truth for runtime state (status/IPs); the
  store owns metadata. The reconciler (internal/api/reconciler.go) syncs
  driver → store; handlers never poll the driver for reads.
- Keep store SQL portable between SQLite and Postgres: TEXT ids, RFC3339
  TEXT timestamps, no engine-specific types. Postgres is planned, not wired.
- Frontend talks only to `/api/v1` via `src/api/client.ts` (typed client);
  server state lives in TanStack Query (3s polling), not local state.
- UI style: GCP-inspired via MUI + the custom theme in `src/theme.ts`
  (Google blue #1a73e8, white surfaces, #dadce0 borders, dense tables).
- Navigation model (mirrors GCP): the hamburger opens a temporary global
  menu for switching between Lab Cloud sections; each section then has a
  permanent left nav. Sections live in `src/components/nav.tsx` — adding
  one there wires both menus.
- docker-compose dev caveat: file-change events don't cross the macOS→VM
  bind mount, so both watchers poll (air `poll = true`, vite
  `watch.usePolling`). Don't remove either.

## Config

`config.example.yaml` documents all settings; `config.yaml` is gitignored
(holds the Proxmox token). Env overrides use the `LCM_` prefix.
