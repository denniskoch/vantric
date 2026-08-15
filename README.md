# vantric

A single pane of glass over the tools already running in your home lab,
wearing a Google Cloud Console–inspired UI. It doesn't reimplement what
those tools do — it connects to them and presents them in one
vocabulary, so you stop jumping between fifteen consoles.

| Section | Backed by | What you get |
|---|---|---|
| **Compute** | Proxmox VE | VM and LXC instances, disks, snapshots, backups, templates, ISOs, browser SSH |
| **Databases** | PostgreSQL, MySQL/MariaDB | Servers you already run: databases, tables, users, permissions |
| **Network** | UniFi | Sites, WiFi, networks, WAN/internet, VPN, devices, clients (read-only) |
| **DNS** | Cloudflare | Zones and record sets |
| **Identity Platform** | authentik | Users, groups, applications, events |
| **IAM & Admin** | this app | Who may use *this* console, and your own account |

- **Backend**: Go — REST API (chi), SQLite storage, pluggable drivers per section
- **Frontend**: React + TypeScript + MUI (Vite)
- **Sign-in**: local accounts (bcrypt) or OIDC single sign-on, both ending in a server-side session

## Quick start

```bash
make dev
```

Go and Node run on your machine, both reloading. `make` on its own lists
everything else. There's a mock hypervisor you can add from the UI, so
you can see the app work without a Proxmox cluster.

**Then find your sign-in password.** On first run the app creates one
owner account and logs its generated password exactly once:

```
msg="created the first owner account — sign in and change this password" email=lab@localhost password=…
```

Open http://localhost:5173, sign in with `lab@localhost` and that
password, and change it under IAM & Admin → My account. To choose the
password yourself instead, put `VANTRIC_AUTH_BOOTSTRAP_PASSWORD` in `.env`
**before** the first start — after that the account exists and the
setting is ignored.

Behind `make dev` are two ordinary commands, if you'd rather run them in
separate terminals — `make api` and `make ui`, or:

```bash
cd backend && go run ./cmd/server
```

```bash
cd frontend && npm run dev
```

The backend takes no arguments and needs no setup: the defaults put
SQLite in `backend/vantric.db` and serve on 127.0.0.1:8080, which is
where Vite proxies `/api`. Export any `VANTRIC_*` variable to change that.

Docker builds the app; it isn't used to develop it. `make up` runs the
built image on :8080, `make down` stops it.

## Connecting your lab

Every backend connects the same way: a credential record you add in the
GUI, verified against the real service before it's stored. There's no
config file for any of it — the app comes up first, and you add your lab
to it from there.

| To connect | Go to | You'll need |
|---|---|---|
| Proxmox | Compute → Settings → Hypervisors | API token (see below) |
| PostgreSQL / MySQL | Databases → Instances → Add | Host, port, a user that can read the catalog |
| Cloudflare | DNS → Providers | API token that can read and edit zones |
| authentik | Identity Platform → Providers | Admin API token |
| UniFi | Network → Controller | API key, or a local account on the controller |
| Single sign-on | IAM & Admin → Single sign-on | An OIDC application: issuer URL, client ID, and the redirect URI the page shows you |

### Proxmox

1. Datacenter → Permissions → API Tokens → Add. Simplest is to leave
   privilege separation off, so the token inherits its user's rights;
   otherwise give it a role covering the nodes, VMs and datastores it
   should manage.
2. One privilege is worth naming: **`VM.Monitor`**. It's what lets the
   console create its SSH account inside a guest through the QEMU guest
   agent. Without it everything else works, and the browser terminal
   fails on any guest that has never seen your key — with a message
   saying exactly that.
3. Add it under Compute → Settings → Hypervisors. The credentials are
   verified before they're stored, so a saved hypervisor is one that
   answers, and you can add as many as you run.

Concept mapping:

| Console concept | Proxmox |
|---|---|
| Zone | Cluster node |
| Image | Template VM (create instances = full clone) |
| Instance status | GCP-style: `PROVISIONING`, `STAGING`, `RUNNING`, `STOPPING`, `TERMINATED` |

