// Typed client for the vantric REST API.

/** A role in this console — not in the identity provider it manages. */
export type RoleID = 'owner' | 'editor' | 'viewer'

export interface Role {
  id: RoleID
  title: string
  description: string
}

/** An account that can sign in to this console. */
export interface IAMUser {
  id: string
  email: string
  name: string
  role: RoleID
  /** False for an account with no local password (SSO-only, later). */
  hasPassword: boolean
  active: boolean
  /** RFC3339, or empty if they've never signed in. */
  lastLoginAt: string
  createdAt: string
  updatedAt: string
}

/** Signing in through the lab's identity service. */
export interface OIDCProvider {
  id: string
  name: string
  issuer: string
  clientId: string
  hasSecret: boolean
  scopes: string
  /** Make an account for anyone the provider vouches for. */
  autoCreate: boolean
  defaultRole: RoleID
  enabled: boolean
  /** What THIS server will send as redirect_uri — tell the provider
   *  exactly this. Behind a proxy it differs from the browser's origin. */
  redirectUri: string
  /** True when it comes from VANTRIC_SITE_URL rather than being guessed. */
  siteUrlSet: boolean
  createdAt: string
  updatedAt: string
}

export interface OIDCRequest {
  name: string
  issuer: string
  clientId: string
  /** Blank keeps the stored secret. */
  clientSecret: string
  scopes: string
  autoCreate: boolean
  defaultRole: RoleID
  enabled: boolean
}

/** What the sign-in page needs before anyone is signed in. */
export interface AuthProviders {
  oidc: { name: string } | null
}

/** Your SSH identity. The private half is never returned. */
export interface SSHKey {
  publicKey: string
  /** True when you supplied the key rather than the console making it. */
  imported: boolean
  fingerprint: string
}

/** One table inside a database. Row counts are the engine's estimate. */
export interface DatabaseTable {
  schema: string
  name: string
  owner: string
  rows: number
  sizeBytes: number
  /** MySQL's storage engine; empty on PostgreSQL. */
  engine: string
  collation: string
  comment: string
}

/** The three answers a console offers, not the engine's full matrix. */
export type AccessLevel = 'read' | 'readwrite' | 'full'

export interface AccessRequest {
  user: string
  host: string
  level: AccessLevel
  /** Create the user first; password is required with it. */
  createUser: boolean
  password: string
}

/** What one grantee may do. scope is '' for the database itself. */
export interface DatabaseGrant {
  grantee: string
  scope: string
  privileges: string[]
}

export interface IAMUserRequest {
  email: string
  name: string
  role: RoleID
  active: boolean
  /** Only on create; changing a password is its own endpoint. */
  password?: string
}

export type InstanceStatus =
  | 'PROVISIONING'
  | 'STAGING'
  | 'RUNNING'
  | 'STOPPING'
  | 'TERMINATED'

export interface Instance {
  id: string
  name: string
  hypervisorId: string
  node: string
  cpus: number
  memoryMb: number
  diskGb: number
  imageId: string
  status: InstanceStatus
  driverId: string
  internalIp: string
  netBridge: string
  vlanTag: number
  description: string
  protected: boolean
  /** The hypervisor's guest-type hint (l26, win11, …). */
  osType: string
  /**
   * The guest's SMBIOS system UUID — what it reads about itself as
   * /sys/class/dmi/id/product_uuid, and what inventory and monitoring
   * running inside it record as its identity. Unlike the vmid it is
   * never reused, so it's the join key to those tools.
   */
  uuid: string
  /**
   * SMBIOS serial number. Empty on almost every VM — a hypervisor sets
   * none unless asked — and device inventory keys on it, so an empty
   * one is a fact worth showing rather than hiding.
   */
  serial: string
  createdAt: string
  updatedAt: string
}

export interface NIC {
  name: string
  model: string
  mac: string
  bridge: string
  vlanTag: number
  firewall: boolean
  ipAddress: string
}

export interface AttachedDisk {
  interface: string
  name: string
  storage: string
  sizeBytes: number
  /** disk | cdrom | efi | tpm | unused */
  media: string
  ssd: boolean
  discard: boolean
}

/** Repeatable hardware (serial ports, USB, PCI passthrough, …). */
export interface Device {
  key: string
  kind: string
  value: string
}

/** Full hypervisor-side config, read on demand for the detail view. */
export interface InstanceDetail {
  name: string
  node: string
  status: InstanceStatus
  cpus: number
  memoryMb: number
  diskGb: number
  internalIp: string
  description: string
  tags: string[] | null
  osType: string
  /** SMBIOS system UUID — see Instance.uuid. */
  uuid: string
  /** SMBIOS serial number — see Instance.serial. */
  serial: string
  cpuType: string
  architecture: string
  sockets: number
  bootOrder: string
  bios: string
  /** chipset (i440fx / q35) — distinct from the sizing preset */
  machineType: string
  display: string
  scsiController: string
  onBoot: boolean
  guestAgent: boolean
  hostProtected: boolean
  // No createdAt: a hypervisor's only per-guest timestamp is the ctime
  // in its config, which a clone inherits from its template. The
  // instance's own createdAt comes from the store record.
  uptimeSeconds: number
  /** Whether the guest has a cloud-init drive; without one the settings below are inert. */
  cloudInit: boolean
  cloudInitUser: string
  sshKeys: string[] | null
  nameservers: string
  searchDomain: string
  upgradePackages: boolean
  datasource: string
  ipConfig: string
  nics: NIC[] | null
  disks: AttachedDisk[] | null
  devices: Device[] | null
}

export interface MetricPoint {
  time: number
  cpuPercent: number
  memoryBytes: number
  maxMemoryBytes: number
  diskReadBytes: number
  diskWriteBytes: number
  netInBytes: number
  netOutBytes: number
}

export type MetricTimeframe = 'hour' | 'day' | 'week' | 'month'

export interface OSInfo {
  available: boolean
  hostname: string
  name: string
  version: string
  kernelRelease: string
  kernelVersion: string
  machine: string
  osType: string
}

// Container (LXC) — deliberately separate from Instance: containers
// list and provision differently.
export interface Container {
  id: string
  name: string
  hypervisorId: string
  node: string
  cpus: number
  memoryMb: number
  diskGb: number
  status: InstanceStatus
  driverId: string
  internalIp: string
  description: string
  protected: boolean
  createdAt: string
  updatedAt: string
}

/** What a container needs stated, since there is no template guest to
 *  inherit from the way a VM clone does. */
export interface ContainerRequest {
  name: string
  hypervisorId: string
  node: string
  /** A CT template volume id. */
  template: string
  /** Pool the root filesystem is created on. */
  storage: string
  cpus: number
  memoryMb: number
  swapMb: number
  diskGb: number
  netBridge: string
  vlanTag: number
  dhcp: boolean
  address: string
  gateway: string
  nameservers: string
  searchDomain: string
  password: string
  sshKeys: string
  unprivileged: boolean
  nesting: boolean
  startOnBoot: boolean
  description: string
  protected: boolean
}

/** An S3-compatible object store this console manages buckets through. */
export interface StorageProvider {
  id: string
  name: string
  type: StorageProviderType
  baseUrl: string
  accessKey: string
  region: string
  insecureTls: boolean
  hasSecret: boolean
  status: 'connected' | 'unreachable' | 'unknown'
  error?: string
  /** Absent where the store has no admin API to ask. */
  info?: StorageInfo
  createdAt: string
}

export type StorageProviderType = 'rustfs'

export interface StorageProviderRequest {
  name: string
  type: StorageProviderType
  baseUrl: string
  accessKey: string
  /** Blank keeps the stored key. */
  secretKey: string
  region: string
  insecureTls: boolean
}

/** What the store says about itself. Every field is optional; a zero
 *  means "not reported" and reads as such. */
export interface StorageInfo {
  online: boolean
  version: string
  backend: string
  deploymentId: string
  onlineDisks: number
  offlineDisks: number
  uptimeSeconds: number
  totalBytes: number
  usedBytes: number
  freeBytes: number
  buckets: number
  objects: number
}

export interface Bucket {
  providerId: string
  name: string
  createdAt: number
  /** From the store's usage scanner, so it lags — see `scanned`. */
  objects: number
  sizeBytes: number
  scanned: boolean
  quotaBytes: number
}

export interface StorageObject {
  key: string
  sizeBytes: number
  modifiedAt: number
  etag: string
  storageClass: string
}

export interface ObjectPage {
  objects: StorageObject[]
  /** The "folders" a delimiter collapsed. */
  prefixes: string[]
  nextToken: string
  truncated: boolean
}

/**
 * A credential on the STORE — what a backup script signs with — not an
 * account in this console. The secret is never returned by anything.
 */
export interface StorageUser {
  providerId: string
  accessKey: string
  enabled: boolean
  /** The bound policy's name, empty for a key that can reach nothing. */
  policy: string
  updatedAt: number
}

export interface StoragePolicy {
  providerId: string
  name: string
  /** Every action the document allows, flattened. */
  actions: string[]
  /** Every ARN it allows them on — how "reaches this bucket" is answered. */
  resources: string[]
}

/** One anonymous allow in a bucket policy, described rather than quoted. */
export interface PublicGrant {
  sid: string
  actions: string[]
  resources: string[]
  /** Anyone can enumerate the bucket, not just fetch a known key. */
  listable: boolean
  /** Anyone can add or remove objects. */
  writable: boolean
}

