package metrics

import (
	"testing"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

func TestSnapshotToMessageMapsAllMetricFields(t *testing.T) {
	snapshot := Snapshot{
		Hostname:       "oracle-sg",
		OS:             "linux",
		Arch:           "arm64",
		Kernel:         "6.6",
		Uptime:         123,
		CPUCores:       4,
		CPUUsage:       12.5,
		MemoryTotal:    1000,
		MemoryUsed:     250,
		MemoryUsage:    25,
		DiskTotal:      2000,
		DiskUsed:       500,
		DiskUsage:      25,
		DiskReadSpeed:  4096,
		DiskWriteSpeed: 8192,
		RXSpeed:        10,
		TXSpeed:        20,
		RXTotal:        100,
		TXTotal:        200,
		Load1:          0.1,
		Load5:          0.2,
		Load15:         0.3,
	}

	message := snapshot.ToMessage("node-1", 1710000000)

	if message.Type != protocol.MessageTypeMetrics || message.NodeID != "node-1" || message.Timestamp != 1710000000 {
		t.Fatalf("unexpected message identity: %#v", message)
	}
	if message.System.Hostname != "oracle-sg" || message.CPU.Cores != 4 || message.CPU.Usage != 12.5 {
		t.Fatalf("unexpected system/cpu fields: %#v", message)
	}
	if message.Memory.Total != 1000 || message.Disk.Used != 500 || message.Disk.ReadSpeed != 4096 || message.Disk.WriteSpeed != 8192 || message.Network.TXTotal != 200 || message.Load.Load15 != 0.3 {
		t.Fatalf("unexpected metric fields: %#v", message)
	}
}
