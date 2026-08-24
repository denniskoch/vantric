# vantric

**V**iews **A**cross **N** **T**ools, **R**econciled **I**n one **C**onsole.

The backronym came after the name and fits better than it has any right
to, which is why it is written down: it is the thesis of the whole
thing. Proxmox against DNS against the IPAM, Fleet against the
hypervisor, Zabbix against what is actually running — the RECONCILING
is what this app owns. Every section is a view across somebody else's
tool; the drift between them is the only thing here that is ours.

Home lab VM manager that replicates the Google Cloud Console experience
(GCP-inspired, not a pixel clone). Compute Engine–style instance management
backed by Proxmox, with the hypervisor abstracted for future backends.

## Commands

```bash
make dev      # both halves, reloading — open http://localhost:5173
make check    # gofmt, go build + vet + test, tsc + vite build. Must pass before a commit
make up       # build and run the app image in Docker (:8080)
make          # everything else
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
  Hypervisors GUI type dropdown.
- WHAT THINGS ARE CALLED, since two of these were renamed and the old
  words are still in the git history. A HYPERVISOR is a stored
  credential for a virtualization backend — `store.Hypervisor`, the
  `hypervisors` table, `hypervisorId` in JSON, `/hypervisors` in the
  API. It was "server", which was vague and already meant two other
  things here (a database server, and this app's own `api.Server`). A
  NODE is one host that credential reaches, and what a guest is placed
  on — `hypervisor.Node`, `/nodes`, the `node` column. It was "zone",
  borrowed from GCP where a zone is a datacenter holding thousands of
  machines rather than the single box this names. DNS ZONES are
  unrelated and keep the word, which is exactly what DNS means by it.
- Hypervisors are DB records managed in the GUI (Compute →
  Infrastructure → Hypervisors; they are backend credentials, the same
  shape as DNS providers), one live driver per record held in
  `hypervisor.Registry` keyed by hypervisor ID. Catalog listings (nodes,
  images, disks, snapshots, isos, ct-templates, datastores) span ALL
  hypervisors by default and stamp each item with its `hypervisorId` —
  see `listAcrossHypervisors` in internal/api/catalog.go.
  `?hypervisor=` narrows to one; the create flows use it since placement
  is per-hypervisor. One that errors is skipped and logged, not fatal to
  the page. Catalog TABLES show a Node column and not a hypervisor one:
  a record fronts one node in the ordinary case, so both columns
  answered the same question, and the node is the more specific answer.
  Removing a hypervisor is a DISCONNECT: it drops that hypervisor's
  instance and container records in the same transaction (they mirror
  the driver and mean nothing without it) and never touches the
  hypervisor itself, so the guests keep running and re-adding it
  re-adopts them. Refusing until its guests are deleted would make
  forgetting a credential the most dangerous button in the app.
  There is NO config path for adding one: hypervisors, like every other
  backend, are added in the UI once the app is up — two ways in, one of
  which silently applies only to an empty database, is a thing to
  explain rather than a feature. Secrets never leave the backend
  (`json:"-"`; API exposes `hasSecret`).
- A NODE IS A RESOURCE, not just a placement dropdown. `/nodes` lists
  every host across every hypervisor with the usage a host listing
  already reports, and a node drills into the one page in this console
  that describes the SUBSTRATE — CPU model, load, swap, and the host's
  own root filesystem. Every other page can show healthy guests and a
  half-empty datastore while the machine under them is out of memory.
  It sits at the BOTTOM of the nav, under Infrastructure: it's what you
  check when something is wrong, not where you work.
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
  authorized_keys line is tagged `vantric:<email>`, and the
  provisioner strips any line containing `vantric` OR the old
  `lab-cloud-manager` before adding the current one, so rotation
  replaces rather than piles up. BOTH TAGS ARE MATCHED FOREVER: the
  app was renamed after guests had already been provisioned, and the
  strip pattern is the only thing that removes a superseded key — drop
  the old tag and every one of those guests keeps a still-valid key
  that rotation will never replace again.
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
  POSIX sh, idempotent, and replaces any line tagged `vantric` (or the
  pre-rename `lab-cloud-manager`) rather than appending — so key
  rotation self-heals on the next failed connect. It SETS ITS OWN PATH: exec
  runs with whatever environment the agent's service carries, and on
  RHEL-family guests that arrives without /usr/sbin, where useradd
  lives — while Debian and Ubuntu pass a fuller one, which is what
  made "no useradd or adduser" look like a Rocky bug rather than the
  script assuming someone else's environment. It also REPORTS WHAT THE
  GUEST SAID rather than diagnosing from in there: SELinux confines the
  agent on RHEL guests (`virt_qemu_ga_t`) tightly enough to deny
  getattr on /usr/sbin/useradd, so the shell truthfully says "not
  found" about a binary in plain sight, and nothing inside the script
  can tell that from an image without the tool. Both errors go up
  verbatim, with a note where /etc/selinux/config exists. Such a guest
  needs its booleans loosened or its key installed by hand — the
  terminal's fallback — and the console doesn't pretend otherwise.
  Sudo is a SEPARATE decision
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
- Instances carry the two FACTS A GUEST IS BORN WITH — `osType`
  (Proxmox's l26, win11, …) and `uuid`, its SMBIOS system UUID — filled
  once per instance by `fillFacts` in the reconciler on a slow beat,
  because List reports neither and neither changes. One Describe fills
  both. osType decides whether Connect offers SSH or RDP. The UUID is
  the CORRELATION KEY: it is what the guest reads about itself
  (/sys/class/dmi/id/product_uuid) and what inventory and monitoring
  record as its identity, so it's how a record here lines up with a
  tool running inside the machine. It is also the only identifier that
  survives a rename, a migration and a vmid being REUSED — which is
  why any future local metadata keys on hypervisorId + uuid, never on the
  vmid. Proxmox spells it inside `smbios1`, a list whose other fields
  may be base64; `smbiosUUID` parses it and is one of the repo's few
  tests, since an empty result would show up as a correlation that
  silently never happens rather than as an error.
- THE SERIAL IS READ TOO, AND IS USUALLY EMPTY. `smbios1` also carries
  a serial number, which a hypervisor sets for nobody: device inventory
  built on osquery (FleetDM) keys hosts by `hardware_serial`, so a lab
  of VMs all reporting nothing is a lab its own tooling can't tell
  apart. The console reports it, and reports its ABSENCE in words
  rather than as a dash, because "not set on the hypervisor" is the
  actionable fact where "—" reads as "we didn't look". Unlike the uuid,
  the serial IS base64-encoded whenever the config carries `base64=1`,
  so `smbiosField` decodes it — and the uuid must not be decoded even
  then, which is what its test pins.
- A SERIAL IS SET AT BIRTH OR NOT AT ALL. The create flow writes one
  (defaulting to the instance name), because SMBIOS is read at boot:
  before first start it costs nothing, afterwards it costs a reboot.
  Writing it means REWRITING `smbios1` — one config key holding every
  SMBIOS string — so `setSerial` reads the uuid Proxmox generated for
  the clone and preserves it, since that's the identity everything
  correlates on; the other string fields are dropped rather than
  re-encoded, being unset on every VM this has ever seen. A failed
  write does not fail the create: the machine exists, and the gap
  reports itself, because the reconciler reads the serial back and the
  detail page says "not set on the hypervisor" instead of showing what
  was asked for. Setting one on a TEMPLATE is the trap to avoid —
  clones inherit it, and a fleet of identical serials is the
  duplicate-host problem the field exists to prevent.
- A FIELD NOBODY READ MUST NOT RENDER AS A DEFAULT. The cloud-init rows
  shipped with five values the driver never parsed — `ipconfig0`,
  `nameserver`, `searchdomain`, `ciupgrade`, `citype` were declared on
  `InstanceDetail` and written on create, but `describe` skipped them —
  and the UI dressed the zero values as "image default", "host default"
  and "No". A VM with a static `ipconfig0` therefore read as DHCP: not
  a blank, a confident false statement, and the exact inverse of the
  serial rule above. Two things follow. Proxmox OMITS A KEY LEFT AT ITS
  DEFAULT, so absent and explicit-zero are different answers and the
  default is not always off — `ciupgrade` defaults to ON, which is why
  `cfgBoolDefault` exists and `cfgBool` was wrong here. And a guest with
  NO CLOUD-INIT DRIVE reads none of it: `CloudInit` says whether the
  drive is there at all, because printing a section of inert defaults
  describes a machine that doesn't exist. Only one of this lab's
  seventeen guests has that drive.
- The reconciler syncs NAME AND SIZING as well as status and IPs
  (`syncShape`). Adoption is a race: a VM picked up while the
  hypervisor is still creating it reports no name and zero cpus/memory,
  and a record written from that snapshot used to keep those zeroes
  forever — which is what happened to VMs created in Proxmox after
  their hypervisor was added. Reconciling it every sweep also means a
  rename or resize done in the hypervisor shows up here. Only
  meaningful values are taken: a blank name or a zero count is the
  hypervisor not knowing yet, not an instruction to forget.
- THE CREATE FLOW READS THE TEMPLATE rather than asking again. A
  template built here was given a login, keys, DNS and a size, and a
  clone inherits all of it — Proxmox copies the config — so
  `GET /images/{id}?hypervisor=` describes the template and the form fills
  its blanks from that. Only blanks: picking an image never overwrites
  something typed, and sizing stops following the template once the
  sizing fields have been touched. This pairs with the existing rule
  that blank cloud-init fields on create leave the clone's inherited
  values alone — the form was asking questions whose answers were
  already on file.
- CREATING AN INSTANCE RACES THE RECONCILER, and the create flow wins
  by claiming rather than failing. A Proxmox clone can outlast the two
  second sweep, so the VM appears on the hypervisor before the handler
  writes its record and gets adopted first — under the requested name,
  or as `vm-<vmid>` when Proxmox hasn't named it yet. That surfaced as
  "saving instance: UNIQUE constraint failed" over a machine that had
  been built, or as two records for one VM. So after `driver.Create`
  the handler looks the VM up by `GetInstanceByDriverID` and, if a
  record exists, `ClaimInstance` renames it and writes everything
  adoption couldn't know — image, network, description, and whether
  protection was actually asked for. `internal/store/instances_test.go`
  covers it; it's the one test in the repo because the race is
  otherwise only reproducible against a slow hypervisor.
- A NEW INSTANCE POWERS ON BY ITSELF, the way it does in GCP — you
  asked for a machine, not for a machine you then have to switch on.
  The boot is a STEP OF THE CREATE OPERATION (`startNewInstance`), not
  a fire-and-forget inside the driver, which is what it used to be:
  Proxmox holds the clone lock for as long as a full copy takes, a
  start issued into that lock fails, and the discarded error left a
  freshly built VM sitting stopped with nothing saying why. So it
  retries for ten minutes at five-second intervals — long enough to
  outlast a slow disk rather than a slow API — and if it never takes,
  the operation ends in an error that says the instance was created but
  wouldn't start. The record is written before the boot is attempted,
  so Start is one click away either way.
- THE GUEST'S ADDRESS IS CHOSEN, NOT TAKEN. A guest reports every
  interface it has, in whatever order the kernel lists them, and a
  Docker host has three or four: the old rule (first one that isn't
  `lo`) therefore depended on whether docker0 was created before or
  after the NIC was renamed. `pickGuestIP` RANKS them instead — an
  ordinary NIC beats a tunnel (tailscale, wireguard) beats a container
  bridge (docker0, br-*, veth*) — and rejects loopback and the
  link-local address a machine assigns itself when DHCP fails. A bridge
  address is still returned when it's all there is, since something
  beats blank, but it can never outrank the LAN address. Its test
  carries the real interface lists of the guests this was written for,
  because the old rule got several of them right by luck.
- AN ADDRESS IS RE-READ, NOT REMEMBERED. The agent lookup used to run
  only while the field was EMPTY, so a lease learned once was kept
  forever: DHCP moves the guest, the console keeps offering the old
  address, and the SSH terminal dials something nothing answers on —
  which looks like broken SSH rather than a stale record. `dueForIP`
  asks often while there's no address (every 5th sweep, since a booting
  VM gets one in seconds) and slowly once there is (every 30th), which
  is one agent call a minute per running guest.
- The reconciler also ADOPTS VMs found on a hypervisor that the app didn't
  create (they appear as instances with deletion protection enabled) and
  removes instances whose VM vanished out-of-band. Driver.List must be
  one cheap call; guest-agent IP lookups happen via Get, throttled.
- Containers (LXC) are a SEPARATE resource from VM instances — separate
  table, API (/containers), nav item, and pages. The UI says CONTAINER,
  not Proxmox's "CT" (which reads as nothing beside VM) and not "LXC"
  (which would name the UI after one implementation of the capability
  interface below) — because they list and
  provision differently. Container support is the optional
  hypervisor.ContainerDriver capability interface (type assertion), so
  future drivers without containers stay simple. Proxmox's
  cluster/resources?type=vm returns BOTH qemu and lxc: always filter by
  the resource Type field.
- A DISK IS LISTED IN ALL THREE STATES IT CAN BE IN, and the list used
  to hold only the undeletable one. It carried attached disks alone —
  exactly the set `DeleteDisk` refuses, and rightly, since the detach
  is the two-step that stops a typo destroying a running guest's disk.
  Meanwhile the volumes that cost space for nothing appeared on no page
  here OR in Proxmox: a DETACHED disk, which Proxmox parks in the
  config as `unusedN`, and an ORPHAN, which is what a guest deleted
  out-of-band leaves on the datastore.
  AN ORPHAN IS DEFINED BY THE VMID, NOT BY THE CONFIG, and that was
  learned by asking a real cluster. "No config mentions this volume"
  finds fourteen false positives here: thirteen cloud-init drives,
  because `ide2: …,media=cdrom` was skipped BEFORE being counted as a
  reference, and one snapshot's saved RAM, because a live guest owns
  volumes its CURRENT config never names — the state a snapshot wrote
  and the disks older snapshots still point at. So a volume is an
  orphan only when no config references it AND no guest with its vmid
  exists at all.
  DELETING ONE DISPATCHES ON THE STATE, RE-READ AT DELETE TIME rather
  than trusted from the page: attached is refused and names the guest,
  detached goes through the guest's config, and an orphan goes through
  the datastore — the same call that removes an ISO, since there is no
  guest left to ask.
- A BACKUP RESTORES BESIDE THE ORIGINAL BY DEFAULT. The form opens with
  a free guest id already in it (`/cluster/nextid`), so pressing Restore
  without touching anything makes a second guest and cannot lose
  data — which is what you want for "what was in this backup" and for
  bringing back something somebody deleted. Overwriting is the other
  thing entirely: Proxmox deletes the guest and its disks before
  unpacking, so it appears only once the id you typed belongs to
  something, it makes you type that guest's name, and it is REFUSED
  outright while the guest is running — the same rule instance deletion
  follows, for the same reason.
  STARTING IT IS OFF, unlike a create. A restored guest can carry the
  same address, hostname and cluster identity as one still running, and
  two of those on one network is its own outage.
  TWO ENDPOINTS AND TWO SPELLINGS. A VM restore is a create with
  `archive`; a container restore is a create with `ostemplate` AND
  `restore=1` — and without that flag the same field means "build a
  fresh container from this template", which doesn't fail, it just
  makes an empty container named after your backup.
- Backup ARCHIVES are read and delete only: the hypervisor's own backup
  jobs write them, this console lists what exists and removes what you
  no longer want. Listing is the optional `hypervisor.BackupDriver`
  capability (type assertion), so a driver without a backup catalog
  stays simple and its hypervisors contribute nothing rather than erroring.
  A backup outlives its guest, so the archive carries the vmid and
  guest type; the name is resolved from the cluster where the guest
  still exists and left blank where it doesn't.
- BACKUP SCHEDULES ARE THE JOBS, and this console reads and edits them
  without keeping one of its own. A job made here is the same vzdump
  job the hypervisor's UI shows, so turning this console off does not
  stop your backups — the difference between managing a tool and
  replacing it. `hypervisor.BackupScheduler` is a SEPARATE capability
  from BackupDriver: listing the archives and changing the jobs are
  different powers, and a backend can have the first without the
  second.
  WHAT NO JOB COVERS IS AN ALERT, NOT A LIST. Twenty-eight names in
  chips is a wall you read by scrolling and then leave anyway to act on
  — so the schedules page keeps the NUMBER and hands you a page that
  can do something about it: filters by hypervisor, node and kind, and
  one action, adding the selection to a job that already runs. Adding
  beats creating: a second job at a second time is how a lab ends up
  with two retention policies and no idea which applies.
  ADDING GUESTS IS ITS OWN DRIVER CALL, and that is a safety property.
  Update writes the whole job and CLEARS what a form left blank, so a
  caller that rebuilt a spec to append two guests would take the
  retention policy with it. `AddGuestsToSchedule` reads, merges,
  de-duplicates and writes the `vmid` key alone — no `delete` list,
  nothing else touched. It also refuses a job already set to `all`,
  where writing a guest list would NARROW the job rather than widen it.
  A GUEST ONLY JOINS A JOB ON ITS OWN HYPERVISOR, so a selection
  spanning two says so instead of offering a picker that would write
  the wrong thing.
  WHAT NO JOB COVERS LEADS THE PAGE, and the HYPERVISOR answers it
  (`GuestsNotInBackup`). Working it out from the job list here would be
  reimplementing the thing that already knows — "everything except
  these three" and "these fifteen vmids" are the same coverage in
  different clothes. On this lab the answer was 28 guests, including
  the monitoring VM, the WireGuard VM and this console's own.
  THE SYNTAX GETS A BUILDER AND THE FIELD STAYS FREE TEXT. A calendar
  event and a prune policy are both property strings nobody remembers
  the spelling of, so each has a picker beside its field that writes
  into it — and each shows the expression it produced rather than
  hiding it, because the field is still where you tweak the answer.
  They are POPOVERS, not modals: the modal rule here is about forms
  that create a resource, and these are pickers on one field, the
  shape TimeRangePicker already uses. The builder covers what people
  schedule; the field covers what Proxmox accepts, which is much more
  ("mon..fri 8..17,22:0/15" is a real answer) and must not be narrowed
  to whatever the console thought of.
  RETENTION IS DESCRIBED IN PROXMOX'S TERMS, NOT PARAPHRASED.
  keep-daily=14 means "the newest backup of each of the last 14 days",
  not "14 daily backups", and the two diverge the first time a run is
  missed — so the summary says which it is.
  THE SCHEDULE IS VALIDATED BY THE THING THAT WILL RUN IT. A systemd
  calendar event has a grammar with no business being reimplemented
  here, and it resolves against the CLUSTER's timezone, not ours — so
  the field is sent to the hypervisor as typed and the next five runs
  come back, which validates it and answers the question you had.
  A JOB THAT COVERS NOTHING IS REFUSED. Proxmox accepts one and runs it
  forever backing nothing up, which is worse than an error because it
  looks like coverage.
  THREE THINGS THE LIBRARY GOT WRONG, all found against a real cluster.
  `prune-backups` is documented as a property string and comes back as
  an OBJECT once retention is configured, which fails go-proxmox
  v0.8.1's decode and makes every job on that hypervisor invisible —
  so the list is decoded here with a type that takes either shape (not
  fixed upstream; 0.8.1 is newest). `Enabled` is a bool tagged
  `omitempty`, so `false` is DROPPED and Proxmox defaults a new job to
  ON — asking for a job that doesn't run yet and silently getting one
  that does. It is written by hand on create and on update. And an
  omitted field on update means "leave it alone", not "clear it", so
  emptying retention or a notes template needs Proxmox's own `delete`
  list — otherwise the form saves, changes nothing, and comes back
  still showing the old value.
- THE GUEST AGENT HAS TO BE IN THE IMAGE, and Debian/Ubuntu cloud
  images don't ship it. `enableAgent` on a build only sets `agent=1` on
  the VM, which is the hypervisor's half; the guest half is
  `virt-customize -a image.qcow2 --install qemu-guest-agent` on the
  host, with libguestfs-tools. Missing it degrades exactly the things
  that read the guest — no IP in the list, no OS info, nothing for
  Connect to reach — while everything else keeps working, which is what
  makes it hard to spot. The build page says so at the checkbox; this
  app can't do it, because reaching the image means SSH to the host,
  the same credential it refuses for `cicustom`.
- HAVING THE AGENT ISN'T HAVING guest-exec. The RHEL family (Rocky,
  Alma, CentOS, RHEL) ships qemu-guest-agent with the exec and file
  RPCs BLOCKED — `BLOCK_RPCS` in /etc/sysconfig/qemu-ga, older builds
  `BLACKLIST_RPC` — so JIT console provisioning gets a 500 "Command
  guest-exec has been disabled" on a guest where everything else about
  the agent works. That refusal is the GUEST's, not the token's, which
  is why `execError` names it: a bare 500 sends you auditing
  VM.Monitor on a privilege that was never the problem. The fix is one
  sed in the template image, and the build page carries it next to the
  agent note; the terminal falls back to printing the key either way.
- WORK THAT OUTLIVES ITS REQUEST IS AN OPERATION, and operations
  report in the NOTIFICATION BELL — left of the account avatar, where
  a cloud console puts it. A clone, a disk import, an ISO fetch: the
  handler validates, starts the work, and answers 202 with the
  operation (`internal/api/operations.go`, RUNNING → DONE | ERROR).
  This replaced three mechanisms that each tracked one thing: a build
  registry, raw hypervisor task ids handed to the browser so every
  page that started one had to watch it, and a create handler that
  simply blocked. Two ways to run: `Server.run` for work this console
  does itself, `Server.watchTask` for a task the hypervisor is running
  (same shape in the bell either way). The bell also INVALIDATES what
  an operation touched as it lands — `resourceType` maps to query keys
  in the frontend, since the backend has no business knowing them.
  State is in memory: a restart forgets what was in flight, which is
  honest, where rows in the database would survive as operations stuck
  at RUNNING with nothing left to advance them.
- THE BELL REPORTS WITHOUT BEING OPENED, which is the only reason to
  put it in the toolbar, and it does it with a RING rather than a
  wiggle. It used to shake — a swing that decayed over a second and
  then rested, kept short because a permanent animation stops being
  information — and the trouble is that a signal you have to be
  looking at when it fires is a signal you miss. A circle is a STATE,
  readable whenever you happen to glance: it turns while work runs,
  and once work lands it closes and holds the COUNT of what finished
  since you last looked, green or red. In that state the bell is gone,
  because the number is the news. Opening the menu is reading it.
  Running OUTRANKS unread — a new action starts the ring turning even
  with a count waiting — since the thing still changing is the thing
  worth watching. One `mode` drives the shape, the count and the
  label together, because deriving them separately let them disagree.
  `prefers-reduced-motion` leaves the ring closed and still rather
  than removing it: there is no dot or colour behind it to fall back
  on any more, so the shape has to survive without the motion. The
  arc is `disableShrink`, or MUI's spinner thins to a dash twice a
  turn and reintroduces the disappearing signal this replaced. Template builds are
  the same path (cloud image → import disk → cloud-init drive → serial
  console → convert), so a build interrupted by a restart still leaves
  a VM, not a template — it shows up under Virtual machines.
- A PAGE WAITS ONLY FOR WORK THE BROWSER ITSELF IS DOING. An upload
  keeps its progress bar because the bytes are leaving this machine;
  the hypervisor's import afterwards is the bell's. A download from a
  URL, a build and a create navigate away immediately — they were
  never anything the form could contribute to, and a wizard that sits
  spinning is a wizard that loses the answer when the laptop sleeps.
  Deleting an instance is still synchronous, since the record has to
  be gone before the list is right.
- POWER IS AN OPERATION TOO, not just creation. A graceful stop waits
  on the guest's own shutdown and a reset waits for it to come back,
  so start, stop and reset — for instances and containers alike —
  report in the bell rather than answering "accepted" and leaving the
  list to explain the rest. Same for SNAPSHOTS: taking one on a
  running guest writes its RAM out to disk and a rollback reads it
  back, which is minutes on a machine with any memory. That is what
  moved `Start`/`Stop`/`Reset` (and their container equivalents) from
  returning an error to returning a TASK ID, the way `DeleteVolume`
  and `DeleteImage` already did — a power action the console can't
  follow is one it can only report the beginning of. A driver with
  nothing to follow returns an empty id and `watchOrFinish` closes the
  operation out immediately, because an operation left RUNNING with
  nothing to advance it is the lie this package exists to avoid.
  The two backends differ on refusals and both are honest: qemu makes
  a task that fails with "VM 1001 already running", lxc rejects the
  request outright with a 500, so one lands in the bell as an ERROR
  and the other comes straight back to the page.
  What stays synchronous is what the panel that started it has to
  show: a disk change (seconds, and Add and Attach answer with the
  disk's name), a resize (a config write), and the instance delete
  above.
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
- DEVICE INVENTORY is the same split a sixth time:
  `internal/inventory.Provider` is the boundary (FleetDM first),
  services are DB records with a write-only token, one live provider
  per record in `inventory.Registry`, and a factory maps type →
  implementation. Credentials are verified before storing, and a 401
  says out loud that Fleet wants an API-ONLY user's token, since a
  token copied from a browser session is the usual mistake. READ ONLY,
  and more strictly than Network: this reports what the agents found.
  Live queries and policies stay in the tool whose blast radius they
  are.
- PHYSICAL AND VIRTUAL HOSTS ARE TWO PAGES, not one list with a
  filter, for the reason VM instances and container instances are two:
  they LIST differently. A physical machine is identified by its serial
  — every one here reports a real one — and has no instance to open; a
  guest is identified by the VM it is, which its hostname will not tell
  you (a guest called `debian` is the WireGuard VM, `ci-agent-lnx-01`
  is woodpecker-runner-1). One table holding both spends half its
  columns on dashes. The databases rule — engines share a nav item, the
  engine is a column — does not govern, because engines answer the same
  questions with the same actions and these do not. Instances with no
  agent belong to the VIRTUAL page: they're guests, and on the physical
  one they'd be noise.
- WHICH KIND A MACHINE IS, IS DERIVED, never stored (`inventory.IsVirtual`,
  on the boundary rather than in a driver, because the strings are the
  HYPERVISOR's — osquery reports "QEMU" because QEMU wrote it into
  SMBIOS, so a second provider reading the same machine must reach the
  same answer). Vendor alone is not enough: Microsoft, Apple and Oracle
  all ship metal AND hypervisors, so the MODEL is checked first —
  "Microsoft Corporation" is a Surface or Hyper-V depending on whether
  the model says "Virtual Machine". And a guest THIS CONSOLE RUNS is
  virtual whatever SMBIOS claims: the correlation is not a judgement
  call, and it keeps such a guest off the physical list rather than in
  a bucket nobody searches.
- A DMI PLACEHOLDER IS NOT A SERIAL. Both MSI boards here report "To be
  filled by O.E.M.", alongside "Default string" and "System Serial
  Number" from other vendors — fields left blank in a way that looks
  like data. The column exists to identify one specific machine, and a
  string six of them share identifies none, so those render as "not
  set" like an empty one. Same rule as a VM's unset SMBIOS serial, and
  `src/serial.ts` holds it because four pages show a serial and each
  would otherwise decide for itself.
- THE JOIN IS THE SMBIOS UUID, which is the whole reason it was
  pulled. The hypervisor knows a guest's UUID and the agent inside
  reports the same value, so `/instances/{name}/inventory` looks the
  machine up by identity rather than by hostname, which two systems
  can disagree about. The answer distinguishes THREE states instead of
  collapsing them: no service connected, a service that has never seen
  this machine, and a machine it knows — the middle one is an
  unenrolled guest, a finding rather than an empty table. Packages and
  CVEs render under the guest agent's own OS report, read on demand,
  never polled: it is someone else's database and only changes when
  their agent checks in, which is why every panel states when it was
  last collected. Severity is derived from the CVSS score (NVD bands)
  because Fleet reports the number and leaves the naming to whoever
  displays it, worst is sorted first, and "no fix published" is
  spelled out — the difference between patch this and wait.
- A HOST'S OWN VULNERABILITIES INCLUDE ITS OS'S. Fleet keeps those
  apart — the host endpoint returns only software, and OS flaws hang
  off `/os_versions` — so a machine's page listed every flaw in its
  packages and none in its operating system. On Linux that went
  unnoticed, because the kernel IS a package and carries them anyway;
  on macOS and Windows nothing stands in for the OS and they were
  simply absent. A MacBook four minor versions behind showed one
  vulnerability on its page while the estate list counted 403 for it,
  two of them in CISA's exploited catalogue. The page was not
  disagreeing with the list; it had never been shown that half.
  The table is fetched WHOLE and cached, because a host reports its OS
  as a bare string with no id — the only route from a machine to its OS
  vulnerabilities is to hold the table and look the name up. Merging
  DEDUPES BY CVE and lets the software row win: it names a package you
  can upgrade, where the OS row can only say update the system.
- A HOST'S NAME IS THE ONE SOMEBODY CHOSE, not the one the machine
  answers to. Fleet publishes `display_name` — the computer name where
  one is set, the hostname otherwise — and it is what Fleet's own UI
  shows. The driver preferred `hostname` and kept `computer_name` only
  as a fallback, which is backwards, and differs on 15 of this lab's 21
  hosts: `mac.localdomain` is "Diane's MacBook Air", `debian` is
  "wireguard", `waldorf.local` is "Waldorf". The first of those is
  unidentifiable as a hostname, and it is the same mistake as matching
  guests by hostname instead of UUID — trusting what a machine calls
  itself over what a person deliberately named it. BOTH ARE CARRIED
  now: `Name` for lists and titles, `Hostname` for the detail page,
  because a display name is for finding a machine and an FQDN is for
  reaching it.
- FLEET'S UUID CASE IS THE GUEST'S, and its lookup is case-sensitive.
  Fleet stores whatever osquery reported — uppercase from WMI on
  Windows and IOKit on macOS, lowercase from
  /sys/class/dmi/id/product_uuid on Linux — while the hypervisor
  reports lowercase for all of them. So `/hosts/identifier/<uuid>`
  matched every Linux guest and 404'd on every Windows and macOS one,
  and a 404 there is indistinguishable from "no such host": the
  instance page said "this guest isn't enrolled in your inventory
  service" about a machine Fleet was actively reporting on, while the
  Devices page showed the very same machine as managed here, because
  that side compares in Go with both sides lowercased. Two pages, one
  UUID, opposite answers. `HostByUUID` now tries both cases — one extra
  request on a miss, none on a hit. Normalising to one case would only
  move the bug to the other platform, since neither case is canonical;
  the DRIVER lowercases on read, which is why displays agreed while the
  lookup didn't.
- ENRICHMENT IS A BACKGROUND PASS, NOT A PAGE VIEW. Fetching NVD when
  somebody opens a CVE only helps that CVE: a list can't sort by
  severity and the overview can't count what's critical if the score
  arrives on click. So `internal/api/enricher.go` walks every CVE the
  inventory service reports and caches it in `cve_cache`, and the rate
  limit IS the design — 750ms between requests with an NVD API key,
  7 seconds without, which is the difference between an hour and most
  of a day for five thousand CVEs. It starts 30s after boot, rediscovers
  every 30 minutes, re-reads a CVE after 30 days, and records the ones
  NVD doesn't publish so they aren't asked for again. A restart resumes,
  because the answers are rows.
- ONE CONSOLE DOES THE BACKFILL. NVD meters per API key, and per
  ADDRESS for anonymous callers, so a dev console and a production one
  enriching the same estate throttle each other — and dropping the key
  to stop it is the wrong lever, since that also slows the on-demand
  lookups every page makes. `nvd.enrichment` is a per-console switch
  (default on): leave it on where the data should be collected, off
  everywhere else. A rate limit is FEEDBACK, not a statistic: 429 backs
  the worker off for a minute rather than counting a failure and
  carrying on, the pace is re-read every iteration so a key change
  takes effect immediately, and ten consecutive failures end the pass
  instead of firing five thousand more requests at a public service.
- BLANK KEEPS, REMOVE DELETES. The key field is write-only, so it is
  always empty when the page loads — which made "Save" with an
  untouched form silently delete a working key. Blank now means "keep
  what's stored", the same rule the provider forms already followed,
  and removal is a separate button that says so.
- THE NVD KEY IS A STORED SETTING, NOT CONFIG, for the same reason
  every other credential here is: it belongs to an outside service and
  should be changeable without a redeploy. `app_settings` holds it, the
  UI writes it and never shows it back, and the client re-reads it at
  request time so a change takes effect on the next fetch.
- THE CACHE IS READ FIRST, EVERYWHERE. A CVE page prefers the cached
  record to a live fetch, and the estate list joins cached scores onto
  Fleet's summaries — but only where Fleet HAS no score of its own,
  since a paid tier knows things NVD doesn't, like whether a flaw is
  being exploited. That join is what makes Severity reappear in a list
  whose columns only render when the data exists.
- A CVE IS ENRICHED FROM NVD, which is a PUBLIC REFERENCE rather than
  a tool in the lab — no account, no credential, nothing to configure,
  so `internal/nvd` is a client and a cache rather than another
  provider. It exists because an inventory service answers "who has
  this" and NVD answers "what is it, how bad, and where's the patch",
  and the free tier of Fleet carries no CVSS at all — every severity
  would otherwise read MINIMAL because the score is absent, not low.
  Two rules follow from it being on the internet: answers are CACHED
  (12 hours, and 15 minutes for a miss, because NVD rate-limits
  anonymous callers to a handful a minute), and a failure is NEVER
  fatal — the page loses its description, not its host list, and says
  which happened. NVD and the inventory service are asked CONCURRENTLY;
  neither should wait for the other. Scores are shown WITH THEIR
  SOURCE, since NVD's own analysis and the vendor's routinely disagree
  (CVE-2025-12781 is 5.3 to NVD and 6.3 to python.org), and a number
  with no provenance is a number to argue about.
- THE SECURITY OVERVIEW LEADS WITH AN INTERSECTION, not a list and not
  a score: vulnerabilities CISA says are being exploited RIGHT NOW that
  are also present on machines here. Either half alone is noise — the
  catalogue is 1,670 CVEs almost none of which you run, the estate is
  4,004 almost none of which anyone is exploiting — and the overlap is
  three, which is a list somebody finishes on a Tuesday. It computes
  from what the console already holds (the estate list, the catalogue,
  the CVE cache) and adds no integration, the same rule the Cloud
  Overview follows. There is deliberately NO SCORE OR GRADE: a number
  that improves when you disconnect a backend measures the console
  rather than the lab. And an unreadable catalogue is SAID, never
  rendered as an empty list — "nothing is being exploited" is the one
  wrong answer this page must never give by accident.
- WHAT A CVE *IS* COMES FROM TWO PUBLIC REFERENCES, and neither is the
  inventory service. A list of four thousand identifiers is unreadable,
  and Fleet carries no description at all — so the estate list joins
  NVD's, which the enricher has already cached. That join cost nothing
  to add: the query behind it (`CVEScores`) always returned the whole
  record and used only the score. The column replaced "Detected", which
  was true of every row and the reason nobody opened the page.
- NO SCORE IS NOT A LOW SCORE. `severity(0)` returned "MINIMAL", with a
  comment noting that 0.0 is what Fleet sends when it has no score at
  all — so the least alarming word in the vocabulary was printed over
  every CVE nobody had assessed. It stayed invisible while Severity sat
  in a far column, and showed its teeth the moment it moved next to the
  CVE: the three flaws CISA lists as ACTIVELY EXPLOITED sat at the top
  of the page labelled MINIMAL 0.0. Unscored now says "Not scored" and
  sorts after everything real rather than below LOW. A genuine CVSS 0.0
  (NONE) exists and is indistinguishable from absent here, which is a
  trade worth making: of the two possible mistakes, only one tells you
  something dangerous is harmless. `src/severity.ts` holds the bands,
  colours and this rule, because two tables render it and were free to
  disagree.
- WHETHER ANYONE IS ACTUALLY EXPLOITING IT COMES FROM CISA, not from
  Fleet's `cisa_known_exploit` — that field is gated behind a paid tier
  and arrives EMPTY, so a column wired to it would read "not exploited"
  for every CVE in the estate, which is the most confident kind of wrong
  answer on the one question where a false negative matters.
  `internal/kev` fetches the catalogue itself: a public file, no
  credential, cached 12 hours, and never fatal — a failure keeps the
  last copy, because a day-old answer about live exploitation beats
  none. It is one request for the whole catalogue, where NVD's
  equivalent field arrives one CVE at a time as the enricher walks, so
  the badge is complete the moment it lands instead of filling in.
  Expect it to be RARE and that is the point: 3 of this lab's 4004.
  CISA's `vulnerabilityName` is shown where it exists, because "Apache
  Log4j2 Remote Code Execution Vulnerability" says more in six words
  than any description does in sixty.
- SHORTCUTS ARE WHERE THE PANE OF GLASS ADMITS ITS EDGES. Every other
  section is a view onto a tool's API; this one is a grid of links to
  the things there is no API to view — a NAS's own UI, a SaaS account
  with no integration yet, the vendor portal you need twice a year.
  Without somewhere to put them they live in a bookmarks bar this
  console can't see.
  It sits with the OVERVIEW rather than among the sections that
  describe the lab, in the global menu's top block above Favorites
  (`topSectionIds` in Shell): what's wrong, then where you were going,
  then the lab. Neither of those two carries a star — pinning something
  already at the top would pin a thing you can't unpin — and both are
  kept out of the list below, so the menu never names either twice.
  A LOGO ARRIVES WITH ITS OWN MARGIN, so the tile's padding was being
  paid twice — a wordmark is mostly whitespace at its edges. The mark
  gets that space back rather than the border, and the MONOGRAM
  fallback is inset to match: a tint block filling the whole slot reads
  as the biggest thing in the grid beside logos that don't.
  A TILE IS AN ICON AND A NAME, in a rectangle the size of a button.
  It carried a description and the link's host underneath, which is two
  lines of furniture on something you recognise by its logo; the
  description is gone from the form and the column with it. The open
  arrow and the actions menu SHARE ONE SLOT at the right, swapped on
  hover, so reaching the menu doesn't shift the name.
  PERSONAL, and self-service for that reason — a viewer arranges their
  own tiles as freely as an owner does, the RBAC middleware exempts the
  whole subtree, and EVERY store call takes the account as well as the
  id, so somebody else's shortcut is indistinguishable from one that
  doesn't exist. That is the entire access model, which is why there is
  deliberately no lookup by id alone.
  THE ICON IS A FILE beside the database, named after the shortcut's own
  id — the same reasons the installers are files, plus one: nothing is
  fetched from the site a tile points at. Reading a favicon would mean
  this console making requests to wherever a user typed, which is a
  different thing from the backends it is configured to talk to, so a
  tile with no icon draws a monogram tinted by a hash of its name. The
  URL scheme is an ALLOWLIST (http, https, and the desktop handlers this
  app already emits) because the value ends up in an href and
  `javascript:` is a link as far as the browser is concerned. An SVG is
  served under `default-src 'none'; sandbox`, since it is a document
  that could carry script and its URL is a URL somebody can open.
  REORDERING WRITES THE WHOLE ARRANGEMENT in one transaction: dragging
  one tile changes the index of every tile it passed, so a partial write
  is how two rows end up claiming the same slot.
- INSTALLERS ARE THE ONE THING THIS CONSOLE OWNS. Everywhere else it
  is a view onto somebody else's source of truth; agent packages are
  files it holds, because Fleet builds installers without hosting them
  and a machine being enrolled has no session to download with. They
  are FILES IN A DIRECTORY beside the database (`<dataDir>/installers`)
  for the same reasons the database is one — backup is `cp`, the
  listing is a directory read, and there is no second registry to drift
  from what's on disk. Uploads stream to a temp file and rename, so an
  interrupted one can't leave something truncated that looks
  installable.
- THE COMMAND IS SHOWN BEFORE IT IS COPIED. A row of per-shell copy
  buttons put a command on the clipboard sight unseen, with the text
  itself only ever visible in a tooltip — and the machine you are in
  the middle of setting up is the wrong place to be pasting something
  you never read. It is now one panel below the list: pick the
  installer, pick the shell where there is a choice, read the command,
  copy it. The picks are held as NAMES and resolved every render, so an
  unknown one falls through to the first rather than blanking the
  panel — which is what a re-upload or a delete would otherwise do to
  a selection made before it.
- THE DOWNLOAD IS THE ONE ROUTE OUTSIDE THE SESSION, and it carries its
  own key: `/api/v1/installers/{name}/download?token=`. A fleetd
  package contains the enrollment secret, so an open link would let
  anyone who can reach this console enrol a host — but a session cookie
  is exactly what a bare machine hasn't got.
  WHO MAY READ THE TOKEN IS GATED ON THE VIEWER, NOT THE OWNER.
  Enrolling a machine is ordinary editor work — using a connected
  backend, the same as minting an object store's access key — so the
  listing hands the token to an editor and an owner and withholds it
  from a viewer. It was owner-only for a while by accident rather than
  by argument: the reasoning written beside the check was all about
  viewers while the check said owner, so an editor could UPLOAD an
  installer and DELETE one but not fetch either. ROTATING it stays
  owner-only, since that is credential management and it breaks every
  machine holding the old URL. The file listing itself is open to
  everyone — what packages exist is lab state.
  The token lives in
  `app_settings` (a key/value table so a new setting needs no
  migration), is minted on first use like the SSH key, is accepted as a
  query parameter OR a bearer header (curl and wget take either,
  PowerShell prefers the plain URL), and is rotatable from the page. A
  bad token gets 404 rather than 403, so a stranger learns nothing
  about which files exist. The copy-paste commands are built from
  `siteOrigin`, the SERVER's idea of its address — behind a tunnel the
  browser's is wrong and only the server's is reachable.
- SECURITY IS ITS OWN SECTION, and it takes Google's name: Security
  Command Center. Every other section here is named for what it holds
  and this one for what it is, which is the phrase anyone who has used
  a cloud console already recognises. It sits second, above Compute:
  the Cloud Overview answers "is anything broken", this answers "is
  anything exposed".
- VULNERABILITIES LIVE UNDER SECURITY, NOT DEVICES, because nobody
  looking for a CVE thinks to check a page about laptops. The line is
  AGENT VS MEANING: the inventory service, the machines it reports on
  and its credential stay in Devices, since that is what they are;
  what its findings mean — the CVE list, and the NVD key and
  enrichment pace behind their scores — is a security question and
  lives here. The moved pages were renamed to match, because a
  component called Devices* under /security is the drift that put a
  stale `/servers` in `ownerOnly`. The cross-section links stay and are
  correct: a CVE names the host that carries it, over in Devices.
- DEVICES IS ITS OWN SECTION, NOT A COMPUTE PAGE. Compute means
  machines this console RUNS; an inventory service holds laptops and
  bare metal too, and filing a MacBook under Compute would make the
  word mean nothing. There's no GCP analogue because GCP has none —
  the nearest is Azure Arc, which exists for exactly this. The section
  earns its place on the CORRELATION: `/inventory/hosts` stamps every
  host with the instance reporting the same UUID, and returns the
  instances no host reports. That's drift in both directions — an
  agent still reporting for a VM somebody deleted, and a guest with no
  agent — and neither tool can see either alone. A host that ISN'T
  managed here reads "External", because a laptop is supposed to be in
  Fleet and isn't supposed to be a VM. The Fleet credential lives in
  this section's Settings, the same rule as DNS providers under DNS.
  The estate-wide CVE roll-up is Fleet Premium and older versions
  don't serve it at all, so `ErrUnsupported` is a distinct answer from
  an error: a missing feature reads as one, and the per-instance list
  keeps working because it comes from host detail.
- DOCKER IS THE ELEVENTH SPLIT, and the first where the TRANSPORT IS A
  FIELD rather than a driver. `internal/docker.Provider` is the
  boundary and there is exactly one implementation, `engine`, because
  the socket is root on the host and every safe way to reach it —
  capstan (a bearer-token proxy), a plain docker-socket-proxy on a
  private network, Docker's own TLS listener — speaks the SAME Engine
  API. So a record is a URL, an optional token and an optional pinned
  certificate, and the factory has one branch.
  WHETHER A HOST TAKES WRITES IS DISCOVERED, NOT CONFIGURED. Everywhere
  else an optional power is a type assertion, because the DRIVER either
  has it or doesn't; here the same driver is accepted on one host and
  refused on another depending on how each front door was started. So
  the far end is asked — with the gentlest write there is, unpausing a
  container id that cannot exist — and `ErrWriteDisabled` is a
  different answer from a failure. `ErrForbidden` is a third: an
  endpoint no setting will ever enable, so the UI must not offer to
  turn it on.
  COMPOSE LABELS ARE THE ONLY RECORD OF A STACK. The daemon has no idea
  six containers are two projects; `com.docker.compose.project` and
  `.service` are, so they carry through as Stack and Service. Health is
  parsed out of Docker's status PROSE ("Up 2 weeks (healthy)") because
  the list endpoint carries no field for it, and is EMPTY rather than
  red where a container declares no healthcheck — not being asked is
  not the same as failing.
  WHAT EARNS THE SECTION is the join: a Docker host is a guest this
  console already knows, matched on the hostname the daemon reports, so
  a container list can say which VM it runs inside. Weaker than the
  SMBIOS UUID that joins instances to inventory hosts, and said so.
- CERTIFICATE PINNING IS THE ANSWER TO `insecureTLS`, and
  `internal/tlspin` is where it lives. Every backend record here
  carries that flag and in this lab most have it set — BOTH Proxmox
  hypervisors do — which means anything on the LAN can stand between
  the console and a hypervisor and collect a root token. A pin closes
  that without a CA: read the fingerprint off the host once, store it,
  and a substituted certificate fails the handshake.
  THE CERTIFICATE, NOT THE PUBLIC KEY. Pinning the key would survive a
  renewal that reuses it, which sounds better and mostly isn't — a
  self-hosted certificate is a ten-year self-signed one nobody will
  renew, and the tools that do renew (Proxmox ACME, pvecm updatecerts)
  make a fresh key anyway. "The certificate changed" is the event worth
  hearing about regardless.
  `InsecureSkipVerify` IS SET ON PURPOSE and is not the hole it looks
  like: it switches off the CHAIN check, which a self-signed cert could
  never pass, and `VerifyPeerCertificate` then does a stricter job.
  Hostname and expiry go with it deliberately — a pinned certificate is
  identified by BEING that certificate.
  A MISMATCH IS ITS OWN STATUS, never "unreachable". A host presenting
  the wrong certificate and a host that is switched off are the same
  red dot in a console with two states, and exactly one of them means
  somebody is in the middle.
  READING THE FINGERPRINT OVER THE NETWORK IS THE UNSAFE MOMENT and the
  form says so: it is trust-on-first-use, only as good as the path
  being clean right now, which is the assumption pinning exists to
  remove. It is offered because a pin nobody can obtain is a pin nobody
  sets — beside the command that prints the real one, with the
  comparison left to the operator.
- THE AI GATEWAY is the same split an eighth time:
  `internal/ai.Provider` is the boundary (Bifrost first), gateways are
  DB records, one live provider per record in `ai.Registry`, and a
  factory maps type → implementation. It exists because a lab holding
  an OpenAI key, an Anthropic key and an Ollama box can ask each one
  what it served and get three answers sharing no vocabulary and no
  clock; the gateway in front of them saw the lot.
  IT WRITES, AND THE READ-ONLY RULE THAT USED TO SIT HERE WAS WRONG.
  This console is not an observability tool; unifying services means
  changing them, and the thesis at the top already said so — "don't
  reimplement" is about the SOURCE OF TRUTH, not about what may appear
  on screen. A console you have to leave to issue a key is a console
  you have left. Virtual keys, budgets and providers are create, edit
  and delete here, and the line stays where every other section draws
  it: the daily 90%, with a gateway's network timeouts, concurrency
  pools and routing rules left in Bifrost.
  WRITES ARE THREE OPTIONAL CAPABILITIES — VirtualKeyManager,
  LimitManager, ProviderManager — by type assertion like BackupDriver,
  one per resource so a driver can offer some and not others.
  `/ai/capabilities` is what the UI asks before it renders a button, so
  a missing capability is an ABSENT button rather than one that fails.
  A NEW VIRTUAL KEY'S SECRET IS SHOWN ONCE and nowhere else. The rule
  below still holds — the list endpoint's plaintext value is dropped —
  but on create there is no other way to hand it to whoever asked, so
  the create response carries it, the page says it is the only time,
  and nothing stores it. The object store's access keys, again.
  A PROVIDER HAS NO EDIT FORM, deliberately: Bifrost's provider record
  is a name plus tuning knobs, and everything an ordinary user changes
  about a provider IS one of its KEYS, which are a separate endpoint
  (PUT /api/providers/{name} refuses a body carrying `keys` at all).
  CREATE ROLLS BACK, because Bifrost accepts a provider record for a
  vendor it cannot serve and only refuses at the key — "unsupported
  provider: …" — leaving an inert half-provider behind. Unlike the
  object store, where a key with no policy is still a key you can fix,
  a provider with no key reaches nothing, so the record is removed and
  the error is the gateway's own sentence. The vendor list is a
  constant in the DRIVER because no endpoint serves it: a suggestion
  for the picker, never a gate, so a vendor Bifrost gains later still
  works if you type it.
  ROLES SPLIT THIS SECTION. Issuing a virtual key and capping its spend
  are USING a connected backend — an editor's, the same as minting an
  object store's access key. Connecting an upstream provider stores a
  vendor API key, which is a standing grant of spend and an owner's,
  even though it lands in Bifrost's database rather than ours.
  The TOKEN IS OPTIONAL, alone among the backends: Bifrost ships with
  its management API open, so demanding a credential would make the
  common deployment the unsupported one. When auth IS on, a virtual
  key will not do — `sk-bf-*` signs inference, not `/api` — and the
  driver names that rather than reporting a bare 401.
- FOUR THINGS ABOUT BIFROST CAME FROM READING A REAL GATEWAY, and each
  was a wrong answer waiting to render. The stats block embedded in the
  log response is ALL ZEROES beside 473,000 requests, so stats come
  from `/api/logs/stats` instead — a 0% success rate stated confidently
  over a working gateway is the exact inverse of the serial rule.
  Providers come from `/api/providers`, NOT from splitting model names
  on a slash: that reading invented "qwen" from a model family and
  missed "ollama" entirely, because a local model is "qwen2.5:7b" with
  no vendor in front. Latency, token counts and COST are all OMITTED
  rather than zeroed, so they are pointers — a failed request has no
  latency and 0 ms reads as instant, and a call to a local model has no
  cost because there was nothing to price. One row in forty on this lab
  carries a cost at all, which is why that column renders only when a
  page holds one rather than standing empty over free traffic.
- THE REQUEST LOG IS PAGED BY THE GATEWAY, not the browser. Every
  other table here pulls its rows and sorts them client-side, which is
  right for tens of instances and thousands of CVEs and wrong for a log
  at 473,000 and growing while you read it. `DataTable`'s `server` prop
  hands paging and sorting back to whoever holds the data; a new sort
  resets to the first page, because page 4 of the old order is not a
  place. WHY A CALL FAILED is a drill-in and not a column, because the
  gateway carries the reason only on its single-log endpoint —
  filling a column would be fifty calls to answer a question about one
  row. Bifrost sets `is_bifrost_error` FALSE on its own governance
  refusals, so that flag is trusted in one direction only: true means
  the gateway refused it, false claims nothing.
- WHAT WAS ASKED AND WHAT CAME BACK ARE NEVER CARRIED. Prompts,
  completions and raw bodies sit on the same responses this reads, and
  the structs that decode them have no fields for any of it — a field
  that doesn't exist cannot leak onward. Same for a VIRTUAL KEY'S
  SECRET, which Bifrost returns in plaintext on its list endpoint:
  rendering it would turn every open browser tab into a way to spend
  money. Upstream provider keys arrive already masked and are shown
  that way — a key is listed so it can be recognised, not copied. The
  rule is the WiFi passphrases Network never reads.
- WHAT A KEY HAS DONE IS THE JOIN NOTHING ELSE MAKES. The gateway
  lists the keys it issued and the log lists the callers it saw, and no
  endpoint puts the two together — so the virtual keys page asks for
  each key's requests, success rate, spend and last use itself, two
  calls apiece, concurrent and best-effort. It answers the two
  questions the key list alone can't: which service is costing money,
  and which credential is issued to something that never calls.
  NEVER USED IS A FINDING, not a blank, and the gateway says it with a
  zero timestamp that parses to year 1 — left alone it renders as
  1/1/1, so it is checked for and written out. A success rate over no
  requests is likewise "—" rather than 0%.
  COST HERE IS AN ESTIMATE AND THE PAGE SAYS SO, with a link to the
  price registry it comes from (getbifrost.ai/datasheet — per-token
  costs, published for estimation rather than billing reconciliation).
  A router like OpenRouter picks an upstream per request on
  availability and other factors, so the real charge differs either
  way. The registry is LINKED, NOT COPIED: holding a second price list
  here would be a registry nobody updates, and the gateway has already
  applied this one. It answers "which caller is expensive",
  never "what you owe" — which is also why the balance at the provider
  (below) is a different question worth asking separately.
- THE MODEL PRICES PAGE IS NOT THAT COPY. It reads the gateway's OWN
  RESOLVED CATALOG (`/api/models/details`) — the thing that actually
  produced every cost figure on the Requests and Virtual keys pages —
  rather than the registry behind it. Same rule as everywhere else: ask
  the tool that owns the answer, and this console still keeps no prices.
  PER MILLION TOKENS IS THE WHOLE POINT OF THE PAGE. The gateway holds
  and multiplies by a per-token figure, and $0.000003 is not a number
  anybody can compare — so the conversion happens at render and the
  value crossing the driver boundary stays the gateway's. Precision
  follows size, because a fixed two decimals rounds half the catalog to
  $0.00.
  TWO KINDS OF MISSING PRICE, and they read differently. On input and
  output an absent price IS THE FINDING — that model's traffic can't be
  costed, which is why one request in forty carries a cost — so it says
  "not priced". On the cache columns an absence is ordinary (most
  models have no prompt caching) and gets a dash, or four columns of
  "not priced" bury the two where it means something.
  A NEGATIVE COST IS A SENTINEL. OpenRouter's `auto` models carry -1,
  because what they cost isn't knowable until the router has chosen;
  rendered literally that is -$1,000,000.00 per million and sorts as
  the cheapest thing in the catalog. Anything below zero reads as no
  price — the free-model lie wearing a minus sign.
  THE CATALOG IS PAGED, NOT ASKED FOR IN ONE BIG GULP. Bifrost serves
  20 at a time and reports the total; asking for a number bigger than
  any plausible catalog works until somebody connects a provider with
  ten thousand models, and a price list missing its tail looks exactly
  like a complete one.
- WHAT'S LEFT AT A PROVIDER IS A SEPARATE SPLIT, the ninth:
  `internal/aiaccount.Provider`, because a gateway account and a
  provider account are different things holding different credentials.
  The gateway knows what it sent; only the provider knows what remains,
  and that answer otherwise costs one login per provider.
  PROVIDERS DO NOT ANSWER THE SAME QUESTION and this refuses to pretend
  otherwise. Of ten a lab might use, four report a real remaining
  figure in four different units (OpenRouter dollars, DeepSeek a
  currency it names, xAI cents, ElevenLabs characters), three report
  only SPEND, and Anthropic reports nothing at all to an individual
  account. So a Balance names its own Kind and Unit and the UI shows
  what each provider said — "no balance API" and "unreadable" as those
  words, never as a dash. OpenRouter needs a MANAGEMENT key, and its
  `/api/v1/key` endpoint is deliberately unused: `limit_remaining` is
  that key's own cap and is null on an uncapped key, so a balance wired
  to it would read "unlimited" on an account that is nearly empty.
  xAI is absent because its endpoint wants a different host, a
  management key and a team id the record has nowhere to keep — a
  column and a form field, not a driver.
- A LOW BALANCE IS A FRONT-PAGE PROBLEM, and its threshold is PER UNIT
  with no default: five is nearly empty in dollars and nothing at all
  in characters, and one number applied to both would either shout
  about a healthy account or stay silent about a spent one. An
  unrecognised unit warns about nothing rather than borrowing a
  comparison that doesn't hold. It is one of the few tested things
  here, because a warning that never fires looks exactly like one that
  can't.
- THE AI OVERVIEW IS A DAY, NOT ALL TIME. An all-time success rate
  keeps reporting an outage long after it is fixed — this lab's read
  51% for months because of one migration that broke Ollama for a day.
  A front page owes you the state of the thing now. That is not a
  promise the number looks good: while the outage is inside the window
  the page reports it in red, which is the point. Failures are their
  own series rather than a dip in one line, and cancelled requests
  count as failed, or the two series stop adding up to the total. The
  same dashboard response carries token, cost, latency and throughput
  buckets and every one comes back empty — they are not drawn, because
  five blank panels beside one real chart says the gateway is broken.
- MONITORING is the same split a tenth time:
  `internal/monitoring.Provider` is the boundary (Zabbix first),
  services are DB records with a write-only token, one live provider
  per record in `monitoring.Registry`, and a factory maps type →
  implementation. READ ONLY like Devices: this shows what the service
  concluded — Problems, and the hosts it watches — while triggers,
  templates and dashboards stay in Zabbix where their blast radius is.
  The token should come from a read-only user whose ROLE ALLOW-LISTS
  exactly host.get, problem.get and event.get, which is why the host
  behind each problem is fetched via `event.get selectHosts` rather
  than the textbook trigger.get — the same answer without demanding a
  fourth method. Severity is Zabbix's own vocabulary (Disaster, High,
  Average…), carried as words with a rank beside them for sorting;
  suppressed problems are SHOWN, muted, because a maintenance window
  is somebody's plan and hiding it means re-alerting when it ends.
  TWO API TRAPS, both verified live: every value is a STRING
  ("severity":"2", "clock":"1787353326"), so the driver decodes
  strings and parses; and the endpoint prefix varies — this lab serves
  api_jsonrpc.php under /zabbix/, other installs at the root — so the
  prefix is DISCOVERED per the UniFi rule, with the caveat that an
  RPC-level error means the endpoint IS the API and must not trigger
  the next candidate. Zabbix's host status is also backwards from
  every other API here: 0 is monitored, 1 is disabled.
  THE JOIN IS INTERFACE IP, not hostname and not UUID — a monitoring
  agent doesn't report SMBIOS, and the address is what both sides hold
  fresh. Weaker than the Devices join and said so on the page. Only
  RUNNING guests count as unmonitored (a stopped VM having no
  monitoring is the expected state), and the Zabbix server registers
  ITSELF at 127.0.0.1, so its own VM always reads unmonitored — a
  quirk worth knowing before chasing it.
  SEVERITY WEARS ZABBIX'S OWN COLOURS, which is the same decision as
  carrying its words: somebody who knows what Average looks like there
  should not have to read the label here. It is the one place this
  console leaves its own palette, so the six values are written down
  rather than approximated from the theme, and they tint a label at the
  house radius with no border — the chip rule, not a pill and not a
  filled cell. Keyed on the WORD, never the rank: rank is only "higher
  is worse" and says nothing about how many steps a service uses, so a
  provider with four levels would land on the wrong colour. An
  unrecognised word gets no tint, the way a vendor with no logo gets no
  mark.
  THE FRONT DOOR GETS ONE LINE — "zabbix reports N problems at High or
  worse", unsuppressed only — never the individual problems: the
  overview derives findings from what the console itself observes, and
  importing another system's judgment wholesale would duplicate half
  of them. The Problems page holds the list.
- OBJECT STORAGE is the same split a seventh time:
  `internal/storage.Provider` is the boundary (RustFS first), stores are
  DB records with a write-only secret key, one live provider per record
  in `storage.Registry`, and a factory maps type → implementation.
  Bucket and access-key listings span every store and stamp each row
  with its `providerId`, the way catalog listings span hypervisors. The
  split INSIDE the driver is between the S3 API, which every one of
  these speaks, and the ADMIN API, which each spells differently:
  buckets and objects come from the first, capacity, per-bucket usage,
  quotas and IAM from the second. A store with no admin API leaves
  `Info` zero and still works.
- THE ADMIN PREFIX IS PART OF THE API, not a spelling of it. RustFS
  serves its admin API under BOTH `/minio/admin/v3` and
  `/rustfs/admin/v3`, and they behave differently: under MinIO's prefix
  the IAM endpoints honour MinIO's ENCRYPTED PAYLOAD ENVELOPE —
  add-user answers "failed to decrypt MinIO admin payload" to plain
  JSON, list-users returns ciphertext — and under its own prefix every
  one of them is plaintext. That cost a wrong conclusion recorded in
  the code for a while ("users need sio/DARE implemented first"), when
  what they needed was the other door. The driver now speaks one prefix
  for everything, including the calls that worked either way.
- USAGE FIGURES COME FROM THE STORE'S SCANNER AND LAG. A bucket written
  to a moment ago still reports zero objects, so `Bucket.Scanned` says
  whether the numbers mean anything yet and the UI shows "—" rather
  than a confident 0 — the same rule as the SMBIOS serial. Quotas are
  one call per bucket, concurrent, best-effort: the deliberate
  exception to "one cheap call", for a list that isn't polled at list
  speed and would otherwise carry a column it could never fill.
- NO QUOTA AT BIRTH. RustFS enforces a quota by consulting that same
  scanner, and until it has run on a new bucket every write is refused
  with "Bucket quota check temporarily unavailable" — so a quota
  applied at creation hands back a bucket nothing can write to. Setting
  one is a separate action on a bucket that already exists.
- ACCESS KEYS ARE CREDENTIALS ON THE STORE, and the UI says access key
  where the store's API says user (`storage.UserProvider`, an optional
  capability like QuotaProvider). Nothing signs in as one — it's what a
  backup job holds — and this console already has three other things
  called users: accounts, the identity directory, and database users.
  Same CONTAINER-not-CT rule: the backend keeps the tool's word, the UI
  picks the clearer one.
- THE SECRET IS GENERATED IN THE BROWSER AND NEVER STORED. It exists in
  one place on its way to the store and is unreadable afterwards, which
  is the same write-only rule the account SSH key follows. A form that
  asks somebody to invent forty random characters gets `password123`,
  so the console offers a strong one and says out loud that this is the
  only moment it's readable.
- A POLICY IS THE STORE'S OWN NAMED DOCUMENT, not a level. The database
  section collapses permissions to read / read-write / full because two
  engines spell the same three intentions differently and the console
  had to choose words. Here the store PUBLISHES its list, including
  ones that don't map onto those three at all (`diagnostics`,
  `consoleAdmin`), so the names travel as they are and a mapping would
  hide half of them. What is derived is a WARNING, from the actions
  rather than the name: the stock `readonly` grants GetObject and NOT
  ListBucket, so a key carrying it can fetch a name it already knows
  and can't browse — which reads as a broken credential from the other
  end. Deriving it from the document means a store shipping a different
  readonly, or a hand-written policy with the same gap, is described
  correctly.
- A BUCKET POLICY IS THE OTHER HALF OF ACCESS, and the half that can go
  wrong silently. A key's policy says which buckets that KEY may reach;
  a bucket policy hangs on the BUCKET and can name a principal of `*`,
  which means no credential at all — an object served to anyone who
  knows the URL, over plain HTTP. Nothing else in this console can see
  that. So the bucket's Permissions tab LEADS with it, in terms of what
  actually happens (anyone can read / list / write) rather than a
  "Public" badge, since those are very different sizes of mistake.
  Reading a policy lives in `internal/storage` rather than a driver: the
  document is S3's, not any one store's, and "is this bucket public"
  deciding differently per backend would be worse than not asking.
  Deny statements are skipped, wildcard actions are matched (`s3:*` is
  the most public a bucket gets and must not read as "no match"), and a
  document that won't parse reports NOT public — the tab shows the
  document beside the verdict, so an unreadable policy is visible as
  one, where crying wolf about it would be a warning that never clears.
- WHO CAN REACH THIS BUCKET IS A CORRELATION, NOT AN ENDPOINT. No S3
  API answers it: you would have to read every access key's attached
  policy and match resource ARNs yourself, which is exactly the
  connective work this app exists for. `MatchesBucket` handles the
  wildcards, and stops at the bucket segment — `arn:aws:s3:::lab-*`
  matches, `arn:aws:s3:::lab-backups-archive` does not match
  `lab-backups`, and a KMS ARN matches nothing.
- THE CONSOLE EDITS ONLY THE ANONYMOUS HALF. Opening a folder and
  closing it are the daily 90%; composing arbitrary statements is the
  deep, rare configuration that stays in the tool that owns it. Two
  rules make that safe. Statements this console didn't write pass
  through VERBATIM as raw JSON — re-encoding them would drop any field
  these structs don't model, and dropping a `Condition` that confined a
  grant to one subnet would silently widen it. And granting REPLACES
  the previous public grant rather than accumulating, the same rule
  database grants follow, so "what is public here" stays answerable by
  looking once. Listing is granted on the BUCKET ARN, never the object
  one, where it would silently do nothing — and a prefixed grant
  confines it with an `s3:prefix` condition, or opening one folder
  would publish every key name in the bucket.
- TWO CALLS MAKE A USABLE KEY. The store accepts a policy named in the
  create body, reports success, and ignores it — so attaching one is a
  second call, the same two-step as creating an authentik account. A
  failure there leaves a real key with no permissions rather than no
  key, and the API says exactly that instead of reporting a failure
  that would send you looking for a key that exists.
- CREATE MUST NOT BE AN UPSERT IN DISGUISE. `add-user` replaces the
  secret of a key that already exists and keeps its policy, so an
  unchecked create would silently break whatever is signing with that
  name. The driver reads first and refuses; the store offers no
  conditional create, so this races in theory, and refusing what we can
  see beats not looking. The same call is how a secret is REPLACED —
  and there the current status has to be carried across explicitly,
  because add-user applies whatever status its body holds and a
  hardcoded "enabled" would turn "change the secret" into "un-revoke a
  disabled key".
- IAM & Admin (this console's own RBAC) and Identity Platform (the
  lab's identity service) are deliberately separate sections: one
  governs access to this app, the other manages a service in the lab.
- Keep store SQL portable between SQLite and Postgres: TEXT ids, RFC3339
  TEXT timestamps, no engine-specific types. Postgres is planned, not wired.
- Frontend talks only to `/api/v1` via `src/api/client.ts` (typed client);
  server state lives in TanStack Query (3s polling), not local state.
- SELECT-ALL TAKES THE PAGE; "SELECT ALL N" TAKES THE FILTER. The
  header checkbox selects the visible page and nothing else, which is
  upstream's behaviour and the right default — but the reason you
  narrowed a list was to act on what you narrowed to, and clearing 28
  archives fifteen at a time is the clicking the bulk interface was
  meant to remove. `DataTable.onFilteredChange` reports the matched ids
  across pages, and the action bar offers the rest as one button.
- A BULK DELETE SAYS WHAT IS IN IT, not just how many. On backups the
  obvious workflow — filter by a dead guest's vmid, select, delete —
  has a trap under it: A VMID IS ONLY UNIQUE WITHIN ONE HYPERVISOR, and
  this lab has 2030 in use on both, one dead and one very much alive.
  So the confirmation names the live guests caught in the selection,
  and anything keyed on an archive keys on hypervisorId AND the id —
  both hypervisors here write to a datastore called `synology`, so the
  volume ids themselves collide and a lookup on one alone would delete
  the same archive twice and leave its twin.
- SELECTING ROWS RAISES AN ACTION BAR, GCP's model: the checkbox
  column is the bulk interface, and the bar above the table carries a
  count, a clear button and the actions that apply. Each action runs
  against the ELIGIBLE SUBSET — Start against the stopped ones, Stop
  against the running ones — so a mixed selection isn't a refusal, and
  the N requests report as ONE outcome (`settle` in InstancesPage),
  because four alerts for four instances is not a report.
- A POWERED-ON INSTANCE CAN'T BE DELETED. Destroying a VM takes its
  disks with it, and doing that to something still running is a
  decision that should be made twice: stopping first is one click.
  The backend refuses it (409, naming the state) so the rule holds
  whatever calls the API; the list and the detail view disable Delete
  and say which instance is in the way. STAGING counts as powered on —
  mid-boot is the same mistake — while PROVISIONING and STOPPING are
  deliberately allowed through, since a create that died in
  PROVISIONING still has to be removable.
- FRIENDLY NAMES ARE DERIVED, NOT STORED (`src/osIdentity.ts`). A boot
  disk picker needs an OS and a release, and both are already sitting
  in the template's name — `debian-13-cloudinit`,
  `noble-server-cloudimg` — so they're read rather than kept. A stored
  display name is a second registry: it goes wrong the first time
  somebody renames a template in Proxmox, and nothing notices.
  Derivation can't go stale. The FIRST LINE OF THE DESCRIPTION
  overrides it, because that's the one thing a person wrote on
  purpose, and it's a plain label rather than a positional format —
  a comma-separated schema in a free-text field breaks the first time
  someone writes "Rocky Linux, release 9, minimal". Architecture and
  build date are never typed: `Images` reads them from each template's
  config (`arch`, and the ctime in `meta`), which is one call per
  template — the deliberate exception to "one cheap call", since this
  list isn't polled and a picker that can't say what it's picking is
  the alternative. A derived label only becomes the TITLE when it
  carries a version: "Debian GNU/Linux 13 (trixie)" says more than the
  file name, where a bare "Debian" says less — which is what an
  `os-debian` tag produces on a template named for its job, and
  renaming that to Debian would lie about what it's for. Names that
  say nothing land under Other, honestly, and the fix is on the object
  either way: write the first line, or tag it.
- A GUEST'S NOTES BELONG TO THE HYPERVISOR. Editing a description
  writes Proxmox's own field — the one its Notes panel shows — so this
  console and that one are editing the same thing rather than keeping
  two. `Driver.SetDescription` is core rather than a capability, since
  a backend that can't label a guest isn't much of a backend. The
  store's `description` is a MIRROR, updated in the same handler, and
  it exists only so a list doesn't need a Describe per row; the
  hypervisor wins on any disagreement. A VM template is a VM, so the
  same driver call serves `/images/{id}/description` — and there the
  hypervisor is the only copy, since a template has no record here.
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
- A "NONE" OPTION NEEDS `components/SelectField`, not a bare
  `<TextField select>`. MUI reads an empty string as NO SELECTION rather
  than as a value, so `<MenuItem value="">Hypervisor default</MenuItem>`
  renders an empty box with a zero-width space in it — before you touch
  the field AND after you deliberately pick that option, which is why it
  reads as two separate bugs. Eight selects had it. The unset value
  stays the empty string, because that is what the API means by "leave
  this alone"; SelectField just turns on `displayEmpty` and shrinks the
  label so the option is drawn.
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
- AN ID IS WHAT YOU LOOK A THING UP BY, NOT WHAT YOU RECOGNISE IT
  FROM. The Covers cell printed a job's whole vmid list — five wrapped
  lines of four-digit numbers on a job covering twenty-five guests,
  naming none of them and pushing every other column down the page. It
  shows the COUNT; opening the job shows the names against checkboxes,
  which is where that question has a real answer. The ids stay
  SEARCHABLE via `meta.filterText` — somebody who knows a guest is 2030
  should still find the job holding it — which is the same split the
  Backups list already makes between what a cell matches and what it
  draws.
- AN EMPTY TABLE KEEPS ITS HEADERS AND SAYS SO IN A ROW. A banner
  above an absent table makes you work out which table it was about,
  and two of them stack into a wall of yellow; a table that vanishes
  entirely makes you wonder whether it failed to load. So the headers
  stay up and the nothing is a row inside them — with a WARNING ICON
  only where the absence is a finding. On a guest, no snapshots is
  ordinary and no backups is not, so only the second one gets it. Three
  different nothings hide under that empty backups table and only one
  earns the icon: still loading is not an answer, a hypervisor with no
  backup catalog is a fact about the backend, and no backups where
  there could be some is the finding.
- BACKUPS AND SNAPSHOTS SHARE A TAB ON A GUEST, because they are the
  same question asked twice: what can I restore this to, and how old is
  the newest one. SNAPSHOTS GO FIRST — the one you took on purpose
  minutes ago, before doing something, ahead of the one that happened
  overnight without you. A tab each makes you hold one answer in your head
  while you go and read the other. Snapshots lived under Details until
  this, which is why they were hard to find at all.
  THEY STAY SEPARATE PAGES in the left nav, for the reason VM instances
  and containers are: they LIST differently. A backup archive has a
  datastore, a size and a format; a snapshot has a guest, a parent and
  whether it caught the RAM. One table holding both spends half its
  columns on dashes.
- A COLUMN THAT RESIZES AS YOU PAGE IS A COLUMN THAT MOVED. An
  auto-layout table sizes each column to the widest cell IT CAN SEE,
  which is the widest cell on the page you are looking at — so paging
  a list of model names slides every column left and right under the
  cursor. `meta.maxWidth` does NOT fix it: that stops a column growing,
  and the one that jumps is usually SHRINKING on the page where the
  longest value happens to be short. `meta.width` pins both ends, on
  the header cell AND on a block inside each body cell, because a long
  header word will otherwise become the widest thing in the column and
  set the width itself. Pin the text columns; the numeric ones are
  stable on their own.
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
- A DROPDOWN SHOWS EIGHT ROWS AND THEN SCROLLS, set once on `MuiMenu`
  in the theme rather than per select. A picker over every host, or
  every CVE, otherwise opens a menu the height of the window. It is a
  HEIGHT, not a count, so a menu whose items run to two lines shows
  fewer — which is the right trade, since the point is a menu that fits
  on screen rather than a promise about a number.
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
- ANYTHING NAMED AFTER AN OS GETS ITS MARK, through one lookup
  (`osMark`) and one component (`components/OSName.tsx`) — VM
  templates, CT templates, cloud images, ISOs and a guest agent's
  report all name their OS somewhere, so the icon costs nothing but
  the regex. Three answers, in order: a simple-icons brand; a GLYPH
  wherever no LEGIBLE mark exists (a terminal for the DOS-era systems,
  a tool for media that isn't an operating system at all — driver
  disks, virtio, rescue images — and for VMware, whose only mark is a
  wordmark that turns to grey mush at 16px), drawn in secondary text
  colour so it doesn't read as a logo; or nothing, with a spacer so a
  column of names doesn't jog left and right. Windows is the one mark
  DRAWN IN `brands.ts` rather than imported: simple-icons carries no
  Microsoft marks, and the commonest guest OS in a lab can't be the
  blank row. Patterns must be specific enough to keep `win` out of
  Darwin and virtio-win, and appliances (pfSense, OPNsense) are tried
  before the BSDs they're built on.
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
- `email_verified: false` BLOCKS CREATION, NOT SIGN-IN. An account that
  already exists here was put there by an owner, and self-hosted
  providers routinely report false because they have no
  address-verification flow — refusing that is a locked door for no
  gain, so it's a logged warning. Creating an account is the step where
  an unverified address would turn "the provider says this is their
  email" into access, and that still refuses.
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
- WHO DID WHAT IS THIS CONSOLE'S TO RECORD. Every backend is reached
  through ONE shared credential — Proxmox's task log can only ever say
  `root@pam!lcm`, which is correct for a service account and useless
  for attribution. The mapping from an action to a PERSON exists
  nowhere else, so `audit_log` is the record rather than a convenience.
  It is MIDDLEWARE (`s.auditing`, mounted after `requireAuth` so the
  actor is known), not a call in each handler, because a per-handler
  call is what the next endpoint forgets and a log with holes invites
  the conclusion that nothing happened. MUTATIONS ONLY: a console that
  logged every GET would bury the one line that matters under a
  three-second poll of the instance list. Sign-in is recorded by hand
  (`recordSignIn`), since /auth/login runs outside the session and its
  body is a password.
- THE PAYLOAD IS KEPT, REDACTED, AND FOLDED AWAY. "Who changed this to
  what" is most of the value, so the request body is stored — but any
  field whose name looks like a secret (password, token, key, secret,
  credential, passphrase) is replaced before it is written, with a
  short allowlist for the ones that only sound like secrets
  (publicKey, tokenId). A non-JSON body is dropped entirely rather
  than stored blind: an upload has no field names to judge, and
  guessing is how a secret reaches a log. The UI shows the verb as the
  row and the payload behind an expander.
- PHASE ONE IS SQLITE, ON PURPOSE. The row shape is flat and
  sink-shaped — timestamp, actor, verb, target, outcome — so shipping
  to OpenSearch or Graylog later is a mapping rather than a rewrite.
  It lives here first because the console already IS a SQLite file, and
  a log you can't read without standing up a cluster is a log nobody
  reads. Entries are pruned after 90 days.
- ROLES ARE ENFORCED, AND THE LINE IS CREDENTIALS, NOT DANGER
  (`internal/api/rbac.go`). GCP's basic three: a viewer reads
  everything and changes nothing, an editor changes RESOURCES, an
  owner also changes CREDENTIALS AND ACCESS. An editor may delete a VM
  — destructive, and recoverable from a backup — but only an owner may
  add a hypervisor, because a stored root token is a standing grant of
  everything an editor could ever do, and only an owner may create an
  account, because that is how the set of editors changes. Enforcement
  is MIDDLEWARE for the same reason auditing is: a check inside each
  handler is one the next handler forgets. READS ARE OPEN to anyone
  signed in — this console shows a lab's state, and a viewer who can't
  see it has no reason to have an account. SELF-SERVICE stays open too
  (`/auth/password`, `/ssh-key`), or a viewer couldn't use the console
  at all. A refusal is a 403 that names the role needed, and it lands
  in the audit log like any other action. The frontend's
  `usePermissions` and `RequireRole` decide what to OFFER and are
  worth nothing on their own; the middleware doesn't trust them. One
  role per user for now; the binding model is what it grows into. Also
  enforced: the console can't lose its last active owner, and you
  can't delete or disable the account you're signed in as.
- THE OWNER-ONLY LIST IS ROUTE PATHS, AND A RENAME MOVES A ROUTE OUT OF
  IT WITHOUT BREAKING ANYTHING. That happened: the hypervisor rename
  took `/servers` to `/hypervisors` and left the old spelling in
  `ownerOnly`, matching nothing — so an editor could add a hypervisor
  credential, the exact grant the rule exists to prevent, with
  everything still compiling and every test still passing.
  `rbac_test.go` now names the paths that must be covered, because a
  string that quietly stops matching is not something to leave to a
  reader's eye. The other half of the same fix: an entry ENDING IN "/"
  owns everything beneath it (`/iam/` has to reach
  `/iam/users/{id}/password`), and an entry without one covers the
  COLLECTION AND ITS MEMBERS ONLY. A blind prefix match made
  `/database/servers` own everything below it, so creating a database,
  adding a database user and granting access were all owner-only —
  against both the role doc and the list's own comment beside it.
  Connecting a backend is an owner's decision; using one is an
  editor's, and that includes minting an object store's access keys.
- CLOUD OVERVIEW IS THE FRONT DOOR: `/overview`, first in the global
  menu, and where `/` lands. It answers "what's wrong right now", which
  every other page answers only if you already knew where to look. It
  adds NO integration — one `/overview` endpoint fans out in parallel
  over the probes and drivers already here and derives problems from
  what the app knows: any backend that doesn't answer "connected"
  (including "unknown", a driver that never built — a server with bad
  stored credentials must not read as fine), datastores past 85/95%,
  running guests reporting no address (the missing guest agent), and
  guests whose newest backup is over a week old. A backend that fails
  contributes a problem instead of failing the page, and no-problems
  renders an explicit all-clear rather than an empty box. It polls on a
  slow beat (30s), not the 3s of a list page, because one request
  touches every backend at once. The section has no left nav — one link
  to the page you're on is a rail that says nothing — so Shell gives a
  section with no items or groups the full window.
- THE GLOBAL MENU'S SECOND LIST IS "ALL SECTIONS", not GCP's
  "Products" — that word is right for a catalogue of things you buy and
  says nothing here. Beside Favorites its job is to mark the
  unshortened list, which is what Azure's "All services" does; the
  console's own word for these is section, and "Services" was the other
  candidate but already means a stored credential in Devices and
  Monitoring.
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
- THE APP DOESN'T GUESS ITS OWN ADDRESS when told: `LCM_SITE_URL` is
  the public origin, and everything the outside world has to match is
  built from it — today the OIDC redirect URI, via `siteOrigin`. Behind
  a tunnel the request arrives addressed to whatever the proxy dialled
  (`app:8080`), which is what silently broke sign-in. Unset, it falls
  back to the request, which is right on a laptop. It is NOT used for
  the cookie Secure flag: that stays per-request (`isTLS`), so the same
  server works over https through the tunnel and plain http on the LAN.
  The settings page shows the redirect URI THE SERVER computes rather
  than one the browser derives, since behind a proxy the two disagree
  and only the server's is the one to register.
- PUBLISHING IS A CLOUDFLARE TUNNEL. `cloudflared` is an ordinary
  service in the one compose file — NO PROFILES, here or anywhere: a
  service you have to remember a flag to start is a service you'll
  think is missing. It needs `TUNNEL_TOKEN` in .env and restarts
  without one, which is noisy but visible. Every service carries a
  `container_name` (`cloud-console`, `cloud-console-tunnel`,
  `cloud-console-guacd`) so
  `docker logs cloud-console` is the same command on every host —
  compose otherwise names them after the checkout directory, which
  differs between machines. It reaches `http://app:8080`
  over the compose network; the published port stays for the LAN. `isTLS` already honours `X-Forwarded-Proto`,
  so the session cookie becomes Secure through the tunnel and stays
  usable over plain http on the LAN.
