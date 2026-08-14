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

## What this is

A SINGLE PANE OF GLASS over tools that already run in the lab. The
point is to stop jumping between fifteen consoles — not to reimplement
what those consoles do. So the default answer to "should we build X?"
is: find the thing that already does X, connect to it, and present it
in this UI's vocabulary.

That shapes every section. Proxmox runs the VMs; this lists and
controls them. Cloudflare holds the zones. The hypervisor's own job
runner takes the backups; this lists and prunes them. The database
servers already exist; this connects to them. Where a tool owns data,
it stays the source of truth and this app reads it — a second registry
that nobody updates is worse than no registry.

What this app owns is the CONNECTIVE work no single tool can do: one
consistent UI, and the correlation between tools — what's running vs
what DNS publishes vs what the IPAM documents. Drift between systems
is the app's own contribution; the systems' data is not.

"Don't reimplement" is about the SOURCE OF TRUTH, not about what may
appear on screen. A section that reads another tool's API and offers
its everyday actions is exactly the point — an Identity section over
authentik's API belongs here as much as Zones over Cloudflare's does.
The test is whether this app invents a second copy of the data, not
whether it renders or writes to the first one.

Where the line does sit: a tool's deep, rare configuration — flow
designers, trigger expressions, rule builders — stays in that tool.
Surface the daily 90% here and link out for the rest.

## Architecture rules

- `internal/hypervisor.Driver` is the abstraction boundary. Nothing outside
  `internal/hypervisor/*` may import Proxmox specifics. New backends
  implement Driver and register in `internal/hypervisor/factory`
  (`factory.Types` + `Build`) — that alone exposes them in the API and the
  Servers GUI type dropdown.
- Servers (virtualization hosts) are DB records managed in the GUI
  (Compute → Settings → Hypervisors; they are backend credentials, the
  same shape as DNS providers), one live driver per server held in
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
- Backups are READ AND DELETE ONLY: the hypervisor's own backup jobs
  write them, this console lists what exists and removes what you no
  longer want. Listing is the optional `hypervisor.BackupDriver`
  capability (type assertion), so a driver without a backup catalog
  stays simple and its servers contribute nothing rather than erroring.
  A backup outlives its guest, so the archive carries the vmid and
  guest type; the name is resolved from the cluster where the guest
  still exists and left blank where it doesn't.
- Template builds (cloud image → import disk → cloud-init drive →
  serial console → convert) run detached in a goroutine tracked by an
  in-memory registry in internal/api/buildtemplate.go, because the
  sequence outlives its request. A build interrupted by a restart
  leaves a VM, not a template — it shows up in VM instances.
- DNS mirrors the hypervisor split: `internal/dns.Provider` is the
  boundary (Cloudflare first), providers are DB records with a
  write-only token, one live provider per record in `dns.Registry`, and
  a factory maps type → implementation. Zone listings span all
  providers and stamp each zone with its `providerId`. Provider
  credentials are verified against the API before being stored, so a
  saved provider is known-good.
- DNS records are edited as RECORD SETS — every record sharing a name
  and type, the Cloud DNS model. Providers address records one at a
  time, so the set is an API-layer concept: saving one diffs the
  values against what's there (update the pairs, create or delete the
  difference) in `saveDNSRecordSet`. Only types whose value is a plain
  string (A, AAAA, CNAME, MX, NS, TXT) are editable; CAA/SRV carry
  structured data and are list/delete only, not mangled through a text
  field.
- Databases follow the same split again: `internal/database.Driver` is
  the boundary (PostgreSQL and MySQL/MariaDB), servers are DB
  records with a write-only password, one live driver per record in
  `database.Registry`, and a factory maps engine → implementation.
  These are servers that ALREADY EXIST in the lab — the console
  connects to them and manages what's inside; it does not provision
  them. Credentials are pinged before being stored. Database listings
  span all servers and stamp each database with its `serverId`.
  DDL can't take bind parameters, so identifiers are checked against
  `identRe` in the API layer AND quoted by the driver; the engine's own
  databases are flagged `System` and refused for deletion.
- Engines share ONE nav item and one list, Cloud SQL-style — the
  engine is a column, not a section. Where engines genuinely differ,
  the fix is per-view, not per-nav-item: a cross-engine list drops the
  column that only one engine has (no owner on /databases/databases),
  and the instance detail branches on `server.type` because there the
  engine is known.
