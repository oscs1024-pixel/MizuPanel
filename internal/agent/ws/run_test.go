package ws

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

func TestRunSendsMetricsUntilContextCancelled(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	metricsReceived := make(chan protocol.MetricsMessage, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		defer conn.Close()

		var hello protocol.HelloMessage
		if err := conn.ReadJSON(&hello); err != nil {
			t.Errorf("read hello: %v", err)
			return
		}
		if err := conn.WriteJSON(protocol.HelloAckMessage{Type: protocol.MessageTypeHelloAck, NodeID: "node-1", Interval: 1}); err != nil {
			t.Errorf("write ack: %v", err)
			return
		}
		for len(metricsReceived) < 2 {
			var metric protocol.MetricsMessage
			if err := conn.ReadJSON(&metric); err != nil {
				return
			}
			metricsReceived <- metric
		}
	}))
	t.Cleanup(server.Close)

	ctx, cancel := context.WithCancel(t.Context())
	client := NewClient("ws"+strings.TrimPrefix(server.URL, "http"), "")
	collectCount := 0
	done := make(chan error, 1)
	go func() {
		done <- client.Run(ctx, protocol.HelloMessage{Type: protocol.MessageTypeHello, Hostname: "oracle-sg"}, 10*time.Millisecond, func(nodeID string, timestamp int64) (protocol.MetricsMessage, error) {
			collectCount++
			return protocol.MetricsMessage{Type: protocol.MessageTypeMetrics, NodeID: nodeID, Timestamp: timestamp}, nil
		})
	}()

	first := <-metricsReceived
	second := <-metricsReceived
	cancel()
	if err := <-done; err != nil && err != context.Canceled {
		t.Fatalf("Run returned error: %v", err)
	}
	if first.NodeID != "node-1" || second.NodeID != "node-1" {
		t.Fatalf("metrics node ids = %q, %q", first.NodeID, second.NodeID)
	}
	if collectCount < 2 {
		t.Fatalf("collectCount = %d, want at least 2", collectCount)
	}
}