- A DESKTOP IS PROXIED THROUGH `guacd`, which is why there is a third
  service. It speaks RDP and VNC and hands back a stream the page
  renders, so a Windows desktop reaches the browser the way a terminal
  already does — the same shape as `internal/api/ssh.go`, with
  guacamole-common-js where xterm.js sits. It holds no state and reads
  no config file.
  ITS ACCESS CONTROL IS THAT IT HAS NO PUBLISHED PORT. guacd
  authenticates nothing: anything that can reach 4822 can ask it to
  connect to any host with any credentials it is handed. Being
  reachable only on the compose network is the entire protection, so a
  `ports:` entry added to debug something is the whole security model
  removed. Nothing depends on it either way — a guacd that isn't
  running is a failed connect with a reason, not a console that won't
  start, which is the tolerance every other backend gets.
  THE DESKTOP RENDERS BEHIND A STACKING CONTEXT, AND THAT IS LOAD-
  BEARING. Guacamole's default layer canvas carries z-index:-1, and a
  negative child paints BEHIND the backgrounds of ordinary ancestors —
  so a page with any background and no stacking context between it and
  the canvas paints itself over a fully rendered desktop. That is
  `isolation: isolate` on the holder in InstanceRDPPage, and it took
  four wrong guesses at RDP parameters to find, because a session in
  that state is connected, streaming and painted, and both ends' logs
  are clean. The instrument that ended it is still there: open the RDP
  window with ?debug and a corner line reports instructions, images,
  display size and whether any pixel is actually lit. Read that BEFORE
  touching the handshake — it says in one line whether a black screen
  is the page (images painted) or the protocol (nothing painting).
  Two more from the same hunt: the handshake's `image` instruction is
  the list of formats the client can DECODE, not a media channel —
  sent empty it means "this client displays no images" (audio and
  video ARE announced empty, deliberately). And the library's Tunnel
  assigns its methods as OWN properties in its constructor, so a
  subclass must assign overrides after super() — a prototype method is
  silently shadowed by the parent's empty stub, and nothing anywhere
  errors.
  WHAT DOESN'T CARRY OVER FROM SSH is the sign-in. The terminal
  connects as the signed-in account with a key this console mints, so a
  guest's auth log names a person; RDP has no key equivalent, so
  credentials are typed per session and travel as the socket's FIRST
  FRAME — the rule ssh.go already follows, and for the same reason:
  query parameters land in proxy logs. Nothing is stored.
