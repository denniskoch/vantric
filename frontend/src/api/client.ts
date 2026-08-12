// Typed client for the lab-cloud-manager REST API.

export interface Project {
  id: string
  name: string
  displayName: string
  createdAt: string
}

export type InstanceStatus =
  | 'PROVISIONING'
  | 'STAGING'
  | 'RUNNING'
  | 'STOPPING'
  | 'TERMINATED'

export interface Instance {
  id: string
  projectId: string
  name: string
  zone: string
  machineType: string
  cpus: number
  memoryMb: number
  diskGb: number
  imageId: string
  status: InstanceStatus
  driver: string
  driverId: string
  internalIp: string
  externalIp: string
  createdAt: string
  updatedAt: string
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

export interface MachineType {
  name: string
  description: string
  cpus: number
  memoryMb: number
}

export interface CreateInstanceRequest {
  name: string
  zone: string
  machineType: string
  cpus?: number
  memoryMb?: number
  diskGb?: number
  imageId: string
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
  listProjects: () => request<Project[]>('/projects'),
  listZones: () => request<Zone[]>('/zones'),
  listImages: () => request<Image[]>('/images'),
  listMachineTypes: () => request<MachineType[]>('/machine-types'),

  listInstances: (project: string) =>
    request<Instance[]>(`/projects/${project}/instances`),
  getInstance: (project: string, name: string) =>
    request<Instance>(`/projects/${project}/instances/${name}/`),
  createInstance: (project: string, body: CreateInstanceRequest) =>
    request<Instance>(`/projects/${project}/instances`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  instanceAction: (project: string, name: string, action: 'start' | 'stop' | 'reset') =>
    request<Instance>(`/projects/${project}/instances/${name}/${action}`, {
      method: 'POST',
    }),
  deleteInstance: (project: string, name: string) =>
    request<void>(`/projects/${project}/instances/${name}/`, { method: 'DELETE' }),
}
