# lab-cloud-manager

A home lab manager with a Google Cloud Console–inspired UI. Manage VMs on
your homelab hypervisor the way you'd manage Compute Engine instances.

- **Backend**: Go — REST API, SQLite storage, pluggable hypervisor drivers
- **Sign-in**: local accounts (bcrypt) with server-side sessions; SSO later
- **Frontend**: React + TypeScript + MUI (Vite)
- **Hypervisors**: Proxmox VE (via API token), plus a mock driver for development
- **Databases**: PostgreSQL and MySQL/MariaDB servers you already run, connected read/write

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

Base path `/api/v1`. Everything except `/auth/login`, `/auth/logout`
and `/auth/me` needs a session cookie:

- `POST /auth/login` (email + password → session cookie),
  `POST /auth/logout`, `GET /auth/me`, `POST /auth/password`
  (change your own, needs the current one)
- `GET /iam/roles`, `GET/POST /iam/users`,
  `GET/PUT/DELETE /iam/users/{id}`, `PUT /iam/users/{id}/password`

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
- `GET /backups` — guest backup archives across every server that
  keeps a catalog (`hypervisor.BackupDriver`), newest first;
  `DELETE /backups?server=&zone=&volume=`
- `GET /bridges` — network bridges per node, for the NIC pickers
- `GET /cloud-images`, `POST /cloud-images/{download,upload}`,
  `DELETE /cloud-images?server=&zone=&volume=` (disk images in a
  datastore's `import` content)
- `POST /vm-templates/build` + `GET /vm-templates/builds/{id}` — builds
  a cloud-init template from a disk image, tracked step by step
- `GET/POST /machine-types`, `DELETE /machine-types/{name}`
- `GET /servers`, `POST /servers`, `PUT/DELETE /servers/{id}`,
  `GET /server-types`
- `GET/POST /instances`
- `GET/DELETE /instances/{name}/`
- `POST /instances/{name}/{start|stop|reset|protection}`
- `GET /instances/{name}/ssh` — websocket carrying a terminal; the
  first frame is `{username, cols, rows}`, later frames are
  `{type: data|resize}`
- `GET /ssh-key` — YOUR public key (each account has its own, minted on
  first use), `POST /ssh-key/rotate` to replace it with a fresh pair,
  `PUT /ssh-key` to import one you already have. Guests normally get the
  key on their own: when authentication fails, the console creates your
  account there through the hypervisor's guest agent and retries once
  (`ssh.provision`, on by default; needs `VM.Monitor` on the Proxmox
  token)
- `GET /instances/{name}/{describe|metrics|os-info}` — live hypervisor
  reads for the detail view (`metrics` takes `?timeframe=hour|day|week|month`)
- `GET /database/engines`, `GET /database/servers`,
  `POST /database/servers`, `GET/PUT/DELETE /database/servers/{id}`
- `GET /database/databases` (spans servers, `?server=` narrows),
  `POST /database/servers/{id}/databases`,
  `DELETE /database/servers/{id}/databases/{name}`
- `GET/POST /database/servers/{id}/users`,
  `PUT /database/servers/{id}/users/{name}/password`,
  `DELETE /database/servers/{id}/users/{name}`
- `GET /database/servers/{id}/connections`
- `GET /network/provider-types`, `GET /network/providers`,
  `POST /network/providers`, `PUT/DELETE /network/providers/{id}`
- `GET /network/{networks,clients,devices}` — read from the configured
  controller, which defaults to the only one when `?provider=` is absent
- `GET /identity/provider-types`, `GET /identity/providers`,
  `POST /identity/providers`, `PUT/DELETE /identity/providers/{id}`
- `GET/POST /identity/users`,
  `POST /identity/users/{id}/{recovery,active,password}`
- `GET /identity/groups`, `POST /identity/groups/{id}/members`,
  `DELETE /identity/groups/{id}/members/{userId}`
- `GET /identity/applications`, `GET /identity/events?limit=`
- `GET /dns/providers`, `POST /dns/providers`,
  `PUT/DELETE /dns/providers/{id}`, `GET /dns/provider-types`,
  `GET /dns/accounts?provider=`
- `GET /dns/zones` (spans providers), `POST /dns/zones?provider=`,
  `GET /dns/zones/{id}?provider=`,
  `GET /dns/zones/{id}/records?provider=`,
  `PUT /dns/zones/{id}/record-sets?provider=`,
  `DELETE /dns/zones/{id}/record-sets?provider=&name=&type=`,
  `DELETE /dns/zones/{id}?provider=`
- `GET /containers`, `GET/DELETE /containers/{name}/`,
  `POST /containers/{name}/{start|stop|reset|protection}`

Projects (GCP-style resource grouping) were dropped pre-ship and may
return as a post-ship enhancement.

## Cloud-init

Instances and templates configure guests through Proxmox's cloud-init
support: login user and password, SSH keys, IPv4/IPv6 addressing
(DHCP, SLAAC or static), nameservers and search domain, package
upgrade on first boot, and the datasource format (NoCloud or
ConfigDrive 2). Blank fields leave the image's own defaults alone.

Arbitrary user-data YAML (`cicustom`) is deliberately not supported:
it needs a datastore with `snippets` content, and the Proxmox REST API
can't write snippet files — only SSH can, which is a much broader
credential than the scoped API token this app uses.

## Ideas for later

- **Observability over Zabbix**: the console can't yet answer "what's
  broken right now", which is the first question anyone brings to a
  console. Zabbix already knows — read its API for current problems,
  host availability and recent triggers rather than drawing new graphs
  next to its old ones. This is also what makes a global home page
  worth having: problems and recent activity as cards, the way GCP's
  console home works.
- **CI/CD over Woodpecker**: pipelines are console-shaped — a table of
  recent runs, red or green, with a link out to the failing step.
  Woodpecker has a REST API and an API token per user; Forgejo
  supplies the repositories behind it. Triggering a rebuild is the one
  write worth having; editing pipeline YAML stays in the repo.
- **Certificates via TLSentinel**: expiry is a classic homelab outage
  and nothing here tracks it. TLSentinel already monitors endpoints,
  grades TLS configuration and alerts on expiry, and issues personal
  API keys — the same credential shape every other provider in this
  app uses. The section lists endpoints with days-to-expiry and grade,
  and links out for the PKI toolbox and trust matrix. (Its own
  database, tlsentinel-dev, is already on rowlf-pg.)
- **Object storage**: the `s3` container and the Synology are invisible
  here except as a name in a Proxmox datastore list, while every
  backup lands on the latter. Build against the S3 API itself rather
  than any one server — ListBuckets, sizes and object counts are
  standard, and only MinIO's admin API for users and policies isn't,
  so a section that stays on plain S3 works against whatever is
  running. Garage is the intended backend (AGPL, Rust, built for
  self-hosting); versitygw is the alternative if the point is to put
  an S3 face on storage that already exists rather than a second data
  silo. DSM's API reports volume health and capacity but needs a
  session login with a dedicated read-only account, since it has no
  token auth.
- **PowerDNS as an internal provider**: `dns.Provider` already has room
  for it, but three things need doing first. A provider record has no
  endpoint — Cloudflare's is a constant — so self-hosted providers need
  `baseUrl` (and a self-signed TLS opt-out) the way servers have. Auth
  is an `X-API-Key` header rather than a bearer token. And PowerDNS is
  natively RRset-shaped: one PATCH replaces a whole set, so the
  per-record diffing that `saveDNSRecordSet` does for Cloudflare should
  move behind the interface — `SaveRecordSet`/`DeleteRecordSet` on the
  provider, with Cloudflare doing its own diff. Cheaper to change while
  Cloudflare is the only implementation. Cloudflare-only fields (the
  proxy toggle, full/partial setup) then want a capability check so the
  form can hide what a provider doesn't have, the way `ContainerDriver`
  works for hypervisors.
- **osquery**: run osquery on guests and surface it in the console, so
  OS Info goes beyond what the QEMU guest agent reports — installed
  packages, listening ports, users, running processes — and becomes
  queryable fleet-wide rather than per-VM. Would need an agent-install
  story (cloud-init) plus a collection endpoint; the OS Info tab is the
  natural home for it.
- **Display and serial consoles**: SSH is already proxied in the
  browser; the display (noVNC) and serial consoles are not. The
  instance detail view has a Console tab holding all three, and for now
  those two link out to the hypervisor's own console — Proxmox exposes
  `vncproxy`/`termproxy` as websockets with a one-time ticket, so
  bringing them in-app is the same shape as the SSH bridge. Serial
  needs a serial port on the VM, which the Console tab reports because
  it's the usual reason the option is missing.
- **CT provisioning**: create flow for containers (template picker,
  rootfs storage/size, unprivileged flag) — the CT Templates page
  already lists the sources.
- **Create from ISO**: an alternative boot source in the VM create flow.
- **CT template downloads**: Proxmox's appliance repo (`aplinfo`) would
  give CT Templates the same import flow ISOs now have.
