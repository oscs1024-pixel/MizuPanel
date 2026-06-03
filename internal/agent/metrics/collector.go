package metrics

import "github.com/mizupanel/mizupanel/internal/protocol"

type Snapshot struct {
	Hostname       string
	IP             string
	OS             string
	Arch           string
	Kernel         string
	Uptime         int64
	CPUCores       int
	CPUUsage       float64
	MemoryTotal    int64
	MemoryUsed     int64
	MemoryUsage    float64
	DiskTotal      int64
	DiskUsed       int64
	DiskUsage      float64
	DiskReadSpeed  int64
	DiskWriteSpeed int64
	RXSpeed        int64
	TXSpeed        int64
	RXTotal        int64
	TXTotal        int64
	Load1          float64
	Load5          float64
	Load15         float64
}

func (s Snapshot) ToMessage(nodeID string, timestamp int64) protocol.MetricsMessage {
	return protocol.MetricsMessage{
		Type:      protocol.MessageTypeMetrics,
		NodeID:    nodeID,
		Timestamp: timestamp,
		System: protocol.SystemInfo{
			Hostname: s.Hostname,
			OS:       s.OS,
			Arch:     s.Arch,
			Kernel:   s.Kernel,
			Uptime:   s.Uptime,
		},
		CPU: protocol.CPUInfo{Cores: s.CPUCores, Usage: s.CPUUsage},
		Memory: protocol.MemoryInfo{
			Total: s.MemoryTotal,
			Used:  s.MemoryUsed,
			Usage: s.MemoryUsage,
		},
		Disk: protocol.DiskInfo{
			Total:      s.DiskTotal,
			Used:       s.DiskUsed,
			Usage:      s.DiskUsage,
			ReadSpeed:  s.DiskReadSpeed,
			WriteSpeed: s.DiskWriteSpeed,
		},
		Network: protocol.NetworkInfo{
			RXSpeed: s.RXSpeed,
			TXSpeed: s.TXSpeed,
			RXTotal: s.RXTotal,
			TXTotal: s.TXTotal,
		},
		Load: protocol.LoadInfo{Load1: s.Load1, Load5: s.Load5, Load15: s.Load15},
	}
}