- The two engines disagree about identity and ownership, and the
  interface carries both: a MySQL user is name@host (so DropUser and
  SetPassword take a host, ignored by PostgreSQL) while a PostgreSQL
  database has an owner (ignored by MySQL, which uses grants). The UI
  branches on `server.type` for these two fields only.
- Identity is the same split once more: `internal/identity.Provider`
  is the boundary (authentik first), providers are DB records with a
  write-only token, one live provider per record in
  `identity.Registry`, and a factory maps type → implementation.
  Credentials are verified against `/admin/version/` before storing,
  which also proves the token is an admin one rather than
  self-scoped. The directory belongs to the provider: this reads it
  and does the everyday actions (disable, set password, group
  membership). Creating accounts and editing flows/stages/policies
  stays in authentik. Endpoints default to the single configured
  provider when `?provider=` is absent — a lab has one identity
  service, and making every page pass an id it can't get wrong is
  noise.
- IAM & Admin (this console's own RBAC) and Identity Platform (the
  lab's identity service) are deliberately separate sections: one
  governs access to this app, the other manages a service in the lab.
- Keep store SQL portable between SQLite and Postgres: TEXT ids, RFC3339
  TEXT timestamps, no engine-specific types. Postgres is planned, not wired.
- Frontend talks only to `/api/v1` via `src/api/client.ts` (typed client);
  server state lives in TanStack Query (3s polling), not local state.
- Form validation lives in `src/validation.ts` and must SHOW itself: a
  field turns red with the specific problem as soon as its value is
  invalid. A disabled submit button is never the only signal — if a
  rule gates submission, it needs a matching field error.
- UI style: GCP-inspired via MUI + the custom theme in `src/theme.ts`
  (Google blue #1a73e8, white surfaces, #dadce0 borders, dense tables).
  NO PILL BORDERS (theme MuiChip override): a chip is a borderless
  label on a #f1f3f4 tint at the standard 4px radius.
  Chips are for TAGS AND LABELS only — "RAM", "shared", "system", a
  VM's tags. What a row fundamentally IS (hypervisor type, database
  engine, DNS provider) is primary information: plain cell text at the
  table's own size, via `BrandLabel`, never shrunk into a badge.
- Brand marks (engines, hypervisors, DNS providers, guest operating
  systems) come from simple-icons, drawn inline by
  `components/BrandIcon.tsx` and looked up in `src/brands.ts`. Every
  lookup keys off a string the backend already returns — an engine
  type, a version banner, a file name — so adding a logo never needs
  an API change. The app makes no outside requests: nothing is loaded
  from a CDN.
- No authentication yet. The account avatar and menu in the app bar are
  a stub reading from `currentUser` in `src/components/Shell.tsx`; wiring
  real sign-in should mean replacing that constant and enabling the
  menu's actions.
- Navigation model (mirrors GCP): the hamburger opens a temporary global
  menu for switching between Lab Cloud sections; each section then has a
  permanent left nav with collapsible groups (GCP-style). Sections and
  groups live in `src/components/nav.tsx` — adding entries there wires
  both menus.
- Every section lands on the same template, `pages/SectionLandingPage.tsx`:
  header, an optional summary slot, then cards for the section's nav
  items grouped as the left nav groups them. Compute's overview
  supplies live counts through that slot; sections with no pages yet
  render their `planned` list instead. Landing copy (`description`,
  `planned`, per-item `hint`) lives in nav.tsx with everything else, so
  a new section needs no new page component.
- docker-compose dev caveat: file-change events don't cross the macOS→VM
  bind mount, so both watchers poll (air `poll = true`, vite
  `watch.usePolling`). Don't remove either.
- Colima dev caveat: this stack's whole job is reaching lab services on
  the LAN, and Colima's default route is the user-mode NIC, which
  refuses RFC1918 destinations. Symptom: every hypervisor, database
  and provider reads "unreachable" with `connect: connection refused`
  at once, while the same address answers from the Mac — a routing
  problem, not credentials. Fix is `preferredRoute: true` in
  `~/.colima/default/colima.yaml` (needs a restart), or per-boot
  `colima ssh -- sudo ip route add <lab subnet> via 192.168.64.1 dev col0`.

## Config

`config.example.yaml` documents all settings; `config.yaml` is gitignored
(holds the Proxmox token). Env overrides use the `LCM_` prefix.