export interface BucketPolicy {
  /** The raw IAM document, as the store holds it. */
  document?: unknown
  exposure: { public: boolean; grants: PublicGrant[] }
}

export interface BucketKeyAccess {
  accessKey: string
  enabled: boolean
  policy: string
  actions: string[]
}

export interface BucketPermissions {
  /** null when this bucket has no policy — the ordinary state. */
  policy: BucketPolicy | null
  /** false when the STORE has no bucket policies, which is not the same. */
  policySupported: boolean
  keys: BucketKeyAccess[]
  /** false when the store has no IAM to ask, so empty isn't "nothing". */
  keysKnown: boolean
}

export type HypervisorType = 'proxmox' | 'mock'

/** One thing worth someone's attention on the Cloud overview. */
export interface OverviewProblem {
  severity: 'error' | 'warning'
  title: string
  detail: string
  /** the route that shows it */
  to: string
}

export interface OverviewCounts {
  instances: number
  running: number
  containers: number
  containersRunning: number
  hypervisors: number
  databases: number
  databaseServers: number
  dnsZones: number
  identityUsers: number
  networkClients: number
  accounts: number
}

export interface OverviewDatastore {
  name: string
  node: string
  hypervisorId: string
  usedBytes: number
  totalBytes: number
  percent: number
}

export interface Overview {
  problems: OverviewProblem[]
  counts: OverviewCounts
  datastores: OverviewDatastore[]
}

/** A CVE affecting an installed package, as the inventory service
 *  reports it. */
export interface Vulnerability {
  cve: string
  /** A flaw in the OS itself: no package to upgrade, fixed by a system
   *  update. */
  operatingSystem: boolean
  package: string
  installedVersion: string
  /** Empty when nothing has scored it — see src/severity.ts. */
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL' | ''
  cvssScore: number
  epss: number
  knownExploited: boolean
  /** Empty when no fixed version has been published. */
  resolvedInVersion: string
  publishedAt: number
  detailsUrl: string
}

export interface InventoryPackage {
  name: string
  /** The matched CPE; its product field is what collapses a Windows
   *  installer's components back into one piece of software. */
  cpe: string
  version: string
  source: string
  vulnerabilities: Vulnerability[] | null
}

export interface InventoryHost {
  id: string
  /** What the inventory service calls it — Fleet's display_name. This
   *  is what lists show; "Diane's MacBook Air", not "mac.localdomain". */
  name: string
  /** The machine's own hostname, which is how you'd reach it. */
  hostname: string
  uuid: string
  serial: string
  /** Hardware as the agent read it; what `virtual` is derived from. */
  vendor: string
  model: string
  /** Emulated hardware — or a guest this console demonstrably runs. */
  virtual: boolean
  platform: string
  osVersion: string
  status: string
  seenAt: number
  updatedAt: number
  issuesFailing: number
}

/**
 * Three states, deliberately distinct: no service connected, a service
 * that has never seen this machine, and a machine it knows. The middle
 * one is a finding, not an empty list.
 */
export interface InstanceInventory {
  configured: boolean
  enrolled: boolean
  detail?: {
    host: InventoryHost
    packages: InventoryPackage[]
    vulnerabilities: Vulnerability[]
  }
  uuid: string
  error?: string
}

/** A host, plus the thing the inventory service can't know: whether
 *  this console runs the machine. */
export interface InventoryHostView extends InventoryHost {
  instance: string
  managed: boolean
}

/** A CVE that is both in CISA's catalogue and present on machines here. */
export interface ExploitedFinding {
  cve: string
  /** CISA's name for the flaw. */
  name: string
  /** CISA's naming of what carries it, e.g. "Google Chromium WebP". */
  product: string
  hosts: number
  severity: string
  cvssScore: number
  addedAt: number
  ransomware: boolean
}

export interface SecurityOverview {
  configured: boolean
  /** False where the service can't produce an estate-wide CVE list. */
  supported: boolean
  exploited: ExploitedFinding[]
  /** Totals, so the short list has a denominator. */
  tracked: number
  catalogued: number
  error?: string
}

export interface Shortcut {
  id: string
  name: string
  url: string
  /** basename of the uploaded icon, or '' for the monogram tile */
  icon: string
  position: number
  createdAt: string
  updatedAt: string
}

export interface ShortcutInput {
  name: string
  url: string
}

export interface Installer {
  name: string
  size: number
  uploadedAt: number
  platform: string
}

export interface Installers {
  installers: Installer[]
  /** The origin a MACHINE should fetch from — the server's own idea of
   *  its address, which behind a tunnel isn't the browser's. */
  baseUrl: string
  /** ABSENT unless you're an owner: the token is a credential, and a
   *  fleetd package carries the enrollment secret. */
  token?: string
}

export interface InventoryHostDetail {
  host: InventoryHost
  /** May be null: an older API returns JSON null for an empty list. */
  packages: InventoryPackage[] | null
  vulnerabilities: Vulnerability[] | null
  /** The VM here that is this machine, empty when it's external. */
  instance: string
  managed: boolean
}

export interface InventoryHosts {
  configured: boolean
  hosts: InventoryHostView[]
  /** Instances this console runs that no agent reports. */
  unenrolled: string[]
  error?: string
}

export interface VulnerabilitySummary {
  cve: string
  hosts: number
  /** When the service first saw it. Every Fleet tier reports this. */
  detectedAt: number
  cvssScore: number
  /** Empty when nothing has scored it — see src/severity.ts. */
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL' | ''
  epss: number
  /** NVD's summary, from the console's CVE cache. Empty until the
   *  enricher has reached this one — which is not the same as there
   *  being none, so the column says so rather than showing a blank. */
  description: string
  knownExploited: boolean
  /** CISA's own name for it, e.g. "Apache Log4j2 Remote Code Execution
   *  Vulnerability". Empty unless knownExploited. */
  exploitedName: string
  publishedAt: number
  detailsUrl: string
}

export interface VulnerableSoftware {
  name: string
  version: string
  source: string
  hosts: number
  resolvedInVersion: string
}

/** One CVSS scoring. NVD carries several — its own and the vendor's,
 *  in different versions of the standard — and they often disagree. */
export interface NVDMetric {
  version: string
  score: number
  severity: string
  vector: string
  source: string
  primary: boolean
}

export interface NVDRecord {
  cve: string
  description: string
  published: number
  lastModified: number
  metrics: NVDMetric[] | null
  weaknesses: string[] | null
  references: { url: string; tags: string[] | null }[] | null
}

export interface VulnerabilityDetail {
  summary: VulnerabilitySummary
  hosts: (InventoryHost & { instance: string; managed: boolean })[]
  software: VulnerableSoftware[]
  detectedAt: number
  hostsCountedAt: number
  /** What the public database says about the flaw; absent when it has
   *  nothing or couldn't be reached. */
  nvd?: NVDRecord
  nvdError?: string
  /** CISA's record, present only when this is actively exploited. */
  kev?: KEVEntry
}

/** One record from CISA's Known Exploited Vulnerabilities catalogue. */
export interface KEVEntry {
  cve: string
  vendorProject: string
  product: string
  vulnerabilityName: string
  /** Unix seconds; 0 when the catalogue's date wouldn't parse. */
  dateAdded: number
  dueDate: number
  /** Seen in ransomware campaigns, per CISA. */
  knownRansomware: boolean
  requiredAction: string
}

export interface InventoryVulnerabilities {
  configured: boolean
  /** False when connected but the service can't answer — a missing
   *  feature, not a broken connection. */
  supported: boolean
  vulnerabilities: VulnerabilitySummary[]
  error?: string
}

/** The background pass that fills in what each CVE is. */
export interface EnrichmentStatus {
  running: boolean
  queued: number
  done: number
  failed: number
  lastError?: string
  lastRunAt: number
  /** Which NVD rate limit is in force — the difference between an hour
   *  and most of a day. */
  hasApiKey: boolean
  /** Whether THIS console runs the background pass. */
  enabled: boolean
  cache: {
    enriched: number
    missing: number
    newestAt: number
    withScore: number
  } | null
  total: number
  /** Every CVE ever fetched, including ones the estate no longer
   *  reports. Always >= cache.enriched + cache.missing. */
  cachedOverall: number
}

/**
 * An address range and what it's for. `source` records where it came
 * from: "manual" is this console's own record, anything else names the
 * system that reported it and is read-only here.
 */
