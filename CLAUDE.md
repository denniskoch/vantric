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
  Removing a server is a DISCONNECT: it drops the server's instance and
  container records in the same transaction (they mirror the driver and
  mean nothing without it) and never touches the hypervisor, so the
  guests keep running and re-adding the server re-adopts them. Refusing
  until its guests are deleted would make forgetting a credential the
  most dangerous button in the app.
  Config seeds one server on first run only; after
  that config driver settings are ignored. Server secrets never leave the
  backend (`json:"-"`; API exposes `hasSecret`).
- SIZING IS TYPED IN, not chosen from a catalog. Machine types were a
  GCP analogue (`hl-standard-2` and friends) that didn't earn its keep:
  a lab has one of everything, so "4 vCPU, 8 GB" is the answer rather
  than the name of a shape somebody has to define first. The create
  flow takes vCPUs and memory directly; the table, the Settings page
  and the `/machine-types` endpoints are gone, and a migration drops
  the column and the catalog. `InstanceDetail.machineType` is unrelated
  — that's the chipset (i440fx/q35) and stays.
- Instance statuses are GCP's: PROVISIONING, STAGING, RUNNING, STOPPING,
  TERMINATED. Drivers map native states to these.
- The driver is the source of truth for runtime state (status/IPs); the
  store owns metadata. The reconciler (internal/api/reconciler.go) syncs
  driver → store; handlers never poll the driver for reads. The one
  documented exception is the detail view's on-demand reads
  (`/instances/{name}/describe|metrics|os-info`), since VM config and
  RRD history aren't mirrored in the store.
- SSH is BROWSER-BASED and proxied by the console server
  (internal/api/ssh.go): a websocket at
  `/instances/{name}/ssh` carries an xterm.js terminal, so a guest need
  only be reachable from the server. Credentials arrive as the socket's
  first frame — never as query parameters, which land in proxy logs.
  There is no credential prompt: the console signs in with the SIGNED-IN
  ACCOUNT'S OWN ed25519 key, as the local part of their email — never
  root. Host keys are not verified and the UI says so. RDP has no
  proxy, so Windows guests still get an `rdp://` URI for the desktop's
  own client. The Vite dev proxy needs `ws: true` or the upgrade never
  reaches the backend.
- SSH keys are PER ACCOUNT, not per console (`iam_users.ssh_*`,
  minted on first use). One shared key would put the same line in every
  authorized_keys and make a guest's auth log say only "the console";
  this way it says who, and removing someone's account removes their
  way in. The private half is write-only in every direction — the API
  will take one (`PUT /ssh-key`, stored decrypted because the console
  must use it unattended, which the form says out loud) and will make
  one (`POST /ssh-key/rotate`), but never returns one. The
  authorized_keys line is tagged `lab-cloud-manager:<email>`, and the
  provisioner strips any line containing `lab-cloud-manager` before
  adding the current one, so rotation replaces rather than piles up.
- The console's account is PROVISIONED JUST IN TIME, the way a cloud
  console does it: a guest this app adopted has never seen the key, so
  the first Connect can only fail — and on that failure the console
  creates the account through the hypervisor's guest agent and retries
  ONCE (`hypervisor.GuestProvisioner`, a capability like
  ContainerDriver; Proxmox's `agent/exec` in
  hypervisor/proxmox/provision.go; needs VM.Monitor on the token).
  The interface is deliberately `EnsureConsoleUser`, not a general
  Exec: agent/exec is root inside the guest and leaves nothing in its
  auth log, so it is used once to manufacture an ordinary SSH account
  and never for the session itself. Everything after that is plain SSH
  with real auth, real sudo, real logging. The provisioning script is
  POSIX sh, idempotent, and replaces any line tagged
  `lab-cloud-manager` rather than appending — so key rotation
  self-heals on the next failed connect. Sudo is a SEPARATE decision
  (`ssh.provisionSudo`, default off): creating a login is implied by
  clicking Connect, granting root fleet-wide is not. `ssh.provision:
  false` turns the whole path off and the terminal goes back to
  printing the key to install (`GET /ssh-key`).
