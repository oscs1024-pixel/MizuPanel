package protocol

const (
	MessageTypeHello    = "hello"
	MessageTypeHelloAck = "hello_ack"
	MessageTypeMetrics  = "metrics"
	MessageTypePing     = "ping"
	MessageTypePong     = "pong"
)

type HelloMessage struct {
	Type         string `json:"type"`
	NodeID       string `json:"node_id"`
	AgentVersion string `json:"agent_version"`
	Hostname     string `json:"hostname"`
	Name         string `json:"name"`
	IP           string `json:"ip"`
	OS           string `json:"os"`
	Arch         string `json:"arch"`
	Kernel       string `json:"kernel"`
}

type HelloAckMessage struct {
	Type      string `json:"type"`
	NodeID    string `json:"node_id"`
	NodeToken string `json:"node_token,omitempty"`
	Interval  int    `json:"interval"`
}

type MetricsMessage struct {
	Type      string      `json:"type"`
	NodeID    string      `json:"node_id"`
	Timestamp int64       `json:"timestamp"`
	System    SystemInfo  `json:"system"`
	CPU       CPUInfo     `json:"cpu"`
	Memory    MemoryInfo  `json:"memory"`
	Disk      DiskInfo    `json:"disk"`
	Network   NetworkInfo `json:"network"`
	Load      LoadInfo    `json:"load"`
}

type SystemInfo struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Kernel   string `json:"kernel"`
	Uptime   int64  `json:"uptime"`
}

type CPUInfo struct {
	Cores int     `json:"cores"`
	Usage float64 `json:"usage"`
}

type MemoryInfo struct {
	Total int64   `json:"total"`
	Used  int64   `json:"used"`
	Usage float64 `json:"usage"`
}

type DiskInfo struct {
	Total int64   `json:"total"`
	Used  int64   `json:"used"`
	Usage float64 `json:"usage"`
}

type NetworkInfo struct {
	RXSpeed int64 `json:"rx_speed"`
	TXSpeed int64 `json:"tx_speed"`
	RXTotal int64 `json:"rx_total"`
	TXTotal int64 `json:"tx_total"`
}

type LoadInfo struct {
	Load1  float64 `json:"load1"`
	Load5  float64 `json:"load5"`
	Load15 float64 `json:"load15"`
}
