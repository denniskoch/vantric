// Typed client for the lab-cloud-manager REST API.

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
  /** True when it comes from LCM_SITE_URL rather than being guessed. */
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
  serverId: string
  zone: string
  cpus: number
  memoryMb: number
  diskGb: number
  imageId: string
  status: InstanceStatus
  driverId: string
  internalIp: string
  externalIp: string
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
  zone: string
  status: InstanceStatus
  cpus: number
  memoryMb: number
  diskGb: number
  internalIp: string
  externalIp: string
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
  createdAt: number
  uptimeSeconds: number
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
  serverId: string
  zone: string
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

export type ServerType = 'proxmox' | 'mock'

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
  zone: string
  serverId: string
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
  package: string
  installedVersion: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL'
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
  version: string
  source: string
  vulnerabilities: Vulnerability[] | null
}

export interface InventoryHost {
  id: string
  hostname: string
  uuid: string
  serial: string
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
  cvssScore: number
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL'
  epss: number
  knownExploited: boolean
  publishedAt: number
  detailsUrl: string
}

export interface InventoryVulnerabilities {
  configured: boolean
  /** False when connected but the service can't answer — a missing
   *  feature, not a broken connection. */
  supported: boolean
  vulnerabilities: VulnerabilitySummary[]
  error?: string
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

export interface Server {
  id: string
  name: string
  type: ServerType
  baseUrl: string
  tokenId: string
  insecureTls: boolean
  hasSecret: boolean
  status: 'connected' | 'unreachable' | 'unknown'
  nodes: number
  error?: string
  createdAt: string
}

export interface ServerRequest {
  name: string
  type: ServerType
  baseUrl: string
  tokenId: string
  secret: string
  insecureTls: boolean
}

export interface Zone {
  id: string
  name: string
  status: string
}

export interface Image {
  serverId: string
  id: string
  name: string
  zone: string
  /** The hypervisor's notes. Its first line is the friendly name. */
  description: string
  tags: string[] | null
  architecture: string
  /** unix seconds; 0 when the hypervisor doesn't record it */
  createdAt: number
}

export interface Disk {
  serverId: string
  id: string
  name: string
  inUseBy: string
  zone: string
  storage: string
  sizeGb: number
}

export interface Snapshot {
  serverId: string
  id: string
  name: string
  vmName: string
  zone: string
  description: string
  createdAt: number
  includesRam: boolean
}

export interface ISO {
  serverId: string
  id: string
  name: string
  zone: string
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
  serverId: string
  id: string
  name: string
  zone: string
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

export interface TemplateBuildRequest {
  name: string
  zone: string
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
  serverId?: string
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
  serverId: string
  name: string
  zone: string
  cidr: string
  comment: string
  active: boolean
  vlanAware: boolean
  ports: string
}

export interface Datastore {
  serverId: string
  id: string
  name: string
  zone: string
  type: string
  content: string
  totalBytes: number
  usedBytes: number
  active: boolean
  shared: boolean
}

export interface ISODownloadRequest {
  zone: string
  storage: string
  filename: string
  url: string
  checksum?: string
  checksumAlgorithm?: string
  verifyCertificates: boolean
}

export type DNSProviderType = 'cloudflare'

export interface DNSProvider {
  id: string
  name: string
  type: DNSProviderType
  accountId: string
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
  serverId: string
  zone: string
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
  const res = await fetch(`/api/v1${path}`, {
    headers: { 'Content-Type': 'application/json' },
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
function uploadStream(
  path: string,
  serverId: string,
  params: { zone: string; storage: string; filename: string },
  file: File,
  onProgress: (fraction: number) => void,
) {
  return new Promise<Operation>((resolve, reject) => {
    const query = new URLSearchParams({ server: serverId, ...params })
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
  listZones: (serverId: string) => request<Zone[]>(`/zones?server=${serverId}`),
  listBridges: () => request<Bridge[]>('/bridges'),
  listImages: (serverId?: string) =>
    request<Image[]>(serverId ? `/images?server=${serverId}` : '/images'),
  /** A template's own configuration — what a clone of it inherits. */
  describeImage: (serverId: string, imageId: string) =>
    request<InstanceDetail>(`/images/${imageId}?server=${serverId}`),
  listDisks: () => request<Disk[]>('/disks'),
  listSnapshots: () => request<Snapshot[]>('/snapshots'),
  listISOs: () => request<ISO[]>('/isos'),
  downloadISO: (serverId: string, body: ISODownloadRequest) =>
    request<Operation>(`/isos/download?server=${serverId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Streams a file to the hypervisor with progress. */
  uploadISO: (
    serverId: string,
    params: { zone: string; storage: string; filename: string },
    file: File,
    onProgress: (fraction: number) => void,
  ) => uploadStream('/isos/upload', serverId, params, file, onProgress),
  deleteISO: (serverId: string, zone: string, volume: string) => {
    const query = new URLSearchParams({ server: serverId, zone, volume })
    return request<Operation>(`/isos?${query}`, { method: 'DELETE' })
  },
  deleteCTTemplate: (serverId: string, zone: string, volume: string) => {
    const query = new URLSearchParams({ server: serverId, zone, volume })
    return request<Operation>(`/ct-templates?${query}`, { method: 'DELETE' })
  },
  setImageDescription: (serverId: string, imageId: string, description: string) =>
    request<void>(`/images/${imageId}/description?server=${serverId}`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    }),
  /** Destroys the template VM itself, not a file. */
  deleteImage: (serverId: string, imageId: string) =>
    request<Operation>(`/images/${imageId}?server=${serverId}`, {
      method: 'DELETE',
    }),
  listCTTemplates: () => request<CTTemplate[]>('/ct-templates'),
  listCloudImages: () => request<CloudImage[]>('/cloud-images'),
  downloadCloudImage: (serverId: string, body: ISODownloadRequest) =>
    request<Operation>(`/cloud-images/download?server=${serverId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  uploadCloudImage: (
    serverId: string,
    params: { zone: string; storage: string; filename: string },
    file: File,
    onProgress: (fraction: number) => void,
  ) => uploadStream('/cloud-images/upload', serverId, params, file, onProgress),
  deleteCloudImage: (serverId: string, zone: string, volume: string) => {
    const query = new URLSearchParams({ server: serverId, zone, volume })
    return request<Operation>(`/cloud-images?${query}`, { method: 'DELETE' })
  },
  buildTemplate: (serverId: string, body: TemplateBuildRequest) =>
    request<Operation>(`/vm-templates/build?server=${serverId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listDatastores: () => request<Datastore[]>('/datastores'),

  overview: () => request<Overview>('/overview'),

  /** What the inventory service knows about this guest's insides. */
  instanceInventory: (name: string) =>
    request<InstanceInventory>(`/instances/${name}/inventory`),

  listInventoryHosts: () => request<InventoryHosts>('/inventory/hosts'),
  /** One machine in full: its facts, packages and CVEs. */
  inventoryHost: (id: string) => request<InventoryHostDetail>(`/inventory/hosts/${id}`),
  listInventoryVulnerabilities: () =>
    request<InventoryVulnerabilities>('/inventory/vulnerabilities'),
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

  listOperations: () => request<Operation[]>('/operations'),
  dismissOperation: (id: string) => request<void>(`/operations/${id}`, { method: 'DELETE' }),
  clearOperations: () => request<void>('/operations', { method: 'DELETE' }),

  listServers: () => request<Server[]>('/servers'),
  createServer: (body: ServerRequest) =>
    request<Server>('/servers', { method: 'POST', body: JSON.stringify(body) }),
  updateServer: (id: string, body: ServerRequest) =>
    request<Server>(`/servers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteServer: (id: string) =>
    request<void>(`/servers/${id}`, { method: 'DELETE' }),
  listNetworkProviderTypes: () =>
    request<NetworkProviderType[]>('/network/provider-types'),
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
  listNetworkSites: () => request<NetworkSite[]>('/network/sites'),
  listLabNetworks: (category?: string) =>
    request<LabNetwork[]>(
      `/network/networks${category ? `?category=${encodeURIComponent(category)}` : ''}`,
    ),
  listNetworkWiFi: () => request<NetworkWiFi[]>('/network/wifi'),
  listNetworkClients: () => request<NetworkClient[]>('/network/clients'),
  listNetworkDevices: () => request<NetworkDevice[]>('/network/devices'),

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
  deleteBackup: (serverId: string, zone: string, volume: string) =>
    request<Operation>(
      `/backups?server=${serverId}&zone=${encodeURIComponent(zone)}&volume=${encodeURIComponent(volume)}`,
      { method: 'DELETE' },
    ),

  listInstances: () => request<Instance[]>('/instances'),
  getInstance: (name: string) => request<Instance>(`/instances/${name}/`),
  describeInstance: (name: string) =>
    request<InstanceDetail>(`/instances/${name}/describe`),
  instanceMetrics: (name: string, timeframe: MetricTimeframe) =>
    request<MetricPoint[]>(`/instances/${name}/metrics?timeframe=${timeframe}`),
  instanceOSInfo: (name: string) => request<OSInfo>(`/instances/${name}/os-info`),
  createInstance: (body: CreateInstanceRequest) =>
    request<Operation>('/instances', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  instanceAction: (name: string, action: 'start' | 'stop' | 'reset') =>
    request<Instance>(`/instances/${name}/${action}`, { method: 'POST' }),
  /** Writes notes to the hypervisor's own description field. */
  setInstanceDescription: (name: string, description: string) =>
    request<Instance>(`/instances/${name}/description`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    }),
  setInstanceProtection: (name: string, protectedFlag: boolean) =>
    request<Instance>(`/instances/${name}/protection`, {
      method: 'POST',
      body: JSON.stringify({ protected: protectedFlag }),
    }),

  listContainers: () => request<Container[]>('/containers'),
  getContainer: (name: string) => request<Container>(`/containers/${name}/`),
  containerAction: (name: string, action: 'start' | 'stop' | 'reset') =>
    request<Container>(`/containers/${name}/${action}`, { method: 'POST' }),
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