- The instance detail view's Console tab is where every way into a
  guest lives — display, serial, SSH/RDP — with what each one needs
  spelled out (a stopped VM has no display; the serial console needs a
  serial port, which is the usual reason it's missing). Only SSH is
  proxied here; display and serial deep-link to the hypervisor's own
  console until they are, because linking out beats a disabled button.
- Instances carry an `osType` (Proxmox's l26, win11, …), filled once
  per instance by the reconciler on a slow beat because List doesn't
  report it and it never changes. Its only job is deciding whether
  Connect offers SSH or RDP.
- The reconciler syncs NAME AND SIZING as well as status and IPs
  (`syncShape`). Adoption is a race: a VM picked up while the
  hypervisor is still creating it reports no name and zero cpus/memory,
  and a record written from that snapshot used to keep those zeroes
  forever — which is what happened to VMs created in Proxmox after
  their hypervisor was added. Reconciling it every sweep also means a
  rename or resize done in the hypervisor shows up here. Only
  meaningful values are taken: a blank name or a zero count is the
  hypervisor not knowing yet, not an instruction to forget.
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
- A database DRILLS IN to its own tabbed page (Details / Tables /
  Permissions), the same template as a VM instance. Both extra tabs are
  read ON DEMAND and never polled: they query someone else's catalog,
  and PostgreSQL's is per-database, so `Tables` there opens a
  short-lived connection to the target rather than adding a pool per
  database. Row counts are the engine's ESTIMATE (n_live_tup/reltuples,
  TABLE_ROWS) — a console must not `COUNT(*)` a production table to
  draw a page — and an estimate of 0 renders as "—", since a table that
  has never been analysed reports 0 whatever its size. Permissions are
  three LEVELS, not a privilege matrix: read, read/write, full — the
  answers people bring to a console, which the two engines spell very
  differently. Granting always REPLACES, so lowering someone's access
  is a real reduction. PostgreSQL needs three things a naive GRANT
  misses, and all three are why this is code rather than a text box:
  USAGE on the schema (without it table privileges are unreachable),
  sequences (a serial column fails on INSERT without them), and ALTER
  DEFAULT PRIVILEGES **FOR ROLE the database owner** so the grant
  covers tables created later — otherwise access silently lapses at the
  next migration. MySQL grants on `db`.* and needs none of it. Revoking
  clears the standing rule too, or the next CREATE TABLE hands access
  back. Anything finer than the three levels stays in psql.
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
  membership) plus creating an account — which is two calls, since a
  new authentik user has no password: create, then issue a one-time
  recovery link to hand over, so the person sets their own and passes
  through enrollment and MFA rather than around them. Editing
  flows/stages/policies stays in authentik. Endpoints default to the single configured
  provider when `?provider=` is absent — a lab has one identity
  service, and making every page pass an id it can't get wrong is
  noise.
- Network is the same split a fifth time: `internal/network.Provider`
  is the boundary (UniFi first), controllers are DB records with
  write-only credentials, one live provider per record in
  `network.Registry`, and a factory maps type → implementation. READ
  ONLY for now — the console reports what the controller says, it does
  not reconfigure your network. UniFi ships in two generations and the
  driver speaks both: UniFi OS serves the network app under
  /proxy/network and logs in at /api/auth/login, the standalone
  controller has no prefix and uses /api/login. Which one you have is
  discovered on the first call rather than configured. Credentials are
  an API key where the controller offers one and a local account where
  it doesn't, and clients merge live sessions with known-but-offline
  records, because a reserved address that's powered off still
  occupies it. A controller holds several SITES and they share nothing
  but the login: every listing spans them all and stamps each row with
  its site, the way catalog listings span hypervisors. The section's
  nav follows the controller's own vocabulary — WiFi, Networks,
  Internet, VPN, Devices, Clients — with networks split by the
  `category` the driver derives from UniFi's purpose field. WiFi
  passphrases are never read. A WAN's live state comes from two places
  the network config doesn't hold — /stat/health for ISP and latency,
  the gateway device for each port's address — and a cellular backup
  is a device rather than a WAN port, so it's synthesized into the
  Internet list from its `mbb` object (carrier, signal, radio, plan).
  A failover uplink sitting idle reads "Standby", not a fault.
- IAM & Admin (this console's own RBAC) and Identity Platform (the
  lab's identity service) are deliberately separate sections: one
  governs access to this app, the other manages a service in the lab.
- Keep store SQL portable between SQLite and Postgres: TEXT ids, RFC3339
  TEXT timestamps, no engine-specific types. Postgres is planned, not wired.
- Frontend talks only to `/api/v1` via `src/api/client.ts` (typed client);
  server state lives in TanStack Query (3s polling), not local state.
- DESTRUCTIVE ACTIONS ASK IN PROPORTION, via
  `components/ConfirmDeleteDialog`. A one-click dialog is right for
  something that comes back — a credential you can re-enter, a grant
  you can re-issue, a disconnect that re-adopts. When the answer is
  "that data is gone", pass `confirmPhrase` and the user must TYPE it:
  the resource's own name (instance, container, database, DNS zone, VM
  template) or `I UNDERSTAND` where its name is a 60-character archive
  filename nobody would retype (backups). Typing is the point — it
  can't be muscle memory, and it makes you read which row you clicked.
  Deleting a VM had no confirmation at all before this rule existed.