## Deploying

`docker-compose.yml` builds one image with the API and the built UI; the
Go server serves the SPA with client-route fallback:

```bash
docker compose up -d --build   # everything on :8080
```

Settings are environment variables — there's no config file. Copy the
sample and edit it; compose reads `.env` automatically:

```bash
cp .env.example .env
```

| Variable | Default | What it does |
|---|---|---|
| `VANTRIC_AUTH_BOOTSTRAP_EMAIL` | `lab@localhost` | The first account. First run only |
| `VANTRIC_AUTH_BOOTSTRAP_PASSWORD` | *generated* | Left empty, one is generated and logged once |
| `VANTRIC_SITE_URL` | *from the request* | The address people reach this console at. Required behind a proxy or tunnel — see below |
| `VANTRIC_SSH_PROVISION` | `true` | Create the console's login on a guest through the guest agent |
| `VANTRIC_SSH_PROVISION_SUDO` | `false` | Give that login passwordless sudo |
| `VANTRIC_LISTEN` | `0.0.0.0:8080` | Set by the image |
| `VANTRIC_DB_DRIVER` / `VANTRIC_DB_DSN` | `sqlite`, `/data/vantric.db` | Set by the image |
| `VANTRIC_STATIC_DIR` | `/app/static` | Set by the image |

That's the whole list. Everything else — hypervisors, DNS providers,
database servers, authentik, UniFi, single sign-on — is added in the UI,
not configured here.

Or set them inline:

```bash
VANTRIC_AUTH_BOOTSTRAP_EMAIL=you@example.com \
VANTRIC_AUTH_BOOTSTRAP_PASSWORD='something long' \
docker compose up -d --build
```

Backends aren't set here — sign in and add them in the UI.

State lives in `./data/vantric.db`, a bind-mounted directory rather
than a named volume — the whole app is one SQLite file, and a file you
can see is a file you can copy:

```bash
docker compose stop && cp -a data data-backup-$(date +%F) && docker compose start
```

That file holds your accounts, every backend credential and every
account's SSH private key, so treat it as a secret. The image runs as
uid 1000; on a host where you aren't that user, `chown -R 1000:1000
data` once.

### Reaching it from outside the lab

`cloudflared` runs alongside the app, so the console is published
through a Cloudflare Tunnel without opening a port or holding a
certificate. Create the tunnel in Zero Trust → Networks → Tunnels, point
its public hostname at `http://app:8080`, and put the token in `.env` as
`TUNNEL_TOKEN`. Without a token that container restarts until you set
one; the app itself doesn't care.

**Set `VANTRIC_SITE_URL` when you do this.** Behind the tunnel the request
reaches the app addressed to `app:8080`, so anything the outside world
must agree with — the OIDC redirect URI in particular — would be built
from that and rejected by your identity provider:

```
VANTRIC_SITE_URL=https://console.example.com
```

**Put an Access policy in front of it.** This console holds credentials
for every backend in your lab and can open a root-capable shell on your
guests. It shouldn't be a URL anyone can reach.

The session cookie sorts itself out through the tunnel: it's marked
`Secure` when the request arrives over HTTPS or with
`X-Forwarded-Proto: https`, which cloudflared sets. On plain http over
the LAN it isn't, because a Secure cookie there is simply never sent —
which looks like a sign-in loop with no explanation.

## Architecture

```
backend/
  cmd/server/            entry point: loads config, builds registries, serves
  internal/
    api/                 REST handlers (chi), auth middleware, reconciler loop,
                         browser-SSH websocket bridge
    config/              YAML + VANTRIC_* env config
    store/               SQLite persistence (portable SQL, Postgres planned)
    hypervisor/          Driver interface — mock/ and proxmox/
    database/            Driver interface — postgres/ and mysql/
    dns/                 Provider interface — cloudflare/
    identity/            Provider interface — authentik/
    network/             Provider interface — unifi/
frontend/
  src/
    api/client.ts        typed API client; every call goes through it
    components/          Shell (top bar + section nav), nav.tsx (the site map),
                         FormPage, DetailTable, BrandIcon, ConnectButton
    pages/               one per screen, named for its route
    user.ts              useSession() — who you're signed in as
```

