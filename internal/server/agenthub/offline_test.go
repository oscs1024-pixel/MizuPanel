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

func TestAgentWebSocketMarksNodeOfflineWhenConnectionCloses(t *testing.T) {
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
	if err := conn.WriteJSON(protocol.HelloMessage{Type: protocol.MessageTypeHello, Hostname: "oracle-sg", Name: "Oracle SG", OS: "linux", Arch: "arm64"}); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	var ack protocol.HelloAckMessage
	if err := conn.ReadJSON(&ack); err != nil {
		t.Fatalf("read ack: %v", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("close conn: %v", err)
	}

	var node store.Node
	for range 20 {
		node, err = nodes.Get(t.Context(), ack.NodeID)
		if err != nil {
			t.Fatalf("get node: %v", err)
		}
		if node.Status == "offline" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("status = %q, want offline", node.Status)
}
