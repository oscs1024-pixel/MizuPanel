import type { AgentLogsResponse, AgentRestartResponse, AgentStatusResponse, DockerSnapshotResponse, FileDeleteResponse, FileListResponse, FileReadResponse, FileUploadResponse, FileWriteResponse, InstallCommandOptions, InstallCommandResponse, InstallPlatform, MetricsResponse, NodesResponse, ProcessSnapshotResponse, RangeOption, RebootResponse, SettingsResponse, SettingsUpdate, SSHInstallRequest, SSHJobResponse, SSHUninstallRequest } from '../types'

export type SessionTokenResponse = {
  token: string
}

export class APIError extends Error {
  constructor(public status: number, message = `Request failed: ${status}`) {
    super(message)
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string }
    return body.error || `Request failed: ${response.status}`
  } catch {
    return `Request failed: ${response.status}`
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = init === undefined ? await fetch(path) : await fetch(path, init)
  if (!response.ok) {
    throw new APIError(response.status, await errorMessage(response))
  }
  return response.json() as Promise<T>
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const response = init === undefined ? await fetch(path) : await fetch(path, init)
  if (!response.ok) {
    throw new APIError(response.status, await errorMessage(response))
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

export function createInstallCommand(platform: InstallPlatform = 'linux', _options: InstallCommandOptions = {}): Promise<InstallCommandResponse> {
  void _options
  const params = new URLSearchParams({ platform })
  return request<InstallCommandResponse>(`/api/install/command?${params.toString()}`, { method: 'POST' })
}

export function startSSHInstall(requestBody: SSHInstallRequest): Promise<SSHJobResponse> {
  return request<SSHJobResponse>('/api/install/ssh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })
}

export function startSSHUninstall(nodeID: string, requestBody: SSHUninstallRequest): Promise<SSHJobResponse> {
  return request<SSHJobResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/ssh-uninstall`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })
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

export function getAgentStatus(nodeID: string): Promise<AgentStatusResponse> {
  return request<AgentStatusResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/agent/status`)
}

export function restartAgent(nodeID: string): Promise<AgentRestartResponse> {
  return request<AgentRestartResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/agent/restart`, { method: 'POST' })
}

export function getAgentLogs(nodeID: string, lines = 100): Promise<AgentLogsResponse> {
  return request<AgentLogsResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/agent/logs?lines=${encodeURIComponent(lines.toString())}`)
}

export function createTerminalSession(nodeID: string): Promise<SessionTokenResponse> {
  return request<SessionTokenResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/terminal/session`, { method: 'POST' })
}

export function createContainerExecSession(nodeID: string, containerID: string): Promise<SessionTokenResponse> {
  return request<SessionTokenResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/containers/${encodeURIComponent(containerID)}/exec/session`, { method: 'POST' })
}
