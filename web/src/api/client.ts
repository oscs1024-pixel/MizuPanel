import type { InstallCommandResponse, MetricsResponse, NodesResponse, RangeOption } from '../types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function getNodes(): Promise<NodesResponse> {
  return request<NodesResponse>('/api/nodes')
}

export function getNodeMetrics(nodeID: string, range: RangeOption): Promise<MetricsResponse> {
  return request<MetricsResponse>(`/api/nodes/${encodeURIComponent(nodeID)}/metrics?range=${range}`)
}

export function createInstallCommand(): Promise<InstallCommandResponse> {
  return request<InstallCommandResponse>('/api/install/command', { method: 'POST' })
}
