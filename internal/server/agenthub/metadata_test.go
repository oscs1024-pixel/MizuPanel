package agenthub

import (
	"database/sql"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	_ "github.com/mattn/go-sqlite3"

	"github.com/mizupanel/mizupanel/internal/protocol"
	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
	"github.com/mizupanel/mizupanel/internal/server/store"
)

func TestAgentWebSocketUpdatesNodeMetadataFromMetrics(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	database.SetMaxOpenConns(1)
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	nodes := store.NewNodeStore(database)
	handler := NewHandler(nodes, store.NewMetricStore(database), Options{AgentToken: "secret", Interval: 5})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"?token=secret", nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close()
	if err := conn.WriteJSON(protocol.HelloMessage{Type: protocol.MessageTypeHello, Hostname: "oracle-sg", Name: "Oracle SG"}); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	var ack protocol.HelloAckMessage
	if err := conn.ReadJSON(&ack); err != nil {
		t.Fatalf("read ack: %v", err)
	}
	if err := conn.WriteJSON(protocol.MetricsMessage{
		Type:      protocol.MessageTypeMetrics,
		NodeID:    ack.NodeID,
		Timestamp: time.Now().Unix(),
		System:    protocol.SystemInfo{Hostname: "oracle-sg", OS: "linux", Arch: "arm64", Kernel: "6.6"},
	}); err != nil {
		t.Fatalf("write metrics: %v", err)
	}

	for range 20 {
		node, err := nodes.Get(t.Context(), ack.NodeID)
		if err != nil {
			t.Fatalf("get node: %v", err)
		}
		if node.OS == "linux" && node.Arch == "arm64" && node.Kernel == "6.6" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("node metadata was not updated from metrics")
}
