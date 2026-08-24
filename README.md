# vantric

**V**iews **A**cross **N** **T**ools, **R**econciled **I**n one **C**onsole.

[![check](https://github.com/denniskoch/vantric/actions/workflows/check.yml/badge.svg)](https://github.com/denniskoch/vantric/actions/workflows/check.yml)
[![image](https://github.com/denniskoch/vantric/actions/workflows/image.yml/badge.svg)](https://github.com/denniskoch/vantric/actions/workflows/image.yml)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

A single pane of glass over the tools already running in a home lab,
with a Google Cloud Console–inspired interface. It does not reimplement
what those tools do: it connects to them, presents them in one
vocabulary, and reports where they disagree.

That last part is the point of the name. Proxmox against DNS against the
IPAM, an inventory agent against the hypervisor, monitoring against what
is actually running — each section is a view onto somebody else's tool,
and the drift between them is the only thing this project owns.

| Section | Backed by | What you get |
|---|---|---|
| **Cloud overview** | everything below | What's wrong right now, without knowing where to look |
| **Shortcuts** | you | Your own tiles, for the tools with no API to put in a section |
| **Security** | FleetDM, NVD, CISA KEV | CVEs across the estate, and which of them are actually being exploited |
| **Monitoring** | Zabbix | Problems, and which running guests nothing is watching *(read-only)* |
| **Compute** | Proxmox VE | VMs, containers, disks, snapshots, backups and their schedules, templates, ISOs, nodes, browser SSH and RDP |
| **Docker** | capstan, socket proxy, Docker TLS | Containers by compose stack, images, volumes, networks, logs |
| **Devices** | FleetDM | Physical and virtual machines the agent found, joined to the guests here by SMBIOS UUID *(read-only)* |
| **Storage** | RustFS (S3) | Buckets, objects, quotas, access keys, and which buckets are public |
| **Databases** | PostgreSQL, MySQL/MariaDB | Servers you already run: databases, tables, users, permissions |
| **Network** | UniFi | Sites, WiFi, networks, WAN/internet, VPN, devices, clients *(read-only)*, and your own IPAM |
| **DNS** | Cloudflare | Zones and record sets |
| **Identity Platform** | authentik | Users, groups, applications, events |
| **Artificial Intelligence** | Bifrost, provider accounts | Request log, virtual keys, budgets, model prices, and what's left at each provider |
| **IAM & Admin** | this app | Who may use *this* console, the audit log, and your own account |
| **Documentation** | this app | The notes that ship with it |

Marked read-only where it is; everywhere else the console writes. The
line is the same in every section — the everyday actions live here, and
a tool's deep, rare configuration stays in the tool that owns it.

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
| Docker | Docker → Settings → Docker hosts | A front door for the socket, and its certificate fingerprint (see below) |
| PostgreSQL / MySQL | Databases → Instances → Add | Host, port, a user that can read the catalog |
| RustFS / S3 | Storage → Settings | Access key and secret; the admin API gives capacity and IAM |
| FleetDM | Devices → Settings → Inventory service | An **API-only** user's token — one copied from a browser session is the usual mistake |
| Zabbix | Monitoring → Settings | A token whose role allows `host.get`, `problem.get` and `event.get` |
| Bifrost | AI → Gateway → Connection | Nothing, if its management API is open; otherwise the admin credential — a virtual key will not do |
| Provider accounts | AI → Billing → Provider accounts | A key per provider. Four of ten report a real balance, and the page says which |
| Cloudflare | DNS → Providers | API token that can read and edit zones |
| authentik | Identity Platform → Providers | Admin API token |
| UniFi | Network → Controller | API key, or a local account on the controller |
| Single sign-on | IAM & Admin → Single sign-on | An OIDC application: issuer URL, client ID, and the redirect URI the page shows you |

Every one of them is verified against the real service before the record
is stored, so a saved backend is a working backend. Credentials are
write-only in every direction: the API exposes whether one is set, never
what it is.

### Self-signed certificates

Most of a home lab is self-signed, and "ignore TLS errors" means
anything on the network path can read the token you just stored. Where a
record offers a **certificate fingerprint**, use it: the console then
accepts exactly that certificate and nothing else, which needs no CA.

Read the real value off the host rather than trusting the one the form
fetched for you — that came over the network you are trying not to
trust:

```bash
openssl x509 -in /etc/pve/local/pve-ssl.pem -pubkey -noout | \
  openssl x509 -fingerprint -sha256 -noout       # or: pvenode cert info
```

A host that later presents a different certificate reads as its own
state, not as "unreachable" — those look identical as red dots and only
one of them means somebody is in the middle.

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
| Node | Cluster node (this was called a Zone once; GCP's zone is a datacenter, not one box) |
| Image | Template VM (create instances = full clone) |
| Instance status | GCP-style: `PROVISIONING`, `STAGING`, `RUNNING`, `STOPPING`, `TERMINATED` |

## Deploying

`docker-compose.yml` builds one image with the API and the built UI; the
Go server serves the SPA with client-route fallback:

```bash
docker compose up -d --build   # everything on :8080
```

Or pull a built image instead of building one. CI publishes to GHCR on
every merge:

| Tag | What it is |
|---|---|
| `edge` | The tip of `main`, rebuilt on every merge |
| `sha-abc1234` | One commit, for pinning exactly |
| `1.2.3`, `1.2` | A release, and the minor line it belongs to |
| `latest` | The newest release — **not** the tip of `main` |

```bash
docker pull ghcr.io/denniskoch/vantric:edge
```

There are no releases yet, so `edge` is the one to use and `latest`
doesn't exist. `linux/amd64` and `linux/arm64` are both published.

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
| `VANTRIC_GUACD_ADDR` | `guacd:4822` | The RDP/VNC proxy. It authenticates nothing, so it has no published port — reachable only on the compose network |
| `VANTRIC_TRUSTED_PROXIES` | *nothing* | Forwarding headers are believed only from a peer named here, so the audit log records who connected rather than who said they did. Set it behind the tunnel |

That's the whole list, and it is deliberately short: everything about
the *lab* rather than the app is a record you add in the UI. The
pre-rename `LCM_*` spellings are still honoured and warned about at
startup — config being environment-only means a deploy that renamed them
without a fallback would not fail, it would come up on defaults with an
empty database, which is worse.

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

**Nothing here publishes it for you.** A Cloudflare Tunnel, Caddy,
nginx, Traefik, Tailscale — all reasonable, and shipping one in the
compose file everybody runs would be choosing for you and leaving the
rest to delete it. Point whichever you use at the app: `http://app:8080`
if it shares the compose network, or the published port if it doesn't.

Two settings matter whichever you pick.

**`VANTRIC_SITE_URL`** — the address people actually reach this console
at. Behind a proxy the request arrives addressed to `app:8080`, so
anything the outside world has to agree with is built from that and
rejected. The OIDC redirect URI is the one that bites; the sign-on page
shows the URI the *server* computed, which is the one to register:

```
VANTRIC_SITE_URL=https://console.example.com
```

**`VANTRIC_TRUSTED_PROXIES`** — a forwarding header is believed only
from a peer named here, and it defaults to trusting nothing. Left unset
behind a proxy, every action in the audit log is attributed to the
proxy rather than to a person:

```
VANTRIC_TRUSTED_PROXIES=172.16.0.0/12
```

**Put access control in front of it.** This console holds credentials
for every backend in your lab and can open a root-capable shell on your
guests. It shouldn't be a URL anyone can reach — a Cloudflare Access
policy, Tailscale ACLs, basic auth at the proxy, whatever your front
door offers.

The session cookie sorts itself out: it's marked `Secure` when the
request arrives over HTTPS or with `X-Forwarded-Proto: https`, which
every proxy above sets. On plain http over the LAN it isn't, because a
Secure cookie there is simply never sent — which looks like a sign-in
loop with no explanation.

## Architecture

```
backend/
  cmd/server/            entry point: loads config, builds registries, serves
  internal/
    api/                 REST handlers (chi), auth middleware, reconciler loop,
                         browser-SSH websocket bridge
    config/              VANTRIC_* environment settings — there is no config file
    store/               SQLite persistence (portable SQL, Postgres planned)
    hypervisor/          Driver interface — mock/ and proxmox/
    database/            Driver interface — postgres/ and mysql/
    dns/                 Provider interface — cloudflare/
    identity/            Provider interface — authentik/
    network/             Provider interface — unifi/
    docker/              Provider interface — engine/ (one driver, three front doors)
    storage/             Provider interface — rustfs/
    inventory/           Provider interface — fleet/
    monitoring/          Provider interface — zabbix/
    ai/                  Provider interface — bifrost/
    aiaccount/           Provider interface — openrouter/, deepseek/, elevenlabs/
    nvd/  kev/           public CVE references: scores, and what is being exploited
    guac/                the Guacamole protocol, for RDP and VNC in the browser
    tlspin/              verify a host by its certificate, not by a CA
    registry/            one live driver per stored record, keyed by its id
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
- **Listings span every backend** and stamp each row with the
  hypervisor, provider, host or site it came from — one that errors is
  skipped and logged, not fatal to the page.
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

`make check` runs both plus `go test ./...`, and must pass before a
commit.

Most behaviour is verified against real backends rather than by a suite,
because most of it is somebody else's API answering. The tests that do
exist earn their place by covering what a live check can't: the
create/reconciler race, RBAC route coverage (a renamed route once
silently left a credential unguarded), and a growing set of **decoders
pinning what a backend actually sends** — Proxmox reporting `protected`
as `1` rather than `true`, `ctime` as a quoted string on one storage
type and an integer on another, a fingerprint pasted in any of four
shapes. Every one of those was a silent wrong answer before it was a
test.

There is also a live test against a real hypervisor, skipped unless told
where one is, which takes its credential from the console's own database
so running it never puts a token on a command line:

```bash
VANTRIC_TEST_NODE=pve1 go test ./internal/hypervisor/proxmox -run Live -v
```

## API

Base path `/api/v1`, JSON throughout, a session cookie on everything
except `/auth/{login,logout,me}`, `/auth/providers`, the OIDC round trip,
and the installer download — which carries its own token, because a
machine being enrolled has no session.

**The router is the list.** `backend/internal/api/server.go` registers
every route in one place and is the only description of them that cannot
go out of date. This file used to enumerate them and spent most of its
life wrong — a second registry nobody updates is worse than no registry,
which is the rule this whole project is built on.

The shapes worth knowing before you read it:

| | |
|---|---|
| **Catalog listings** | `/instances`, `/disks`, `/backups`, `/snapshots`, `/datastores`, `/dns/zones`, `/docker/containers` and the rest span **every** connected backend and stamp each row with the one it came from. `?hypervisor=`, `?provider=`, `?host=` narrows to one. A backend that errors is skipped and logged, never fatal to the page |
| **Long work answers 202** | A clone, a restore, an import, a power action: the handler validates, starts, and returns an `Operation`. `GET /operations` is what the notification bell reads |
| **Credentials are write-only** | Every backend record exposes `hasToken` or `hasSecret`, never the value. Sending a blank one on update keeps what is stored |
| **Optional powers are type assertions** | A driver either implements a capability or doesn't, and the API answers 501 by name rather than failing. Docker is the exception worth knowing: whether a host accepts writes is a property of the far end, so it is discovered by asking |
| **Roles** | Reads are open to anyone signed in. Changing a resource needs an editor; storing a credential or changing who may sign in needs an owner. Enforcement is middleware, and `rbac_test.go` names the routes that must stay covered |

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

## Contributing

`make check` — gofmt, build, vet, tests and a type-checked frontend
build — must pass before a commit. See [Development](#development) for
what that runs, and [ROADMAP.md](ROADMAP.md) for work that is understood
but not built.

## How this was built

vantric is written with AI assistance — Claude, working in this
repository — and the commit history records it: 376 of 378 commits
carry a `Co-Authored-By` trailer naming the model.

Two things follow that are worth knowing before trusting it with
credentials.

The reasoning is written down. Design decisions live in comments beside
the code they govern and in `CLAUDE.md`, including the ones that were
wrong first: why an orphaned disk is defined by its guest id rather than
by the config that mentions it, why a restore asks for a name instead of
a guest id, why one silently swallowed decode error hid twenty-five
backups. Where a rule exists, so does the failure that produced it.

Behaviour is verified against real systems rather than mocks. Most of
what this console does is somebody else's API answering, and the bugs
that matter are the ones where the documentation and the implementation
disagree — a hypervisor reporting `protected` as `1` rather than `true`,
or a timestamp as a quoted string on one storage backend and an integer
on another. Those are found by asking a real cluster, and the tests that
exist mostly pin what a backend actually sent.

Responsibility for what ships here is the maintainer's, not the tool's.

## License

[GNU Affero General Public License v3.0](LICENSE).

Copyright © 2026 Dennis Koch.

AGPL rather than a permissive licence because this is a server
application: MIT and Apache obligations engage on distribution, and
nobody distributes a web console — they run it. Section 13 covers that
case, so anyone who modifies vantric and offers it over a network has to
make their source available to its users. Given that this console holds
credentials for every backend in a lab, being able to audit what you are
running is worth the friction.