export interface Subnet {
  id: string
  name: string
  source: string
  /** The upstream object's own id; empty for a manual range. */
  sourceId: string
  stackType: string
  /** 802.1Q tag, or 0 for an untagged range. */
  vlan: number
  ipv4Range: string
  ipv4Gateway: string
  /** The DHCP pool inside the range; empty means statically assigned. */
  dhcpStart: string
  dhcpStop: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface IPRecord {
  id: string
  subnetId: string
  address: string
  hostname: string
  mac: string
  status: string
  description: string
}

/** One address in a subnet. Roles come from the range, not the record. */
export interface AddressView {
  address: string
  /** network | broadcast | gateway | dhcp | '' for a plain host */
  role: string
  usable: boolean
  record?: IPRecord
}

export interface AddressPage {
  addresses: AddressView[]
  total: number
  page: number
  recorded: number
  inDhcp: number
  free: number
}

export interface SubnetRequest {
  name: string
  stackType: string
  vlan: number
  ipv4Range: string
  ipv4Gateway: string
  /** The DHCP pool inside the range; empty means statically assigned. */
  dhcpStart: string
  dhcpStop: string
  description: string
}

export interface InventoryProvider {
  id: string
  name: string
  type: string
  baseUrl: string
  insecureTls: boolean
  createdAt: string
  hasToken: boolean
  status: string
  info?: { version: string; hosts: number }
  error?: string
}

export interface InventoryProviderRequest {
  name: string
  type: string
  baseUrl: string
  token?: string
  insecureTls?: boolean
}

/** A configured AI gateway — Bifrost, for now. */
export interface AIGateway {
  id: string
  name: string
  type: string
  baseUrl: string
  insecureTls: boolean
  createdAt: string
  hasToken: boolean
  status: string
  info?: { version: string; requests: number; authEnabled: boolean }
  error?: string
}

export interface AIGatewayRequest {
  name: string
  type: string
  baseUrl: string
  token?: string
  insecureTls?: boolean
}

/**
 * One call the gateway handled. Latency and the token counts are
 * OPTIONAL because the gateway omits them rather than sending zero — a
 * request that failed before the model answered never had a latency,
 * and 0 ms would read as instant.
 */
export interface AIRequest {
  id: string
  at: string
  provider: string
  model: string
  status: string
  latencyMs?: number
  /** Sent where the gateway priced the call and omitted where there
   *  was nothing to price — a local model costs nothing. Absent rather
   *  than zero, so free and not-recorded stay different answers. */
  cost?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  caller?: string
  credential?: string
  streamed: boolean
  kind?: string
}

/**
 * Why a call failed, in the words of whoever refused it. Whose words
 * matters: the gateway blocking on its own policy and the provider
 * rejecting the call are different problems with different fixes.
 */
export interface AIRequestError {
  kind?: string
  statusCode?: number
  message: string
  fromGateway: boolean
}

/**
 * One call with the facts the list can't carry — the gateway only
 * returns a failure reason on the single-log endpoint, which is why
 * this is a drill-in and not another column.
 *
 * The prompt and the completion are deliberately absent, here as in
 * the list.
 */
export interface AIRequestDetail extends AIRequest {
  error?: AIRequestError
  retries: number
  fallbackIndex: number
  routingRule?: string
}

export interface AIRequestPage {
  requests: AIRequest[]
  total: number
}

export interface AIStats {
  requests: number
  successRate: number
  avgLatencyMs: number
  totalTokens: number
  cost: number
}

/** One interval's requests. Failures are carried, not derived — an
 *  outage should read as a block of red rather than as a dip. */
export interface AITrafficBucket {
  at: string
  total: number
  succeeded: number
  failed: number
}

export interface AITraffic {
  /** Stated rather than assumed: a chart labelling hourly buckets as
   *  minutes is worse than no chart. */
  bucketSeconds: number
  buckets: AITrafficBucket[]
}

export interface AIModelUsage {
  model: string
  provider: string
  requests: number
  succeeded: number
  tokens: number
  cost: number
  avgLatencyMs: number
}

/** A model provider as the GATEWAY has it configured — a different
 *  thing from the account at that provider, which is what AIAccount
 *  is. This says what the gateway can reach; that says what's left. */
export interface AIGatewayProvider {
  name: string
  /** The gateway's own word, passed through rather than mapped. */
  status: string
  keys: AIGatewayKey[]
}

/** One upstream credential. `masked` is the gateway's own masked form
 *  — a key is shown so it can be recognised, not copied. */
export interface AIGatewayKey {
  id: string
  name: string
  masked?: string
  models: string[]
  enabled: boolean
  status?: string
}

/**
 * A credential the gateway issues to a caller — one per service in the
 * lab, which is what makes the Caller column on the request log mean
 * something. The secret is never carried: the gateway returns it in
 * plaintext and the driver drops it.
 */
export interface AIVirtualKey {
  id: string
  name: string
  active: boolean
  access: { provider: string; models: string[] }[]
  createdAt: string
  /** What the key has actually done. Absent where the gateway wouldn't
   *  say — best effort, so a key without figures is still listed. */
  activity?: {
    requests: number
    successRate: number
    /** AN ESTIMATE, and labelled as one wherever shown: the gateway
     *  prices from its own list, and a router picks an upstream per
     *  request, so the real charge can differ either way. */
    cost: number
    /** Zero time where the key has never been used — a finding, not a
     *  blank. */
    lastUsed: string
  }
}

/**
 * A cap the gateway enforces, and what it applies to. Bifrost hangs
 * both a spending budget and a rate limit off a scope plus a model
 * pattern, so one record says who is capped, at what, on which models.
 */
export interface AILimit {
  id: string
  /** The gateway's own word: "virtual_key", "team", "customer". */
  scope: string
  /** Usually the virtual key's name — the same one the request log
   *  shows as the caller. */
  scopeName: string
  /** "*" is the gateway's word for all models, not a name. */
  model: string
  budget?: {
    max: number
    used: number
    /** The gateway's duration string — "1w", "1d", "1M". */
    period: string
    lastReset: string
  }
  /** Caps only. What has been used against them isn't carried: the
   *  counter field names aren't verifiable and inventing them makes a
   *  column nobody can diagnose. */
  rateLimit?: {
    maxRequests?: number
    requestPeriod?: string
    maxTokens?: number
    tokenPeriod?: string
  }
}

export interface AIFilters {
  providers: string[]
  models: string[]
  callers: { id: string; name: string }[]
}

export interface AIRequestQuery {
  limit?: number
  offset?: number
  sortBy?: string
  order?: 'asc' | 'desc'
  providers?: string[]
  models?: string[]
  callers?: string[]
  status?: string
  search?: string
  /** RFC3339. The gateway filters on its own clock, not the browser's. */
  since?: string
  until?: string
}

/**
 * A model provider's own account — what's LEFT where you pay, which
 * the gateway in front of them can't know.
 *
 * `kind` matters: providers don't answer the same question. OpenRouter
 * reports credits in dollars, ElevenLabs an allowance in characters,
 * and some report only what's been spent. A number without its kind
 * and unit beside it is a number to argue about.
 */
export interface AIAccountBalance {
  kind: 'credits' | 'quota' | 'spend'
  unit: string
  remaining?: number
  used: number
  granted: number
  asOf: string
}

export interface AIAccount {
  id: string
  name: string
  type: string
  createdAt: string
  hasKey: boolean
  status: string
  balance?: AIAccountBalance
  error?: string
}

export interface AIAccountRequest {
  name: string
  type: string
  key?: string
}

/** A configured monitoring service — Zabbix, for now. */
export interface MonitoringProvider {
  id: string
  name: string
  type: string
  baseUrl: string
  insecureTls: boolean
  createdAt: string
  hasToken: boolean
  status: string
  info?: { version: string; hosts: number }
  error?: string
}

export interface MonitoringProviderRequest {
  name: string
  type: string
  baseUrl: string
  token?: string
  insecureTls?: boolean
}

/**
 * One thing the monitoring service says is wrong right now. Severity
 * is the service's own word — Disaster, High, Average… — with rank
 * beside it so tables sort without parsing prose.
 */
export interface MonitoringProblem {
  id: string
  name: string
  hostId?: string
  host?: string
  severity: string
  rank: number
  startedAt: string
  acknowledged: boolean
  suppressed: boolean
}

/** A watched host, stamped with the instance at the same address. */
export interface MonitoredHost {
  id: string
  name: string
  addresses: string[]
  enabled: boolean
  instance?: string
}

export interface MonitoringHostsResponse {
  hosts: MonitoredHost[]
  /** Running instances no watched host answers for — the finding. */
  unmonitored: string[]
}

/** One change, and the account that made it. */
export interface AuditEntry {
  id: string
  at: number
  actorId: string
  actorEmail: string
  method: string
  path: string
  action: string
  resource: string
  status: number
  error?: string
  durationMs: number
  remoteAddr: string
  /** The request body, with secrets replaced. */
  payload?: string
}

export interface Hypervisor {
  id: string
  name: string
  type: HypervisorType
  baseUrl: string
  tokenId: string
  insecureTls: boolean
  hasSecret: boolean
  status: 'connected' | 'unreachable' | 'unknown'
  nodes: number
  error?: string
  createdAt: string
}

export interface HypervisorRequest {
  name: string
  type: HypervisorType
  baseUrl: string
  tokenId: string
  secret: string
  insecureTls: boolean
}

export interface Node {
  hypervisorId: string
  id: string
  name: string
  status: string
  cpus: number
  cpuPercent: number
  memoryUsedBytes: number
  memoryTotalBytes: number
  diskUsedBytes: number
  diskTotalBytes: number
  uptimeSeconds: number
}

/** A virtualization host's own description of itself. */
export interface NodeStatus {
  hypervisorId: string
  id: string
  name: string
  uptimeSeconds: number
  cpuModel: string
  cpuSockets: number
  cpuCores: number
  cpus: number
  cpuMhz: string
  cpuPercent: number
  ioWaitPercent: number
  loadAverage: string[] | null
  memoryTotalBytes: number
  memoryUsedBytes: number
  swapTotalBytes: number
  swapUsedBytes: number
  ksmSharedBytes: number
  rootTotalBytes: number
  rootUsedBytes: number
  kernelVersion: string
  version: string
  bootMode: string
  secureBoot: boolean
}

export interface Image {
  hypervisorId: string
  id: string
  name: string
  node: string
  /** The hypervisor's notes. Its first line is the friendly name. */
  description: string
  tags: string[] | null
  architecture: string
  /** unix seconds; 0 when the hypervisor doesn't record it */
  createdAt: number
}

export interface Disk {
  hypervisorId: string
  id: string
  name: string
  inUseBy: string
  node: string
  storage: string
  sizeGb: number
}

export interface Snapshot {
  hypervisorId: string
  id: string
  name: string
  vmName: string
  node: string
  description: string
  createdAt: number
  includesRam: boolean
}

export interface ISO {
  hypervisorId: string
  id: string
  name: string
  node: string
  storage: string
  sizeBytes: number
  createdAt: number
}

// CT templates and cloud images share the ISO listing shape — all are
// datastore volumes, differing only in content type.
export type CTTemplate = ISO
export type CloudImage = ISO

/** A guest backup archive on a datastore. */
export interface Backup {
  hypervisorId: string
  id: string
  name: string
  node: string
  storage: string
  sizeBytes: number
  createdAt: number
  vmid: number
  /** Empty once the guest itself is gone. */
  guestName: string
  /** qemu | lxc */
  guestType: string
  format: string
  notes: string
  protected: boolean
}

/**
 * One guest's backups. The three empty cases are deliberately
 * distinguishable: a hypervisor with no backup catalog, a catalog that
 * couldn't be read, and a guest nobody has ever backed up — only the
 * last of which is a finding about the guest.
 */
export interface InstanceBackups {
  supported: boolean
  backups: Backup[]
  /** Newest archive older than the console's threshold. */
  stale: boolean
  staleAfterDays: number
  error?: string
}

export interface TemplateBuildRequest {
  name: string
  node: string
  sourceVolume: string
  diskStorage: string
  diskGb: number
  cpus: number
  memoryMb: number
  netBridge?: string
  vlanTag?: number
  cloudInit: CloudInitConfig
  bios?: string
  machineType?: string
  enableAgent: boolean
  description?: string
}

/**
 * Work that outlives the request that asked for it — a clone, a disk
 * import, an ISO download. Started by a handler, reported in the
 * notification bell, and never waited on by the page that began it.
 */
export interface Operation {
  id: string
  /** the whole sentence: "Creating instance web-1" */
  title: string
  resource: string
  /** which lists to refresh when this finishes */
  resourceType: 'instance' | 'image' | 'iso' | 'cloudImage' | 'ctTemplate' | 'backup'
  hypervisorId?: string
  status: 'RUNNING' | 'DONE' | 'ERROR'
  step?: string
  steps?: string[]
  error?: string
  /** where clicking the notification goes */
  to?: string
  startedAt: string
  endedAt?: string
}

export interface Bridge {
  hypervisorId: string
  name: string
  node: string
  cidr: string
  comment: string
  active: boolean
  vlanAware: boolean
  ports: string
}

export interface Datastore {
  hypervisorId: string
  id: string
  name: string
  node: string
  type: string
  content: string
  totalBytes: number
  usedBytes: number
  active: boolean
  shared: boolean
}

export interface ISODownloadRequest {
  node: string
  storage: string
  filename: string
  url: string
  checksum?: string
  checksumAlgorithm?: string
  verifyCertificates: boolean
}

export type DNSProviderType = 'cloudflare' | 'powerdns'

export interface DNSProvider {
  id: string
  name: string
  type: DNSProviderType
  accountId: string
  /** API endpoint for a self-hosted provider; empty for a hosted one. */
  baseUrl: string
  hasToken: boolean
  status: 'connected' | 'unreachable' | 'unknown'
  zones: number
  error?: string
  createdAt: string
}

export interface DNSProviderRequest {
  name: string
  type: DNSProviderType
  token: string
  accountId: string
  baseUrl: string
}

/** A zone's start-of-authority record, taken apart into its seven fields. */
export interface ZoneSOA {
  primaryNs: string
  /** The RNAME as an email address; the wire form hides the @ as a dot. */
  hostmaster: string
  serial: number
  refresh: number
  retry: number
  expire: number
  negativeTtl: number
  ttl: number
  /** True when the server filled this in rather than a person. */
  placeholder: boolean
}

export interface DNSAccount {
  id: string
  name: string
}

export interface DNSZone {
  providerId: string
  id: string
  name: string
  status: string
  nameservers: string[] | null
  accountId: string
  accountName: string
  type: string
  paused: boolean
  createdAt: number
}

export interface DNSRecord {
  id: string
  name: string
  type: string
  content: string
  /** Seconds; 1 means the provider chooses. */
  ttl: number
  priority: number
  proxied: boolean
  comment?: string
}

export type NetworkProviderType = 'unifi'

export interface NetworkSite {
  id: string
  name: string
}

export interface NetworkInfo {
  version: string
  sites: number
  networks: number
  clients: number
  devices: number
}

export interface NetworkProvider {
  id: string
  name: string
  type: NetworkProviderType
  baseUrl: string
  site: string
  username: string
  insecureTls: boolean
  hasCredentials: boolean
  status: 'connected' | 'unreachable' | 'unknown'
  info?: NetworkInfo
  error?: string
  createdAt: string
}

export interface NetworkProviderRequest {
  name: string
  type: NetworkProviderType
  baseUrl: string
  site: string
  apiKey: string
  username: string
  password: string
  insecureTls: boolean
}

/** A configured network — a VLAN with its subnet and DHCP range. */
export interface LabNetwork {
  /** Which controller site this came from. */
  site: string
  id: string
  name: string
  vlan: number
  subnet: string
  purpose: string
  /** lan | wan | vpn | other — the controller's own grouping. */
  category: string
  enabled: boolean
  dhcpEnabled: boolean
  dhcpStart: string
  dhcpStop: string
  domainName: string
  /** Live uplink state — WAN networks only; zero elsewhere. */
  ip: string
  isp: string
  latencyMs: number
  up: boolean
  downMbps: number
  upMbps: number
  speedtestAt: number
  cellular: boolean
  signalPercent: number
  radio: string
  dataPlan: string
}

export interface NetworkWiFi {
  site: string
  id: string
  name: string
  enabled: boolean
  security: string
  guest: boolean
  hidden: boolean
  network: string
  bands: string[] | null
  clients: number
}

export interface NetworkClient {
  /** Which controller site this came from. */
  site: string
  id: string
  name: string
  hostname: string
  mac: string
  ip: string
  network: string
  vlan: number
  wired: boolean
  online: boolean
  fixedIp: boolean
  uplink: string
  port: number
  lastSeen: number
  vendor: string
}

export interface NetworkDevice {
  /** Which controller site this came from. */
  site: string
  id: string
  name: string
  model: string
  /** gateway | switch | ap | other */
  kind: string
  mac: string
  ip: string
  version: string
  state: string
  adopted: boolean
  uptimeSeconds: number
  clients: number
}

export type IdentityProviderType = 'authentik'

export interface IdentityInfo {
  version: string
  latestVersion: string
  outdated: boolean
  users: number
  groups: number
  applications: number
}

export interface IdentityProvider {
  id: string
  name: string
  type: IdentityProviderType
  baseUrl: string
  insecureTls: boolean
  hasToken: boolean
  status: 'connected' | 'unreachable' | 'unknown'
  info?: IdentityInfo
  error?: string
  createdAt: string
}

export interface IdentityProviderRequest {
  name: string
  type: IdentityProviderType
  baseUrl: string
  token: string
  insecureTls: boolean
}

export interface IdentityUser {
  id: string
  username: string
  name: string
  email: string
  active: boolean
  superuser: boolean
  /** internal | service_account | internal_service_account */
  kind: string
  /** Unix seconds; 0 when the account has never signed in. */
  lastLogin: number
  groups: string[] | null
}

export interface IdentityGroup {
  id: string
  name: string
  superuser: boolean
  members: number
  parent: string
}

export interface IdentityApplication {
  id: string
  name: string
  slug: string
  launchUrl: string
  provider: string
  providerType: string
  description: string
}

export interface IdentityEvent {
  id: string
  action: string
  user: string
  app: string
  clientIp: string
  created: number
  detail: string
}

export type DatabaseEngine = 'postgres' | 'mysql'

export interface DatabaseServerInfo {
  version: string
  uptimeSeconds: number
  sizeBytes: number
  databases: number
  connections: number
  maxConnections: number
}

/** A database server this console connects to (Cloud SQL calls these
 *  instances). Credentials live on the backend; the API reports
 *  hasPassword. */
export interface DatabaseServer {
  id: string
  name: string
  type: DatabaseEngine
  host: string
  port: number
  username: string
  database: string
  sslMode: string
  hasPassword: boolean
  status: 'connected' | 'unreachable' | 'unknown'
  info?: DatabaseServerInfo
  error?: string
  createdAt: string
}

export interface DatabaseServerRequest {
  name: string
  type: DatabaseEngine
  host: string
  port: number
  username: string
  password: string
  database: string
  sslMode: string
}

export interface Database {
  serverId: string
  name: string
  owner: string
  sizeBytes: number
  encoding: string
  collation: string
  connections: number
  /** Owned by the engine (templates, catalogs) — never dropped here. */
  system: boolean
}

export interface DatabaseUser {
  name: string
  host: string
  canLogin: boolean
  superuser: boolean
  createDb: boolean
  replication: boolean
  memberOf: string[] | null
  connectionLimit: number
  /** Ships with the server (mysql.sys and friends) — not droppable. */
  system: boolean
}

export interface DatabaseConnection {
  pid: number
  user: string
  database: string
  clientAddr: string
  appName: string
  state: string
  query: string
  seconds: number
}

/** A record set is saved whole: the values replace what's there. */
export interface DNSRecordSetRequest {
  name: string
  type: string
  ttl: number
  proxied: boolean
  comment?: string
  values: { content: string; priority: number }[]
}

/** Guest configuration handed to cloud-init. */
export interface CloudInitConfig {
  user: string
  password: string
  sshKeys: string
  nameservers: string
  searchDomain: string
  upgradePackages: boolean
  datasource: string
  dhcp: boolean
  address: string
  gateway: string
  ipv6Mode: 'none' | 'dhcp' | 'slaac' | 'static'
  address6: string
  gateway6: string
}

export const emptyCloudInit: CloudInitConfig = {
  user: '',
  password: '',
  sshKeys: '',
  nameservers: '',
  searchDomain: '',
  upgradePackages: false,
  datasource: '',
  dhcp: true,
  address: '',
  gateway: '',
  ipv6Mode: 'none',
  address6: '',
  gateway6: '',
}

export interface CreateInstanceRequest {
  name: string
  hypervisorId: string
  node: string
  /** Datastore for the clone's disks. Empty inherits the template's. */
  storage?: string
  cpus: number
  memoryMb: number
  diskGb?: number
  imageId: string
  netBridge?: string
  vlanTag?: number
  cloudInit: CloudInitConfig
  description?: string
  /** Written to SMBIOS at creation; read by inventory as hardware_serial. */
  serial?: string
  protected?: boolean
}

/**
 * Thrown on a 401 so callers can tell "signed out" from "went wrong".
 * The shell watches for it and sends you to the sign-in page rather
 * than papering the console with error alerts.
 */
export class UnauthorizedError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData sets its own Content-Type, boundary and all. Forcing JSON
  // over it produces a body the server can't parse.
  const multipart = init?.body instanceof FormData
  const res = await fetch(`/api/v1${path}`, {
    headers: multipart ? undefined : { 'Content-Type': 'application/json' },
    // The session is an HttpOnly cookie; without this it isn't sent.
    credentials: 'same-origin',
    ...init,
  })
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = await res.json()
      if (body.error) message = body.error
    } catch {
      // non-JSON error body; keep statusText
    }
    if (res.status === 401) throw new UnauthorizedError(message)
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

