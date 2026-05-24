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

func TestRunForeverReconnectsAfterConnectionCloses(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	connections := make(chan struct{}, 2)
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
		connections <- struct{}{}
		if err := conn.WriteJSON(protocol.HelloAckMessage{Type: protocol.MessageTypeHelloAck, NodeID: "node-1", Interval: 1}); err != nil {
			t.Errorf("write ack: %v", err)
			return
		}
		var metric protocol.MetricsMessage
		_ = conn.ReadJSON(&metric)
	}))
	t.Cleanup(server.Close)

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	client := NewClient("ws"+strings.TrimPrefix(server.URL, "http"), "")
	done := make(chan error, 1)
	go func() {
		done <- client.RunForever(ctx, protocol.HelloMessage{Type: protocol.MessageTypeHello, Hostname: "oracle-sg"}, 10*time.Millisecond, 5*time.Millisecond, func(nodeID string, timestamp int64) (protocol.MetricsMessage, error) {
			return protocol.MetricsMessage{Type: protocol.MessageTypeMetrics, NodeID: nodeID, Timestamp: timestamp}, nil
		})
	}()

	<-connections
	<-connections
	cancel()
	if err := <-done; err != nil && err != context.Canceled {
		t.Fatalf("RunForever returned error: %v", err)
	}
}