- MODALS ARE FOR CONFIRMATION ONLY — a dialog asks "are you sure?" and
  nothing else. Anything you fill in gets its own page with the
  standard back link and Create/Save + Cancel bar: creating a resource,
  editing one, connecting a backend, changing a password. A form in a
  modal can't be linked to, survive a reload, or grow a second section
  without becoming a scrolling box.
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
- ROWS ARE 28px AND THAT IS THE HOUSE STYLE — a floor, set as
  `height` on the small table cell, which a table treats as a minimum.
  It's set rather than shrinking controls further, because a row
  holding a checkbox can't go below 28 and a text-only table matching
  it beats one running two pixels tighter. Rows still grow to fit
  wrapped text; that's content, not spacing. A row is as tall as
  the tallest thing in it, so the theme tightens every control that
  lives in a cell — icon buttons, checkboxes, small buttons, inline
  SVGs (which drag baseline descender space in unless made `display:
  block`) — so nothing in a cell exceeds that floor. The overrides are
  scoped to `MuiTableCell`, so the same small button in a page header
  stays comfortable to hit (20px in a table, 29px in a header). Don't
  fix density per page: a table with a checkbox column standing taller
  than one without is exactly what this prevents.
- Every list page opens with `components/PageHeader` — title, its
  actions, an optional description — so the title lands in the same
  place in every section. Written by hand the spacing drifts: buttons
  are taller than the text beside them, so a page with actions sits a
  few pixels lower than one without. The title row has a fixed
  min-height for that reason.
- Brand marks (engines, hypervisors, DNS providers, guest operating
  systems) come from simple-icons, drawn inline by
  `components/BrandIcon.tsx` and looked up in `src/brands.ts`. Every
  lookup keys off a string the backend already returns — an engine
  type, a version banner, a file name — so adding a logo never needs
  an API change. The app makes no outside requests: nothing is loaded
  from a CDN.
- AUTHENTICATION IS LOCAL FIRST and that is deliberate: signing in
  through the lab's identity provider is the better everyday door, but
  a console reachable only through another service is unreachable
  exactly when that service is what's broken. So `iam_users` holds
  email + bcrypt hash + role, and SSO joins it later rather than
  replacing it (an account with an empty `password_hash` is what an
  SSO-only user will look like).
- SSO IS OIDC, and it joins local accounts rather than replacing them
  (internal/api/oidc.go). Authorization code + PKCE, run entirely
  server-side, ending in the SAME session cookie a local sign-in
  produces — so disabling an account, signing out and roles work
  without knowing which door someone came through. Written on net/http
  like every other integration here: identity comes from a direct call
  to the provider's userinfo endpoint with a token just fetched from
  its token endpoint, which is why no ID token signature verification
  (and no JWT library) is needed — OIDC Core 3.1.3.7 says as much. One
  provider, one row in `auth_oidc`, configured in IAM & Admin → Single
  sign-on and verified against discovery before it's stored.
- BEING IN THE DIRECTORY IS NOT A WAY IN. OIDC matches a person to an
  existing account by EMAIL, which is already this app's login name and
  SSH username. `autoCreate` (default OFF) is what turns a successful
  authentication into a new account; with it off, an owner pre-creates
  the account — a user with a blank password is exactly that, and the
  create form says so.
- Sessions are SERVER-SIDE rows in `iam_sessions`, keyed by a random
  token in an HttpOnly cookie — not a self-contained token — so
  signing out, disabling an account or resetting a password takes
  effect on the next request instead of whenever a token expires. The
  whole API sits behind `requireAuth`; only `/auth/{login,logout,me}`
  are outside it, because the app has to be able to ask who it is
  before it knows. `useSession()` in src/user.ts is the frontend's
  answer, and Shell redirects to `/signin` when the answer is nobody.
- The first owner is seeded on FIRST RUN ONLY from `auth.bootstrap*`
  (same rule as the seeded hypervisor). With no password configured
  one is generated and logged once — the only time a password is
  written to the log, and better than a default nobody changes.
- Roles (owner/editor/viewer, GCP's basic roles) are stored and shown
  but NOT yet enforced per-endpoint; the Users page says so rather than
  implying a guard that isn't there. One role per user for now; the
  binding model is what it grows into. What IS enforced: the console
  can't lose its last active owner, and you can't delete or disable the
  account you're signed in as.
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
  the LAN. Colima's default route is the user-mode NIC, whose traffic
  is NAT'd by a proxy on the host; that path does reach the LAN until
  it doesn't — mid-session it can start refusing every 192.168.x
  destination while the Mac still reaches them fine. Symptom: all
  hypervisors, databases and providers read "unreachable" with
  `connect: connection refused` in the same second, which is a route
  failing, not five sets of credentials. The VM also has a vmnet
  interface (`col0`) that talks to the LAN directly; sending lab
  traffic over it avoids the proxy entirely — `preferredRoute: true`
  in `~/.colima/default/colima.yaml` (needs a restart), or per-boot
  `colima ssh -- sudo ip route add <lab subnet> via 192.168.64.1 dev col0`.

## Config

`config.example.yaml` documents all settings; `config.yaml` is gitignored
(holds the Proxmox token). Env overrides use the `LCM_` prefix.