- THE DATABASE IS A FILE IN A DIRECTORY, not a named volume:
  `./data/vantric.db` under Docker, `backend/vantric.db` under `make
  dev`. One SQLite file holds everything — accounts, every backend
  credential, every account's SSH private key — so backup is `cp` and
  inspection is `sqlite3`, neither of which should need a throwaway
  container. The image runs as uid 1000; a host whose operator isn't
  uid 1000 needs one `chown` on the directory.
  It was `labcloud.db` before the rename, and `config.ResolveSQLite`
  still opens that name when the current one isn't there, warning as
  it does. Being a file is what makes this necessary: SQLite CREATES a
  database it can't find, so a deploy whose data sits at the old path
  doesn't fail — it comes up clean, with no hypervisors, no
  credentials and no accounts, which reads as an upgrade that wiped
  everything. Renaming by hand means moving the `-wal` and `-shm`
  ALONGSIDE it (journal_mode is WAL): a clean shutdown checkpoints and
  removes them, but after an unclean stop the `-wal` holds committed
  transactions, and moving only the main file strands them.
- DEVELOPMENT IS NATIVE, Docker only ships. `make dev` runs `go run`
  and `vite` on the host; there is ONE compose file and it builds the
  app image. The dev containers are gone: they existed to run the same
  two commands one filesystem away, and paid for it with bind-mount
  polling (air `poll = true`, vite `watch.usePolling`, both still set
  and harmless) and a database inside a volume you had to dig into.
  The Makefile is the interface — `make` lists it.
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

