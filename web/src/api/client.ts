import type { DockerSnapshotResponse, FileDeleteResponse, FileListResponse, FileReadResponse, FileUploadResponse, FileWriteResponse, InstallCommandOptions, InstallCommandResponse, InstallPlatform, MetricsResponse, NodesResponse, ProcessSnapshotResponse, RangeOption, RebootResponse, SettingsResponse, SettingsUpdate } from '../types'

export type SessionTokenResponse = {
  token: string
}

export class APIError extends Error {
  constructor(public status: number) {
    super(`Request failed: ${status}`)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = init === undefined ? await fetch(path) : await fetch(path, init)
  if (!response.ok) {
    throw new APIError(response.status)
  }
  return response.json() as Promise<T>
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const response = init === undefined ? await fetch(path) : await fetch(path, init)
  if (!response.ok) {
    throw new APIError(response.status)
  }
}

export function getNodes(): Promise<NodesResponse> {
  return request<NodesResponse>('/api/nodes')
}

export function getSettings(): Promise<SettingsResponse> {
  return request<SettingsResponse>('/api/settings')
}

export function updateSettings(settings: SettingsUpdate): Promise<SettingsResponse> {
  return request<SettingsResponse>('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  })
}

export function deleteNode(nodeID: string): Promise<void> {
  return requestVoid(`/api/nodes/${encodeURIComponent(nodeID)}`, { method: 'DELETE' })
}

export function getNodeMetrics(nodeID: string, range: RangeOption): Promise<MetricsResponse> {
  return request<MetricsResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/metrics?range=${range}`)
}

export function createInstallCommand(platform: InstallPlatform = 'linux', options: InstallCommandOptions = {}): Promise<InstallCommandResponse> {
  const params = new URLSearchParams({ platform })
  if (platform === 'linux' && options.enableDocker) {
    params.set('enable_docker', 'true')
  }
  if (platform === 'linux' && options.enableTerminal) {
    params.set('enable_terminal', 'true')
  }
  if (platform === 'linux' && options.mode) {
    params.set('mode', options.mode)
  }
  return request<InstallCommandResponse>(`/api/install/command?${params.toString()}`, { method: 'POST' })
}

export function getNodeProcesses(nodeID: string): Promise<ProcessSnapshotResponse> {
  return request<ProcessSnapshotResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/processes`)
}

export function getNodeDocker(nodeID: string): Promise<DockerSnapshotResponse> {
  return request<DockerSnapshotResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/docker`)
}

export function getNodeFiles(nodeID: string, path: string): Promise<FileListResponse> {
  return request<FileListResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/files?path=${encodeURIComponent(path)}`)
}

export function readNodeFile(nodeID: string, path: string): Promise<FileReadResponse> {
  return request<FileReadResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/files/content?path=${encodeURIComponent(path)}`)
}

export function writeNodeFile(nodeID: string, path: string, content: string): Promise<FileWriteResponse> {
  return request<FileWriteResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/files/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content })
  })
}

export function uploadNodeFile(nodeID: string, path: string, contentBase64: string): Promise<FileUploadResponse> {
  return request<FileUploadResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/files/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content_base64: contentBase64 })
  })
}

export function deleteNodePath(nodeID: string, path: string): Promise<FileDeleteResponse> {
  return request<FileDeleteResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/files/content`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })
}

export function rebootNode(nodeID: string): Promise<RebootResponse> {
  return request<RebootResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/reboot`, { method: 'POST' })
}

export function createTerminalSession(nodeID: string): Promise<SessionTokenResponse> {
  return request<SessionTokenResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/terminal/session`, { method: 'POST' })
}

export function createContainerExecSession(nodeID: string, containerID: string): Promise<SessionTokenResponse> {
  return request<SessionTokenResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/containers/${encodeURIComponent(containerID)}/exec/session`, { method: 'POST' })
}