/**
 * Uploads a file with progress. XHR rather than fetch, which can't
 * report upload progress on multi-GB images.
 */
/** Same shape as uploadStream, without a hypervisor's parameters. */
function uploadInstallerStream(file: File, onProgress: (fraction: number) => void) {
  return new Promise<Installer>((resolve, reject) => {
    const query = new URLSearchParams({ filename: file.name })
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/v1/installers?${query}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      let body: unknown
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        body = null
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as Installer)
      } else {
        reject(new Error((body as { error?: string })?.error ?? xhr.statusText ?? 'upload failed'))
      }
    }
    xhr.onerror = () => reject(new Error('network error during upload'))
    xhr.send(file)
  })
}

function uploadStream(
  path: string,
  hypervisorId: string,
  params: { node: string; storage: string; filename: string },
  file: File,
  onProgress: (fraction: number) => void,
) {
  return new Promise<Operation>((resolve, reject) => {
    const query = new URLSearchParams({ server: hypervisorId, ...params })
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/v1${path}?${query}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      let body: unknown
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        body = null
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as Operation)
      } else {
        reject(new Error((body as { error?: string })?.error ?? xhr.statusText ?? 'upload failed'))
      }
    }
    xhr.onerror = () => reject(new Error('network error during upload'))
    xhr.send(file)
  })
}