Each section repeats the same shape, and that's deliberate: an
interface package is the boundary, backends are DB records holding
write-only credentials, one live instance per record lives in a
`Registry`, and a factory maps a type string to an implementation.
Adding a backend means implementing the interface and registering it in
the factory — the API and the GUI dropdown follow automatically.

Design notes:

- **The backing tool is the source of truth**, not this app. The
  hypervisor owns runtime state (status, IPs); the store owns metadata.
  A reconciler syncs driver → store every 2s and the UI polls the API
  every 3s, so handlers never poll a hypervisor to answer a read.
- **Listings span every backend** and stamp each row with the server,
  provider or site it came from — one that errors is skipped and
  logged, not fatal to the page.
- **Sessions are rows, not tokens.** Signing out, disabling an account
  or changing a password takes effect on the next request rather than
  whenever a token would have expired.
- **SSH keys are per account.** The console signs in to guests as the
  local part of your email with your own key, so a guest's auth log
  names a person; the private half never leaves the backend.
- **Postgres for the store**: all SQL is written portably (TEXT keys,
  RFC3339 timestamps). Adding it means a `pgx` branch in `store.Open`
  plus `?`→`$n` placeholder handling.

## Development

```bash
cd backend  && go build ./... && go vet ./...     # build + vet
cd frontend && npx tsc -b && npm run build        # type-check + build
```

Both must pass before a commit. Changes are verified against real
backends rather than by a test suite; the one exception is
`internal/store/instances_test.go`, covering a create/reconciler race
that can't be reproduced on demand — `go test ./...` runs it.

## API

Base path `/api/v1`. Everything except `/auth/login`, `/auth/logout`
and `/auth/me` needs a session cookie:

- `POST /auth/login` (email + password → session cookie),
  `POST /auth/logout`, `GET /auth/me`, `POST /auth/password`
  (change your own, needs the current one)
- `GET /auth/providers` — which sign-in doors exist, read before anyone
  is signed in; `GET /auth/oidc/start` and `GET /auth/oidc/callback`
  are the round trip through the identity provider
- `GET/PUT/DELETE /iam/oidc` — the single sign-on configuration
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
- `GET /servers`, `POST /servers`, `PUT/DELETE /servers/{id}`,
  `GET /server-types`
- `GET /images/{id}?server=` — a template's own configuration, which is
  what a clone of it inherits; the create flow fills its defaults from
  this
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
- `GET /database/servers/{id}/databases/{name}/tables`,
  `GET /database/servers/{id}/databases/{name}/grants` — inside one
  database, read on demand for its detail view
- `PUT /database/servers/{id}/databases/{name}/access` — grant a user
  read/readwrite/full on one database, optionally creating that user in
  the same call; `DELETE …/access?user=&host=` revokes
- `GET /database/servers/{id}/connections`
- `GET /network/provider-types`, `GET /network/providers`,
  `POST /network/providers`, `PUT/DELETE /network/providers/{id}`
- `GET /network/{sites,networks,wifi,clients,devices}` — read across
  every site the controller manages, each row stamped with its site;
  defaults to the only controller when `?provider=` is absent
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

## Building a template from a cloud image

Compute → VM Templates → Build imports a downloaded cloud image, gives it
a cloud-init drive and a serial console, and converts it to a template.

**Put the guest agent in the image first.** Debian and Ubuntu cloud
images don't ship `qemu-guest-agent`, and the build's agent checkbox only
tells the hypervisor to expect one. On the Proxmox host, with
`libguestfs-tools` installed:

```bash
virt-customize -a debian-13-genericcloud-amd64.qcow2 --install qemu-guest-agent
```

Without it the console still creates and runs guests, but the hypervisor
can't ask them anything: no IP address in the instances list, no OS info,
and Connect has nothing to SSH to. That partial failure is the reason
this is worth doing before the template exists rather than per-VM after.

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
