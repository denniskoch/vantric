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
  id: string
  name: string
  description: string
}

export interface Disk {
  id: string
  name: string
  inUseBy: string
  zone: string
  storage: string
  sizeGb: number
}

export interface Snapshot {
  id: string
  name: string
  vmName: string
  zone: string
  description: string
  createdAt: number
  includesRam: boolean
}

export interface ISO {
  id: string
  name: string
  zone: string
  storage: string
  sizeBytes: number
  createdAt: number
}

export interface Datastore {
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

export interface MachineType {
  name: string
  description: string
  cpus: number
  memoryMb: number
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
  cloudInitUser?: string
  sshKeys?: string
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

export const api = {
  listZones: (serverId: string) => request<Zone[]>(`/zones?server=${serverId}`),
  listImages: (serverId: string) => request<Image[]>(`/images?server=${serverId}`),
  listDisks: (serverId: string) => request<Disk[]>(`/disks?server=${serverId}`),
  listSnapshots: (serverId: string) =>
    request<Snapshot[]>(`/snapshots?server=${serverId}`),
  listISOs: (serverId: string) => request<ISO[]>(`/isos?server=${serverId}`),
  listDatastores: (serverId: string) =>
    request<Datastore[]>(`/datastores?server=${serverId}`),

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

  listInstances: () => request<Instance[]>('/instances'),
  getInstance: (name: string) => request<Instance>(`/instances/${name}/`),
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
