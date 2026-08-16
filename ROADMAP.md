# Roadmap

Work that is understood but not done. Anything here has a reason it
isn't built yet, written next to it — a roadmap that only lists
features is a wish list.

## Before going public

### True OSS branding

`VITE_BRAND_*` already means a default build says Vantric rather than
KochLabs, and no occurrence of the word survives in the bundle. What
doesn't hold yet is the **asset**: `branding.ts` imports the KochLabs
SVG unconditionally into its logo map, so a default build still
carries roughly 3 KB of a wordmark it never renders.

Harmless to run, wrong to publish — a project's own artifact
shouldn't contain someone else's mark at all, whether or not it's
drawn. The fix is to stop importing it statically: either a dynamic
`import()` keyed on `VITE_BRAND_LOGO`, or a convention where the build
reads whatever SVG sits at an unversioned path and falls back to text.
The second also means a fork adds its logo without editing code, which
is the better answer for the same effort.

Related: the KochLabs SVGs live in `frontend/src/assets/brand/`. Once
the import is dynamic they can move out of the repo entirely and be
mounted at build time.

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
