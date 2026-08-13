# lab-cloud-manager

A home lab manager with a Google Cloud Console–inspired UI. Manage VMs on
your homelab hypervisor the way you'd manage Compute Engine instances.

- **Backend**: Go — REST API, SQLite storage, pluggable hypervisor drivers
- **Frontend**: React + TypeScript + MUI (Vite)
- **Hypervisors**: Proxmox VE (via API token), plus a mock driver for development

## Quick start (Docker, no cluster needed)

```bash
docker compose --profile dev up
```

Open http://localhost:5173. Backend hot-reloads on Go changes (air, polling
mode for macOS bind mounts), frontend has Vite HMR. Create an instance and
watch it go PROVISIONING → STAGING → RUNNING.

Native alternative (no Docker): `cd backend && go run ./cmd/server` plus
`cd frontend && npm run dev`.

## Deploying

The production image bundles the API and the built UI into one ~32 MB image;
the Go server serves the SPA with client-route fallback:

```bash
docker compose --profile prod up --build -d   # serves everything on :8080
```

Point it at Proxmox with env vars (or bake a config.yaml into a bind mount):

```bash
LCM_DRIVER=proxmox \
LCM_PROXMOX_URL=https://pve.example.lan:8006 \
LCM_PROXMOX_TOKEN_ID='root@pam!labcloud' \
LCM_PROXMOX_SECRET=xxxx \
docker compose --profile prod up --build -d
```

SQLite data persists in the `app-data` volume (`/data/labcloud.db`).

## Using Proxmox

1. Create an API token: Datacenter → Permissions → API Tokens (needs VM
   privileges on the nodes/VMs it will manage).
2. `cp config.example.yaml config.yaml` and fill in `proxmox:` settings,
   set `driver: proxmox` — or use the `LCM_*` env vars shown above.
3. Restart the backend (native: `go run ./cmd/server -config ../config.yaml`).

Concept mapping:

| Console concept | Proxmox |
|---|---|
| Zone | Cluster node |
| Image | Template VM (create instances = full clone) |
| Machine type | `hl-*` presets → cores/memory config |
| Instance status | GCP-style: `PROVISIONING`, `STAGING`, `RUNNING`, `STOPPING`, `TERMINATED` |

## Architecture

```
backend/
  cmd/server/            entry point
  internal/
    api/                 REST handlers (chi) + reconciler loop
    config/              YAML + LCM_* env config
    hypervisor/          Driver interface (the abstraction point)
      mock/              in-memory driver with simulated state transitions
      proxmox/           Proxmox VE REST driver
    store/               SQLite persistence (portable SQL, Postgres planned)
frontend/
  src/
    api/                 typed API client
    components/          Shell (top bar + nav drawer), StatusIcon
    pages/               Instances, CreateInstance, InstanceDetail, Images, Overview
```

Design notes:

- **The hypervisor is the source of truth for runtime state** (status, IPs);
  the store owns metadata (machine types, creation record). A
  reconciler polls the driver every 2s and syncs the store; the UI polls the
  API every 3s.
- **Adding a hypervisor** = implementing `hypervisor.Driver` (see
  `internal/hypervisor/driver.go`) and registering it in `cmd/server/main.go`.
- **Postgres**: all SQL is written portably (TEXT keys, RFC3339 timestamps).
  Adding it means a `pgx` driver branch in `store.Open` plus `?`→`$n`
  placeholder handling.

## API

Base path `/api/v1`:

- `GET /zones`, `GET /images`, `GET /isos`, `GET /ct-templates`,
  `GET /datastores`, `GET /disks`, `GET /snapshots` — span every
  registered server, each item stamped with `serverId`; `?server=`
  narrows to one (used by the create flows)
- `POST /isos/download` (hypervisor fetches a URL itself),
  `POST /isos/upload` (raw body streamed through to the hypervisor),
  `DELETE /isos?server=&zone=&volume=`,
  `DELETE /ct-templates?server=&zone=&volume=`,
  `DELETE /images/{id}?server=` (destroys a template VM),
  `GET /tasks/{taskId}` for import progress
- `GET/POST /machine-types`, `DELETE /machine-types/{name}`
- `GET /servers`, `POST /servers`, `PUT/DELETE /servers/{id}`,
  `GET /server-types`
- `GET/POST /instances`
- `GET/DELETE /instances/{name}/`
- `POST /instances/{name}/{start|stop|reset|protection}`
- `GET /instances/{name}/{describe|metrics|os-info}` — live hypervisor
  reads for the detail view (`metrics` takes `?timeframe=hour|day|week|month`)
- `GET /containers`, `GET/DELETE /containers/{name}/`,
  `POST /containers/{name}/{start|stop|reset|protection}`

Projects (GCP-style resource grouping) were dropped pre-ship and may
return as a post-ship enhancement.

## Ideas for later

- **osquery**: run osquery on guests and surface it in the console, so
  OS Info goes beyond what the QEMU guest agent reports — installed
  packages, listening ports, users, running processes — and becomes
  queryable fleet-wide rather than per-VM. Would need an agent-install
  story (cloud-init) plus a collection endpoint; the OS Info tab is the
  natural home for it.
- **Console access**: noVNC/serial console proxying (Proxmox exposes
  both), mirroring GCP's SSH-in-browser button.
- **CT provisioning**: create flow for containers (template picker,
  rootfs storage/size, unprivileged flag) — the CT Templates page
  already lists the sources.
- **Create from ISO**: an alternative boot source in the VM create flow.
- **CT template downloads**: Proxmox's appliance repo (`aplinfo`) would
  give CT Templates the same import flow ISOs now have.
