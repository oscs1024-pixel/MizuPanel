import type { K8sClustersResponse, ConnectK8sClusterRequest, ConnectK8sClusterResponse, K8sPodsResponse, K8sPodLogsResponse, K8sCluster } from '../types'

export class K8sAPIError extends Error {
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
    const error = new K8sAPIError(response.status, await errorMessage(response))
    throw error
  }
  return response.json() as Promise<T>
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const response = init === undefined ? await fetch(path) : await fetch(path, init)
  if (!response.ok) {
    const error = new K8sAPIError(response.status, await errorMessage(response))
    throw error
  }
}

export function fetchK8sClusters(): Promise<K8sClustersResponse> {
  return request<K8sClustersResponse>('/api/k8s/clusters')
}

export function connectK8sCluster(req: ConnectK8sClusterRequest): Promise<ConnectK8sClusterResponse> {
  return request<ConnectK8sClusterResponse>('/api/k8s/clusters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
  })
}

export function fetchK8sCluster(clusterID: string): Promise<{ cluster: K8sCluster }> {
  return request<{ cluster: K8sCluster }>(`/api/k8s/clusters/${encodeURIComponent(clusterID)}`)
}

export function deleteK8sCluster(clusterID: string): Promise<void> {
  return requestVoid(`/api/k8s/clusters/${encodeURIComponent(clusterID)}`, { method: 'DELETE' })
}

export function fetchK8sPods(clusterID: string, namespace?: string): Promise<K8sPodsResponse> {
  const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
  return request<K8sPodsResponse>(`/api/k8s/clusters/${encodeURIComponent(clusterID)}/pods${params}`)
}

export function fetchK8sPodLogs(
  clusterID: string,
  namespace: string,
  podName: string,
  container?: string,
  follow = false,
  tailLines = 100
): Promise<K8sPodLogsResponse> {
  const params = new URLSearchParams()
  if (container) params.set('container', container)
  if (follow) params.set('follow', 'true')
  params.set('tail_lines', tailLines.toString())

  const queryString = params.toString()
  return request<K8sPodLogsResponse>(
    `/api/k8s/clusters/${encodeURIComponent(clusterID)}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(podName)}/logs?${queryString}`
  )
}
