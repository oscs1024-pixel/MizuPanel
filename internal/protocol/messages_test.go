package protocol

import (
	"encoding/json"
	"testing"
)

func TestHelloMessageJSON(t *testing.T) {
	msg := HelloMessage{
		Type:         MessageTypeHello,
		NodeID:       "agent-1",
		AgentVersion: "0.1.0",
		Hostname:     "oracle-sg",
		Name:         "Oracle",
		OS:           "linux",
		Arch:         "arm64",
		Kernel:       "6.1.0",
	}

	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got HelloMessage
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Type != MessageTypeHello || got.NodeID != "agent-1" || got.Hostname != "oracle-sg" || got.AgentVersion != "0.1.0" {
		t.Fatalf("unexpected hello message: %#v", got)
	}
}

func TestHelloAckMessageJSONIncludesNodeToken(t *testing.T) {
	msg := HelloAckMessage{Type: MessageTypeHelloAck, NodeID: "node-1", NodeToken: "node-token", Interval: 5}

	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got HelloAckMessage
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Type != MessageTypeHelloAck || got.NodeID != "node-1" || got.NodeToken != "node-token" || got.Interval != 5 {
		t.Fatalf("unexpected hello ack message: %#v", got)
	}
}

func TestMetricsMessageJSON(t *testing.T) {
	msg := MetricsMessage{
		Type:      MessageTypeMetrics,
		NodeID:    "node-1",
		Timestamp: 1710000000,
		System: SystemInfo{
			Hostname: "oracle-sg",
			OS:       "linux",
			Arch:     "arm64",
			Kernel:   "6.1.0",
			Uptime:   123,
		},
		CPU: CPUInfo{Cores: 4, Usage: 17.6},
		Memory: MemoryInfo{Total: 1000, Used: 250, Usage: 25},
		Disk: DiskInfo{Total: 2000, Used: 1000, Usage: 50},
		Network: NetworkInfo{RXSpeed: 10, TXSpeed: 20, RXTotal: 100, TXTotal: 200},
		Load: LoadInfo{Load1: 0.2, Load5: 0.1, Load15: 0.05},
	}

	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got MetricsMessage
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Type != MessageTypeMetrics || got.NodeID != "node-1" || got.CPU.Usage != 17.6 || got.Network.TXTotal != 200 {
		t.Fatalf("unexpected metrics message: %#v", got)
	}
}