/** The request log's filters, as a query string. Empty values are
 *  dropped so an untouched filter doesn't narrow anything. */
function aiQuery(q: AIRequestQuery): string {
  const params = new URLSearchParams()
  if (q.limit) params.set('limit', String(q.limit))
  if (q.offset) params.set('offset', String(q.offset))
  if (q.sortBy) params.set('sortBy', q.sortBy)
  if (q.order) params.set('order', q.order)
  if (q.providers?.length) params.set('providers', q.providers.join(','))
  if (q.models?.length) params.set('models', q.models.join(','))
  if (q.callers?.length) params.set('callers', q.callers.join(','))
  if (q.status) params.set('status', q.status)
  if (q.search) params.set('search', q.search)
  if (q.since) params.set('since', q.since)
  if (q.until) params.set('until', q.until)
  return params.toString()
}

export const api = {
  // --- sign-in and this console's own accounts ---
  login: (email: string, password: string) =>
    request<IAMUser>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<IAMUser>('/auth/me'),
  changeOwnPassword: (currentPassword: string, newPassword: string) =>
    request<void>('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  mySSHKey: () => request<SSHKey>('/ssh-key'),
  rotateMySSHKey: () => request<SSHKey>('/ssh-key/rotate', { method: 'POST' }),
  importMySSHKey: (privateKey: string, passphrase: string) =>
    request<SSHKey>('/ssh-key', {
      method: 'PUT',
      body: JSON.stringify({ privateKey, passphrase }),
    }),
  authProviders: () => request<AuthProviders>('/auth/providers'),
  getOIDC: () => request<OIDCProvider>('/iam/oidc'),
  saveOIDC: (body: OIDCRequest) =>
    request<OIDCProvider>('/iam/oidc', { method: 'PUT', body: JSON.stringify(body) }),
  deleteOIDC: () => request<void>('/iam/oidc', { method: 'DELETE' }),
  listRoles: () => request<Role[]>('/iam/roles'),
  listIAMUsers: () => request<IAMUser[]>('/iam/users'),
  getIAMUser: (id: string) => request<IAMUser>(`/iam/users/${id}`),
  createIAMUser: (body: IAMUserRequest) =>
    request<IAMUser>('/iam/users', { method: 'POST', body: JSON.stringify(body) }),
  updateIAMUser: (id: string, body: IAMUserRequest) =>
    request<IAMUser>(`/iam/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteIAMUser: (id: string) => request<void>(`/iam/users/${id}`, { method: 'DELETE' }),
  setIAMUserPassword: (id: string, password: string) =>
    request<void>(`/iam/users/${id}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    }),

  // Catalog listings span every server; pass a server id to narrow
  // (the create flows do, since placement is per-server).
  listNodes: (hypervisorId?: string) =>
    request<Node[]>(hypervisorId ? `/nodes?hypervisor=${hypervisorId}` : '/nodes'),
  /** One host in detail — read on demand, never polled at list speed. */
  getNode: (hypervisorId: string, node: string) =>
    request<NodeStatus>(`/nodes/${encodeURIComponent(node)}?hypervisor=${hypervisorId}`),
  nodeMetrics: (hypervisorId: string, node: string, timeframe: MetricTimeframe) =>
    request<MetricPoint[]>(
      `/nodes/${encodeURIComponent(node)}/metrics?hypervisor=${hypervisorId}&timeframe=${timeframe}`,
    ),
  listBridges: () => request<Bridge[]>('/bridges'),
  listImages: (hypervisorId?: string) =>
    request<Image[]>(hypervisorId ? `/images?hypervisor=${hypervisorId}` : '/images'),
  /** A template's own configuration — what a clone of it inherits. */
  describeImage: (hypervisorId: string, imageId: string) =>
    request<InstanceDetail>(`/images/${imageId}?hypervisor=${hypervisorId}`),
  listDisks: () => request<Disk[]>('/disks'),
  listSnapshots: () => request<Snapshot[]>('/snapshots'),
  listISOs: () => request<ISO[]>('/isos'),
  downloadISO: (hypervisorId: string, body: ISODownloadRequest) =>
    request<Operation>(`/isos/download?hypervisor=${hypervisorId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Streams a file to the hypervisor with progress. */
  uploadISO: (
    hypervisorId: string,
    params: { node: string; storage: string; filename: string },
    file: File,
    onProgress: (fraction: number) => void,
  ) => uploadStream('/isos/upload', hypervisorId, params, file, onProgress),
  deleteISO: (hypervisorId: string, node: string, volume: string) => {
    const query = new URLSearchParams({ server: hypervisorId, node, volume })
    return request<Operation>(`/isos?${query}`, { method: 'DELETE' })
  },
  deleteCTTemplate: (hypervisorId: string, node: string, volume: string) => {
    const query = new URLSearchParams({ server: hypervisorId, node, volume })
    return request<Operation>(`/ct-templates?${query}`, { method: 'DELETE' })
  },
  setImageDescription: (hypervisorId: string, imageId: string, description: string) =>
    request<void>(`/images/${imageId}/description?hypervisor=${hypervisorId}`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    }),
  /** Destroys the template VM itself, not a file. */
  deleteImage: (hypervisorId: string, imageId: string) =>
    request<Operation>(`/images/${imageId}?hypervisor=${hypervisorId}`, {
      method: 'DELETE',
    }),
  listCTTemplates: () => request<CTTemplate[]>('/ct-templates'),
  listCloudImages: () => request<CloudImage[]>('/cloud-images'),
  downloadCloudImage: (hypervisorId: string, body: ISODownloadRequest) =>
    request<Operation>(`/cloud-images/download?hypervisor=${hypervisorId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  uploadCloudImage: (
    hypervisorId: string,
    params: { node: string; storage: string; filename: string },
    file: File,
    onProgress: (fraction: number) => void,
  ) => uploadStream('/cloud-images/upload', hypervisorId, params, file, onProgress),
  deleteCloudImage: (hypervisorId: string, node: string, volume: string) => {
    const query = new URLSearchParams({ server: hypervisorId, node, volume })
    return request<Operation>(`/cloud-images?${query}`, { method: 'DELETE' })
  },
  buildTemplate: (hypervisorId: string, body: TemplateBuildRequest) =>
    request<Operation>(`/vm-templates/build?hypervisor=${hypervisorId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listDatastores: () => request<Datastore[]>('/datastores'),

  overview: () => request<Overview>('/overview'),

  /** What the inventory service knows about this guest's insides. */
  instanceInventory: (name: string) =>
    request<InstanceInventory>(`/instances/${name}/inventory`),

  listShortcuts: () => request<Shortcut[]>('/shortcuts'),
  createShortcut: (body: ShortcutInput) =>
    request<Shortcut>('/shortcuts', { method: 'POST', body: JSON.stringify(body) }),
  updateShortcut: (id: string, body: ShortcutInput) =>
    request<Shortcut>(`/shortcuts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteShortcut: (id: string) => request<void>(`/shortcuts/${id}`, { method: 'DELETE' }),
  /** The whole arrangement at once — see SetShortcutOrder. */
  reorderShortcuts: (ids: string[]) =>
    request<void>('/shortcuts/order', { method: 'PUT', body: JSON.stringify(ids) }),
  uploadShortcutIcon: (id: string, file: File) =>
    request<Shortcut>(`/shortcuts/${id}/icon?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    }),
  deleteShortcutIcon: (id: string) =>
    request<void>(`/shortcuts/${id}/icon`, { method: 'DELETE' }),

  listInstallers: () => request<Installers>('/installers'),
  /** Streams the file with progress; the bytes leave this machine. */
  uploadInstaller: (file: File, onProgress: (fraction: number) => void) =>
    uploadInstallerStream(file, onProgress),
  deleteInstaller: (name: string) =>
    request<void>(`/installers/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  rotateInstallerToken: () =>
    request<{ token: string }>('/installers/token/rotate', { method: 'POST' }),

  securityOverview: () => request<SecurityOverview>('/security/overview'),
  listInventoryHosts: () => request<InventoryHosts>('/inventory/hosts'),
  /** One machine in full: its facts, packages and CVEs. */
  inventoryHost: (id: string) => request<InventoryHostDetail>(`/inventory/hosts/${id}`),
  listInventoryVulnerabilities: () =>
    request<InventoryVulnerabilities>('/inventory/vulnerabilities'),
  /** One CVE: who has it, and what to upgrade. */
  inventoryVulnerability: (cve: string) =>
    request<VulnerabilityDetail>(`/inventory/vulnerabilities/${encodeURIComponent(cve)}`),
  enrichmentStatus: () => request<EnrichmentStatus>('/inventory/enrichment'),
  /** Blank keeps the stored key; removal has to be asked for. */
  setNVDAPIKey: (key: string, remove = false) =>
    request<void>('/inventory/enrichment/key', {
      method: 'PUT',
      body: JSON.stringify({ key, remove }),
    }),
  setEnrichmentEnabled: (enabled: boolean) =>
    request<void>('/inventory/enrichment/enabled', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  listInventoryProviderTypes: () => request<string[]>('/inventory/provider-types'),
  listInventoryProviders: () => request<InventoryProvider[]>('/inventory/providers'),
  createInventoryProvider: (body: InventoryProviderRequest) =>
    request<InventoryProvider>('/inventory/providers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateInventoryProvider: (id: string, body: InventoryProviderRequest) =>
    request<InventoryProvider>(`/inventory/providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteInventoryProvider: (id: string) =>
    request<void>(`/inventory/providers/${id}`, { method: 'DELETE' }),

  /** Section ids pinned to the top of the global menu, per account. */
  listFavorites: () => request<string[]>('/favorites'),
  setFavorites: (ids: string[]) =>
    request<string[]>('/favorites', { method: 'PUT', body: JSON.stringify(ids) }),

  listAIAccountTypes: () => request<string[]>('/ai/account-types'),
  listAIAccounts: () => request<AIAccount[]>('/ai/accounts'),
  createAIAccount: (body: AIAccountRequest) =>
    request<AIAccount>('/ai/accounts', { method: 'POST', body: JSON.stringify(body) }),
  updateAIAccount: (id: string, body: AIAccountRequest) =>
    request<AIAccount>(`/ai/accounts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteAIAccount: (id: string) => request<void>(`/ai/accounts/${id}`, { method: 'DELETE' }),

  listMonitoringProviderTypes: () => request<string[]>('/monitoring/provider-types'),
  listMonitoringProviders: () => request<MonitoringProvider[]>('/monitoring/providers'),
  createMonitoringProvider: (body: MonitoringProviderRequest) =>
    request<MonitoringProvider>('/monitoring/providers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateMonitoringProvider: (id: string, body: MonitoringProviderRequest) =>
    request<MonitoringProvider>(`/monitoring/providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteMonitoringProvider: (id: string) =>
    request<void>(`/monitoring/providers/${id}`, { method: 'DELETE' }),
  listMonitoringProblems: () => request<MonitoringProblem[]>('/monitoring/problems'),
  listMonitoringHosts: () => request<MonitoringHostsResponse>('/monitoring/hosts'),

  listAIGatewayTypes: () => request<string[]>('/ai/gateway-types'),
  listAIGateways: () => request<AIGateway[]>('/ai/gateways'),
  createAIGateway: (body: AIGatewayRequest) =>
    request<AIGateway>('/ai/gateways', { method: 'POST', body: JSON.stringify(body) }),
  updateAIGateway: (id: string, body: AIGatewayRequest) =>
    request<AIGateway>(`/ai/gateways/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteAIGateway: (id: string) => request<void>(`/ai/gateways/${id}`, { method: 'DELETE' }),
  listAIRequests: (query: AIRequestQuery) =>
    request<AIRequestPage>(`/ai/requests?${aiQuery(query)}`),
  getAIRequest: (id: string) => request<AIRequestDetail>(`/ai/requests/${encodeURIComponent(id)}`),
  getAIStats: (query: AIRequestQuery) => request<AIStats>(`/ai/stats?${aiQuery(query)}`),
  getAIFilters: () => request<AIFilters>('/ai/filters'),
  listAIGatewayProviders: () => request<AIGatewayProvider[]>('/ai/providers'),
  listAIVirtualKeys: (query: AIRequestQuery = {}) =>
    request<AIVirtualKey[]>(`/ai/virtual-keys?${aiQuery(query)}`),
  listAILimits: () => request<AILimit[]>('/ai/limits'),
  getAITraffic: (query: AIRequestQuery) => request<AITraffic>(`/ai/traffic?${aiQuery(query)}`),
  getAIRankings: (query: AIRequestQuery) =>
    request<AIModelUsage[]>(`/ai/rankings?${aiQuery(query)}`),

  /** Who did what. Reads aren't recorded; see the audit middleware. */
  listAudit: (params: { actor?: string; resource?: string; limit?: number } = {}) => {
    const query = new URLSearchParams()
    if (params.actor) query.set('actor', params.actor)
    if (params.resource) query.set('resource', params.resource)
    if (params.limit) query.set('limit', String(params.limit))
    const suffix = query.toString()
    return request<AuditEntry[]>(`/audit${suffix ? `?${suffix}` : ''}`)
  },

  listOperations: () => request<Operation[]>('/operations'),
  dismissOperation: (id: string) => request<void>(`/operations/${id}`, { method: 'DELETE' }),
  clearOperations: () => request<void>('/operations', { method: 'DELETE' }),

  listHypervisors: () => request<Hypervisor[]>('/hypervisors'),
  createHypervisor: (body: HypervisorRequest) =>
    request<Hypervisor>('/hypervisors', { method: 'POST', body: JSON.stringify(body) }),
  updateHypervisor: (id: string, body: HypervisorRequest) =>
    request<Hypervisor>(`/hypervisors/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteHypervisor: (id: string) =>
    request<void>(`/hypervisors/${id}`, { method: 'DELETE' }),
  listNetworkProviderTypes: () =>
    request<NetworkProviderType[]>('/network/provider-types'),
  importSubnets: (networkIds: string[]) =>
    request<{ created: Subnet[]; existing: number; errors?: string[] }>(
      '/network/subnets/import',
      { method: 'POST', body: JSON.stringify({ networkIds }) },
    ),
  subnetAddresses: (id: string, page: number) =>
    request<AddressPage>(`/network/subnets/${id}/addresses?page=${page}`),
  saveSubnetAddress: (id: string, body: Partial<IPRecord> & { address: string }) =>
    request<IPRecord>(`/network/subnets/${id}/addresses`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteSubnetAddress: (id: string, address: string) =>
    request<void>(`/network/subnets/${id}/addresses/${address}`, { method: 'DELETE' }),
  listSubnets: () => request<Subnet[]>('/network/subnets'),
  getSubnet: (id: string) => request<Subnet>(`/network/subnets/${id}`),
  createSubnet: (body: SubnetRequest) =>
    request<Subnet>('/network/subnets', { method: 'POST', body: JSON.stringify(body) }),
  updateSubnet: (id: string, body: SubnetRequest) =>
    request<Subnet>(`/network/subnets/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSubnet: (id: string) =>
    request<void>(`/network/subnets/${id}`, { method: 'DELETE' }),
  listNetworkProviders: () => request<NetworkProvider[]>('/network/providers'),
  createNetworkProvider: (body: NetworkProviderRequest) =>
    request<NetworkProvider>('/network/providers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateNetworkProvider: (id: string, body: NetworkProviderRequest) =>
    request<NetworkProvider>(`/network/providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteNetworkProvider: (id: string) =>
    request<void>(`/network/providers/${id}`, { method: 'DELETE' }),
  listLabNetworks: (category?: string) =>
    request<LabNetwork[]>(
      `/network/networks${category ? `?category=${encodeURIComponent(category)}` : ''}`,
    ),
  listNetworkClients: () => request<NetworkClient[]>('/network/clients'),

  listIdentityProviderTypes: () =>
    request<IdentityProviderType[]>('/identity/provider-types'),
  listIdentityProviders: () => request<IdentityProvider[]>('/identity/providers'),
  createIdentityProvider: (body: IdentityProviderRequest) =>
    request<IdentityProvider>('/identity/providers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateIdentityProvider: (id: string, body: IdentityProviderRequest) =>
    request<IdentityProvider>(`/identity/providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteIdentityProvider: (id: string) =>
    request<void>(`/identity/providers/${id}`, { method: 'DELETE' }),
  listIdentityUsers: () => request<IdentityUser[]>('/identity/users'),
  createIdentityUser: (body: {
    username: string
    name: string
    email: string
    groups: string[]
  }) =>
    request<IdentityUser & { recoveryLink?: string; recoveryError?: string }>(
      '/identity/users',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  identityUserRecoveryLink: (userId: string) =>
    request<{ link: string }>(`/identity/users/${userId}/recovery`, { method: 'POST' }),
  setIdentityUserActive: (userId: string, active: boolean) =>
    request<void>(`/identity/users/${userId}/active`, {
      method: 'POST',
      body: JSON.stringify({ active }),
    }),
  setIdentityUserPassword: (userId: string, password: string) =>
    request<void>(`/identity/users/${userId}/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  listIdentityGroups: () => request<IdentityGroup[]>('/identity/groups'),
  addIdentityGroupMember: (groupId: string, userId: string) =>
    request<void>(`/identity/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),
  removeIdentityGroupMember: (groupId: string, userId: string) =>
    request<void>(`/identity/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
  listIdentityApplications: () => request<IdentityApplication[]>('/identity/applications'),
  listIdentityEvents: (limit = 100) =>
    request<IdentityEvent[]>(`/identity/events?limit=${limit}`),

  listDatabaseEngines: () => request<DatabaseEngine[]>('/database/engines'),
  listDatabaseServers: () => request<DatabaseServer[]>('/database/servers'),
  getDatabaseServer: (id: string) => request<DatabaseServer>(`/database/servers/${id}`),
  createDatabaseServer: (body: DatabaseServerRequest) =>
    request<DatabaseServer>('/database/servers', { method: 'POST', body: JSON.stringify(body) }),
  updateDatabaseServer: (id: string, body: DatabaseServerRequest) =>
    request<DatabaseServer>(`/database/servers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteDatabaseServer: (id: string) =>
    request<void>(`/database/servers/${id}`, { method: 'DELETE' }),
  listDatabases: (serverId?: string) =>
    request<Database[]>(`/database/databases${serverId ? `?server=${serverId}` : ''}`),
  createDatabase: (serverId: string, body: { name: string; owner?: string }) =>
    request<void>(`/database/servers/${serverId}/databases`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  dropDatabase: (serverId: string, name: string) =>
    request<void>(`/database/servers/${serverId}/databases/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
  listDatabaseUsers: (serverId: string) =>
    request<DatabaseUser[]>(`/database/servers/${serverId}/users`),
  createDatabaseUser: (
    serverId: string,
    body: {
      name: string
      host?: string
      password: string
      canLogin: boolean
      createDb: boolean
    },
  ) =>
    request<void>(`/database/servers/${serverId}/users`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  // host is MySQL's other half of a user identity; ignored elsewhere.
  setDatabaseUserPassword: (
    serverId: string,
    name: string,
    password: string,
    host?: string,
  ) =>
    request<void>(
      `/database/servers/${serverId}/users/${encodeURIComponent(name)}/password${
        host ? `?host=${encodeURIComponent(host)}` : ''
      }`,
      { method: 'PUT', body: JSON.stringify({ password }) },
    ),
  dropDatabaseUser: (serverId: string, name: string, host?: string) =>
    request<void>(
      `/database/servers/${serverId}/users/${encodeURIComponent(name)}${
        host ? `?host=${encodeURIComponent(host)}` : ''
      }`,
      { method: 'DELETE' },
    ),
  listDatabaseTables: (serverId: string, name: string) =>
    request<DatabaseTable[]>(
      `/database/servers/${serverId}/databases/${encodeURIComponent(name)}/tables`,
    ),
  listDatabaseGrants: (serverId: string, name: string) =>
    request<DatabaseGrant[]>(
      `/database/servers/${serverId}/databases/${encodeURIComponent(name)}/grants`,
    ),
  grantDatabaseAccess: (serverId: string, name: string, body: AccessRequest) =>
    request<void>(
      `/database/servers/${serverId}/databases/${encodeURIComponent(name)}/access`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  revokeDatabaseAccess: (serverId: string, name: string, user: string, host: string) =>
    request<void>(
      `/database/servers/${serverId}/databases/${encodeURIComponent(name)}/access` +
        `?user=${encodeURIComponent(user)}&host=${encodeURIComponent(host)}`,
      { method: 'DELETE' },
    ),
  listDatabaseConnections: (serverId: string) =>
    request<DatabaseConnection[]>(`/database/servers/${serverId}/connections`),

  listDNSProviderTypes: () => request<DNSProviderType[]>('/dns/provider-types'),
  listDNSProviders: () => request<DNSProvider[]>('/dns/providers'),
  createDNSProvider: (body: DNSProviderRequest) =>
    request<DNSProvider>('/dns/providers', { method: 'POST', body: JSON.stringify(body) }),
  updateDNSProvider: (id: string, body: DNSProviderRequest) =>
    request<DNSProvider>(`/dns/providers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteDNSProvider: (id: string) =>
    request<void>(`/dns/providers/${id}`, { method: 'DELETE' }),
  listDNSAccounts: (providerId: string) =>
    request<DNSAccount[]>(`/dns/accounts?provider=${providerId}`),
  listDNSZones: () => request<DNSZone[]>('/dns/zones'),
  createDNSZone: (providerId: string, body: { name: string; accountId?: string; type?: string }) =>
    request<DNSZone>(`/dns/zones?provider=${providerId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getDNSZone: (providerId: string, zoneId: string) =>
    request<DNSZone>(`/dns/zones/${zoneId}?provider=${providerId}`),
  getZoneSOA: (providerId: string, zoneId: string) =>
    request<ZoneSOA>(`/dns/zones/${zoneId}/soa?provider=${providerId}`),
  saveZoneSOA: (providerId: string, zoneId: string, body: ZoneSOA) =>
    request<ZoneSOA>(`/dns/zones/${zoneId}/soa?provider=${providerId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  listDNSRecords: (providerId: string, zoneId: string) =>
    request<DNSRecord[]>(`/dns/zones/${zoneId}/records?provider=${providerId}`),
  saveDNSRecordSet: (providerId: string, zoneId: string, body: DNSRecordSetRequest) =>
    request<DNSRecord[]>(`/dns/zones/${zoneId}/record-sets?provider=${providerId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteDNSRecordSet: (providerId: string, zoneId: string, name: string, type: string) =>
    request<void>(
      `/dns/zones/${zoneId}/record-sets?provider=${providerId}&name=${encodeURIComponent(
        name,
      )}&type=${type}`,
      { method: 'DELETE' },
    ),
  deleteDNSZone: (providerId: string, zoneId: string) =>
    request<void>(`/dns/zones/${zoneId}?provider=${providerId}`, { method: 'DELETE' }),

  listBackups: () => request<Backup[]>('/backups'),
  deleteBackup: (hypervisorId: string, node: string, volume: string) =>
    request<Operation>(
      `/backups?hypervisor=${hypervisorId}&node=${encodeURIComponent(node)}&volume=${encodeURIComponent(volume)}`,
      { method: 'DELETE' },
    ),

  listInstances: () => request<Instance[]>('/instances'),
  getInstance: (name: string) => request<Instance>(`/instances/${name}/`),
  describeInstance: (name: string) =>
    request<InstanceDetail>(`/instances/${name}/describe`),
  instanceMetrics: (name: string, timeframe: MetricTimeframe) =>
    request<MetricPoint[]>(`/instances/${name}/metrics?timeframe=${timeframe}`),
  instanceOSInfo: (name: string) => request<OSInfo>(`/instances/${name}/os-info`),
  uploadToInstance: (name: string, file: File, dest: string) => {
    const body = new FormData()
    body.append('file', file)
    if (dest) body.append('path', dest)
    return request<{ path: string; bytes: number }>(
      `/instances/${name}/sftp/upload`,
      { method: 'POST', body },
    )
  },
  /** The browser fetches this directly so the file streams to disk. */
  downloadFromInstanceURL: (name: string, path: string) =>
    `/api/v1/instances/${encodeURIComponent(name)}/sftp/download?path=${encodeURIComponent(path)}`,
  instanceBackups: (name: string) =>
    request<InstanceBackups>(`/instances/${name}/backups`),
  createInstance: (body: CreateInstanceRequest) =>
    request<Operation>('/instances', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Power actions answer with an operation: a stop runs until the
   *  guest is actually down, and the bell is where that gets reported. */
  instanceAction: (name: string, action: 'start' | 'stop' | 'reset') =>
    request<Operation>(`/instances/${name}/${action}`, { method: 'POST' }),
  /** Writes notes to the hypervisor's own description field. */
  renameInstance: (name: string, newName: string) =>
    request<Instance>(`/instances/${name}/rename`, {
      method: 'POST',
      body: JSON.stringify({ name: newName }),
    }),
  setInstanceDescription: (name: string, description: string) =>
    request<Instance>(`/instances/${name}/description`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    }),
  /**
   * Disks on an instance that already exists. All four are synchronous:
   * the driver waits for the hypervisor's task before answering, so the
   * panel can refetch and show the result rather than guessing.
   */
  addInstanceDisk: (name: string, body: { storage: string; sizeGb: number }) =>
    request<{ disk: string }>(`/instances/${encodeURIComponent(name)}/disks`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resizeInstanceDisk: (name: string, disk: string, sizeGb: number) =>
    request<void>(
      `/instances/${encodeURIComponent(name)}/disks/${encodeURIComponent(disk)}/resize`,
      { method: 'POST', body: JSON.stringify({ sizeGb }) },
    ),
  /** Puts an unused volume back into a slot; `disk` is its unusedN key. */
  attachInstanceDisk: (name: string, disk: string) =>
    request<{ disk: string }>(
      `/instances/${encodeURIComponent(name)}/disks/${encodeURIComponent(disk)}/attach`,
      { method: 'POST' },
    ),
  /** Takes a disk out of its slot. The volume is kept, as unusedN. */
  detachInstanceDisk: (name: string, disk: string) =>
    request<void>(
      `/instances/${encodeURIComponent(name)}/disks/${encodeURIComponent(disk)}/detach`,
      { method: 'POST' },
    ),
  /** Destroys an unattached volume. Detach first; this one is final. */
  deleteInstanceDisk: (name: string, disk: string) =>
    request<void>(
      `/instances/${encodeURIComponent(name)}/disks/${encodeURIComponent(disk)}`,
      { method: 'DELETE' },
    ),
  /** Changes vCPU and memory. The instance has to be stopped. */
  resizeInstance: (name: string, body: { cpus: number; memoryMb: number }) =>
    request<void>(`/instances/${encodeURIComponent(name)}/resize`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Snapshots answer with an operation: writing a running guest's RAM
   *  out to disk, and reading it back on a rollback, is minutes of work
   *  that no form should sit and wait for. */
  createInstanceSnapshot: (name: string, body: { name: string; description?: string }) =>
    request<Operation>(`/instances/${encodeURIComponent(name)}/snapshots`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Returns the guest to a snapshot, discarding everything since. */
  rollbackInstanceSnapshot: (name: string, snapshot: string) =>
    request<Operation>(
      `/instances/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(snapshot)}/rollback`,
      { method: 'POST' },
    ),
  deleteInstanceSnapshot: (name: string, snapshot: string) =>
    request<Operation>(
      `/instances/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(snapshot)}`,
      { method: 'DELETE' },
    ),
  setInstanceProtection: (name: string, protectedFlag: boolean) =>
    request<Instance>(`/instances/${name}/protection`, {
      method: 'POST',
      body: JSON.stringify({ protected: protectedFlag }),
    }),

  createContainer: (body: ContainerRequest) =>
    request<Operation>('/containers', { method: 'POST', body: JSON.stringify(body) }),
  listStorageProviderTypes: () => request<StorageProviderType[]>('/storage/provider-types'),
  listStorageProviders: () => request<StorageProvider[]>('/storage/providers'),
  createStorageProvider: (body: StorageProviderRequest) =>
    request<StorageProvider>('/storage/providers', { method: 'POST', body: JSON.stringify(body) }),
  updateStorageProvider: (id: string, body: StorageProviderRequest) =>
    request<StorageProvider>(`/storage/providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteStorageProvider: (id: string) =>
    request<void>(`/storage/providers/${id}`, { method: 'DELETE' }),

  listBuckets: (providerId?: string) =>
    request<Bucket[]>(providerId ? `/storage/buckets?provider=${providerId}` : '/storage/buckets'),
  createBucket: (providerId: string, body: { name: string }) =>
    request<{ name: string }>(`/storage/buckets?provider=${providerId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** 0 removes the quota. 409 where the store has none. */
  setBucketQuota: (providerId: string, bucket: string, bytes: number) =>
    request<void>(`/storage/buckets/${bucket}/quota?provider=${providerId}`, {
      method: 'PUT',
      body: JSON.stringify({ bytes }),
    }),
  deleteBucket: (providerId: string, bucket: string) =>
    request<void>(`/storage/buckets/${bucket}?provider=${providerId}`, { method: 'DELETE' }),
  listObjects: (
    providerId: string,
    bucket: string,
    opts: { prefix?: string; delimiter?: string; token?: string; limit?: number } = {},
  ) => {
    const q = new URLSearchParams({ provider: providerId })
    if (opts.prefix) q.set('prefix', opts.prefix)
    // An empty delimiter is meaningful — it flattens the listing — so it
    // is sent when supplied rather than skipped as falsy.
    if (opts.delimiter !== undefined) q.set('delimiter', opts.delimiter)
    if (opts.token) q.set('token', opts.token)
    if (opts.limit) q.set('limit', String(opts.limit))
    return request<ObjectPage>(`/storage/buckets/${bucket}/objects?${q}`)
  },
  /** The URL a browser downloads from; the session cookie carries auth. */
  objectDownloadURL: (providerId: string, bucket: string, key: string) =>
    `/api/v1/storage/buckets/${bucket}/object?provider=${providerId}&key=${encodeURIComponent(key)}`,
  uploadObject: (providerId: string, bucket: string, key: string, file: File) =>
    request<{ key: string; sizeBytes: number }>(
      `/storage/buckets/${bucket}/objects?provider=${providerId}&key=${encodeURIComponent(key)}`,
      { method: 'POST', body: file },
    ),
  deleteObject: (providerId: string, bucket: string, key: string) =>
    request<void>(
      `/storage/buckets/${bucket}/object?provider=${providerId}&key=${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    ),
  bucketPermissions: (providerId: string, bucket: string) =>
    request<BucketPermissions>(`/storage/buckets/${bucket}/permissions?provider=${providerId}`),
  grantBucketPublic: (
    providerId: string,
    bucket: string,
    body: { prefix: string; allowList: boolean },
  ) =>
    request<void>(`/storage/buckets/${bucket}/public?provider=${providerId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  revokeBucketPublic: (providerId: string, bucket: string) =>
    request<void>(`/storage/buckets/${bucket}/public?provider=${providerId}`, {
      method: 'DELETE',
    }),
  listStorageUsers: (providerId?: string) =>
    request<StorageUser[]>(
      providerId ? `/storage/users?provider=${providerId}` : '/storage/users',
    ),
  listStoragePolicies: (providerId: string) =>
    request<StoragePolicy[]>(`/storage/policies?provider=${providerId}`),
  createStorageUser: (
    providerId: string,
    body: { accessKey: string; secretKey: string; policy: string },
  ) =>
    request<{ accessKey: string }>(`/storage/users?provider=${providerId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setStorageUserSecret: (providerId: string, accessKey: string, secretKey: string) =>
    request<void>(
      `/storage/users/${encodeURIComponent(accessKey)}/secret?provider=${providerId}`,
      { method: 'PUT', body: JSON.stringify({ secretKey }) },
    ),
  setStorageUserStatus: (providerId: string, accessKey: string, enabled: boolean) =>
    request<void>(
      `/storage/users/${encodeURIComponent(accessKey)}/status?provider=${providerId}`,
      { method: 'PUT', body: JSON.stringify({ enabled }) },
    ),
  /** An empty policy unbinds, leaving a key with no permissions. */
  setStorageUserPolicy: (providerId: string, accessKey: string, policy: string) =>
    request<void>(
      `/storage/users/${encodeURIComponent(accessKey)}/policy?provider=${providerId}`,
      { method: 'PUT', body: JSON.stringify({ policy }) },
    ),
  deleteStorageUser: (providerId: string, accessKey: string) =>
    request<void>(
      `/storage/users/${encodeURIComponent(accessKey)}?provider=${providerId}`,
      { method: 'DELETE' },
    ),
  listContainers: () => request<Container[]>('/containers'),
  getContainer: (name: string) => request<Container>(`/containers/${name}/`),
  containerAction: (name: string, action: 'start' | 'stop' | 'reset') =>
    request<Operation>(`/containers/${name}/${action}`, { method: 'POST' }),
  deleteContainer: (name: string) =>
    request<void>(`/containers/${name}/`, { method: 'DELETE' }),
  setContainerProtection: (name: string, protectedFlag: boolean) =>
    request<Container>(`/containers/${name}/protection`, {
      method: 'POST',
      body: JSON.stringify({ protected: protectedFlag }),
    }),
  deleteInstance: (name: string) =>
    request<void>(`/instances/${name}/`, { method: 'DELETE' }),
}
