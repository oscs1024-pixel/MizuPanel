export type RangeOption = '1h' | '6h'

export type Metric = {
  id: number
  node_id: string
  cpu_usage: number
  cpu_cores: number
  memory_total: number
  memory_used: number
  memory_usage: number
  disk_total: number
  disk_used: number
  disk_usage: number
  rx_speed: number
  tx_speed: number
  rx_total: number
  tx_total: number
  load1: number
  load5: number
  load15: number
  created_at: string
}

export type Node = {
  id: string
  name: string
  hostname: string
  ip: string
  os: string
  arch: string
  kernel: string
  agent_version: string
  status: 'online' | 'offline' | string
  last_seen_at: string
  latest_metric?: Metric
}

export type NodesResponse = {
  nodes: Node[]
}

export type MetricsResponse = {
  metrics: Metric[]
}

export type InstallCommandResponse = {
  command: string
  install_token: string
}
