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

func TestAgentWebSocketUsesServerReceiveTimeForMetrics(t *testing.T) {
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
	metrics := store.NewMetricStore(database)
	handler := NewHandler(nodes, metrics, Options{AgentToken: "secret", Interval: 5})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"?token=secret", nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close()
	if err := conn.WriteJSON(protocol.HelloMessage{Type: protocol.MessageTypeHello, NodeID: "agent-1", Hostname: "oracle-sg", Name: "Oracle SG"}); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	var ack protocol.HelloAckMessage
	if err := conn.ReadJSON(&ack); err != nil {
		t.Fatalf("read ack: %v", err)
	}
	before := time.Now().UTC()
	future := before.Add(24 * time.Hour).Unix()
	if err := conn.WriteJSON(protocol.MetricsMessage{Type: protocol.MessageTypeMetrics, NodeID: ack.NodeID, Timestamp: future}); err != nil {
		t.Fatalf("write metrics: %v", err)
	}

	for range 20 {
		rows, err := metrics.ListRange(t.Context(), ack.NodeID, before.Add(-time.Second), time.Now().Add(time.Second))
		if err != nil {
			t.Fatalf("list metrics: %v", err)
		}
		if len(rows) == 1 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("metric was not stored with server receive time")
}
