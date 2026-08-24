# Roadmap

Work that is understood but not done. Anything here has a reason it
isn't built yet, written next to it — a roadmap that only lists
features is a wish list.

## Correlations the console is placed to make

Each of these joins two backends already connected, and none needs a
new integration. They exist because no single tool in the lab can see
both halves.

- **Filesystem usage per guest** — `agent/get-fsinfo` is one more
  guest-agent call beside the five already made, and it's the largest
  gap against GCE's OS Info. It also feeds the overview the way
  datastores do: "`/` at 94%" is exactly the shape of problem that page
  is for, and nothing in the console can currently see inside a guest's
  disk.
- **Activity per instance** — `audit_log` filtered to one guest. Every
  backend is reached through one service account, so Proxmox's task log
  can only ever say `root@pam!lcm`; who stopped this VM exists nowhere
  else.
- **DNS names for an instance** — which records across the connected
  zones resolve to its address, and the drift in both directions.
- **Network position** — `network.Client` already carries MAC, uplink,
  port, VLAN and whether the address is a lease or a reservation. The
  instance's NIC MACs are already parsed. That join is exact.
- **What a guest runs** — a database server record whose host matches
  an instance's address means that VM *is* rowlf.

## Gaps found and left

- **The overview misses guests with no backups at all.** It flags a
  newest backup older than eight days, so a guest that has never been
  backed up produces no problem, because it has no newest backup. In
  this lab that is fourteen of seventeen guests — the larger finding,
  invisible on the page built to surface exactly this.
- **Offboarding.** Removing an account removes its way in through the
  console, but its `authorized_keys` line stays on every guest it ever
  connected to. The provisioner only strips the line belonging to the
  account currently connecting.

## Larger

- **Colour tokens, then dark mode.** 348 hardcoded hex values across 65
  files bypass `theme.ts`. Dark mode is two jobs and the first one is
  the whole job: promote those literals to semantic tokens, which
  changes nothing visually, and only then add a second palette.
- **Tags.** Proxmox has native tags and `InstanceDetail.tags` already
  reads them. Filtering and editing on top would be the first grouping
  this console offers that isn't a hypervisor boundary.
- **Postgres for the store.** The SQL is kept portable and the cost is
  about a day, but it isn't worth paying yet: the database is a few
  megabytes, and putting the console's own state on a database server
  that this console manages means a bad restart of that server takes
  down the tool you would use to look at it. Revisit if replicas ever
  become real. See the note in CLAUDE.md.
- **Moving a guest between hypervisors.** Backup-and-restore works
  today by hand; Proxmox's `remote-migrate` is still experimental.

## New sections

Each is a tool a lab already runs, and each has a reason it is not
built yet. Monitoring, Storage, Devices and Docker were on this list and
are sections now.

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
  and links out for the PKI toolbox and trust matrix.
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
- **Display and serial consoles**: SSH and RDP are already proxied in
  the browser; the display (noVNC) and serial consoles are not, and
  `guacd` is already running for the RDP path. The
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