ENVIRONMENT ONLY — there is no config file. `internal/config` reads
eleven `VANTRIC_*` variables (listen, db driver/dsn, site url, static dir,
trusted proxies, two ssh toggles, the guacd address, two
bootstrap-account settings) and
every one has a working default, so running with nothing set is
supported. TRUSTED_PROXIES defaults to trusting NOTHING: a forwarding
header is believed only from a peer named there, so the audit log
records who actually connected rather than who said they did. Behind
the tunnel it needs setting, or every action is attributed to the
proxy. `.env.example`
documents them; `.env` is gitignored and compose reads it through
`env_file`, passed whole so a new setting can't be silently dropped by
forgetting to list it. Container-specific values (`VANTRIC_LISTEN`,
`VANTRIC_DB_DSN` in the dev service) stay in `environment:`, which wins.

The pre-rename `LCM_*` names are STILL HONOURED, and warned about at
startup (`config.Legacy`). Config being environment-only is exactly
why: a deploy that renamed the variables without a fallback wouldn't
fail, it would start on defaults — wrong address, wrong database —
which is worse than not starting. The warning exists so the fallback
is a transition rather than a second permanent spelling.
Everything about the LAB rather than the app — hypervisors, DNS,
databases, identity, network, SSO — is a DB record added in the UI.
