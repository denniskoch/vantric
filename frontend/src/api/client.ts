// Typed client for the lab-cloud-manager REST API.

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
  machineType: string
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
  description: string
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

export interface TemplateBuild {
  id: string
  name: string
  serverId: string
  step: string
  steps: string[]
  running: boolean
  imageId: string
  error: string
  startedAt: string
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

export interface TaskStatus {
  id: string
  status: string
  exitStatus: string
  running: boolean
  succeeded: boolean
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

export interface MachineType {
  name: string
  description: string
  cpus: number
  memoryMb: number
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
  machineType: string
  cpus?: number
  memoryMb?: number
  diskGb?: number
  imageId: string
  netBridge?: string
  vlanTag?: number
  cloudInit: CloudInitConfig
  description?: string
  protected?: boolean
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    headers: { 'Content-Type': 'application/json' },
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
  return new Promise<{ taskId: string }>((resolve, reject) => {
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
        resolve(body as { taskId: string })
      } else {
        reject(new Error((body as { error?: string })?.error ?? xhr.statusText ?? 'upload failed'))
      }
    }
    xhr.onerror = () => reject(new Error('network error during upload'))
    xhr.send(file)
  })
}

export const api = {
  // Catalog listings span every server; pass a server id to narrow
  // (the create flows do, since placement is per-server).
  listZones: (serverId: string) => request<Zone[]>(`/zones?server=${serverId}`),
  listBridges: () => request<Bridge[]>('/bridges'),
  listImages: (serverId?: string) =>
    request<Image[]>(serverId ? `/images?server=${serverId}` : '/images'),
  listDisks: () => request<Disk[]>('/disks'),
  listSnapshots: () => request<Snapshot[]>('/snapshots'),
  listISOs: () => request<ISO[]>('/isos'),
  downloadISO: (serverId: string, body: ISODownloadRequest) =>
    request<{ taskId: string }>(`/isos/download?server=${serverId}`, {
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
    return request<{ taskId: string }>(`/isos?${query}`, { method: 'DELETE' })
  },
  deleteCTTemplate: (serverId: string, zone: string, volume: string) => {
    const query = new URLSearchParams({ server: serverId, zone, volume })
    return request<{ taskId: string }>(`/ct-templates?${query}`, { method: 'DELETE' })
  },
  /** Destroys the template VM itself, not a file. */
  deleteImage: (serverId: string, imageId: string) =>
    request<{ taskId: string }>(`/images/${imageId}?server=${serverId}`, {
      method: 'DELETE',
    }),
  getTask: (serverId: string, taskId: string) =>
    request<TaskStatus>(`/tasks/${encodeURIComponent(taskId)}?server=${serverId}`),
  listCTTemplates: () => request<CTTemplate[]>('/ct-templates'),
  listCloudImages: () => request<CloudImage[]>('/cloud-images'),
  downloadCloudImage: (serverId: string, body: ISODownloadRequest) =>
    request<{ taskId: string }>(`/cloud-images/download?server=${serverId}`, {
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
    return request<{ taskId: string }>(`/cloud-images?${query}`, { method: 'DELETE' })
  },
  buildTemplate: (serverId: string, body: TemplateBuildRequest) =>
    request<TemplateBuild>(`/vm-templates/build?server=${serverId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getTemplateBuild: (id: string) => request<TemplateBuild>(`/vm-templates/builds/${id}`),
  listDatastores: () => request<Datastore[]>('/datastores'),

  listServers: () => request<Server[]>('/servers'),
  createServer: (body: ServerRequest) =>
    request<Server>('/servers', { method: 'POST', body: JSON.stringify(body) }),
  updateServer: (id: string, body: ServerRequest) =>
    request<Server>(`/servers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteServer: (id: string) =>
    request<void>(`/servers/${id}`, { method: 'DELETE' }),
  listMachineTypes: () => request<MachineType[]>('/machine-types'),
  createMachineType: (body: MachineType) =>
    request<MachineType>('/machine-types', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteMachineType: (name: string) =>
    request<void>(`/machine-types/${name}`, { method: 'DELETE' }),

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
  listDatabaseConnections: (serverId: string) =>
    request<DatabaseConnection[]>(`/database/servers/${serverId}/connections`),

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
    request<{ taskId: string }>(
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
    request<Instance>('/instances', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  instanceAction: (name: string, action: 'start' | 'stop' | 'reset') =>
    request<Instance>(`/instances/${name}/${action}`, { method: 'POST' }),
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
