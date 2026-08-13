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
  implement Driver and register in `internal/hypervisor/factory`
  (`factory.Types` + `Build`) — that alone exposes them in the API and the
  Servers GUI type dropdown.
- Servers (virtualization hosts) are DB records managed in the GUI
  (Bare Metal Solution → Servers), one live driver per server held in
  `hypervisor.Registry` keyed by server ID. Catalog listings (zones,
  images, disks, snapshots, isos, ct-templates, datastores) span ALL
  servers by default and stamp each item with its `serverId`, so list
  pages show a Server column instead of a server filter — see
  `listAcrossServers` in internal/api/catalog.go. `?server=` narrows to
  one server; the create flows use it since placement is per-server. A
  server that errors is skipped and logged, not fatal to the page.
  Config seeds one server on first run only; after
  that config driver settings are ignored. Server secrets never leave the
  backend (`json:"-"`; API exposes `hasSecret`).
- Instance statuses are GCP's: PROVISIONING, STAGING, RUNNING, STOPPING,
  TERMINATED. Drivers map native states to these.
- The driver is the source of truth for runtime state (status/IPs); the
  store owns metadata. The reconciler (internal/api/reconciler.go) syncs
  driver → store; handlers never poll the driver for reads. The one
  documented exception is the detail view's on-demand reads
  (`/instances/{name}/describe|metrics|os-info`), since VM config and
  RRD history aren't mirrored in the store.
- The reconciler also ADOPTS VMs found on a server that the app didn't
  create (they appear as instances with deletion protection enabled) and
  removes instances whose VM vanished out-of-band. Driver.List must be
  one cheap call; guest-agent IP lookups happen via Get, throttled.
- Containers (LXC) are a SEPARATE resource from VM instances — separate
  table, API (/containers), nav item, and pages — because they list and
  provision differently. Container support is the optional
  hypervisor.ContainerDriver capability interface (type assertion), so
  future drivers without containers stay simple. Proxmox's
  cluster/resources?type=vm returns BOTH qemu and lxc: always filter by
  the resource Type field.
- Template builds (cloud image → import disk → cloud-init drive →
  serial console → convert) run detached in a goroutine tracked by an
  in-memory registry in internal/api/buildtemplate.go, because the
  sequence outlives its request. A build interrupted by a restart
  leaves a VM, not a template — it shows up in VM instances.
- Keep store SQL portable between SQLite and Postgres: TEXT ids, RFC3339
  TEXT timestamps, no engine-specific types. Postgres is planned, not wired.
- Frontend talks only to `/api/v1` via `src/api/client.ts` (typed client);
  server state lives in TanStack Query (3s polling), not local state.
- UI style: GCP-inspired via MUI + the custom theme in `src/theme.ts`
  (Google blue #1a73e8, white surfaces, #dadce0 borders, dense tables).
- Navigation model (mirrors GCP): the hamburger opens a temporary global
  menu for switching between Lab Cloud sections; each section then has a
  permanent left nav with collapsible groups (GCP-style). Sections and
  groups live in `src/components/nav.tsx` — adding entries there wires
  both menus.
- Compute Engine nav groups: "Virtual machines" (VM instances, Images)
  and "Bare Metal Solution" (Servers). Servers lists the virtualization
  hosts; adding/registering new hosts will live there (planned).
- docker-compose dev caveat: file-change events don't cross the macOS→VM
  bind mount, so both watchers poll (air `poll = true`, vite
  `watch.usePolling`). Don't remove either.

## Config

`config.example.yaml` documents all settings; `config.yaml` is gitignored
(holds the Proxmox token). Env overrides use the `LCM_` prefix.
