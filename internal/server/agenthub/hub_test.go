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

func TestInstallAuthStoreGeneratesRandomNodeToken(t *testing.T) {
	auth := NewInstallAuthStore()
	auth.CreateInstallToken("install-token")

	nodeToken, ok := auth.ExchangeInstallToken("install-token", "node-1")
	if !ok {
		t.Fatal("ExchangeInstallToken returned false")
	}
	if strings.Contains(nodeToken, "install-token") || strings.Contains(nodeToken, "node-1") {
		t.Fatalf("node token %q includes install token or node id", nodeToken)
	}
}

func TestAgentWebSocketExchangesInstallTokenForNodeToken(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	database.SetMaxOpenConns(1)
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	auth := NewInstallAuthStore()
	auth.CreateInstallToken("install-token")
	handler := NewHandler(store.NewNodeStore(database), store.NewMetricStore(database), Options{InstallAuth: auth, Interval: 5})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "?token=install-token"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(protocol.HelloMessage{Type: protocol.MessageTypeHello, NodeID: "node-1", Hostname: "oracle-sg"}); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	var ack protocol.HelloAckMessage
	if err := conn.ReadJSON(&ack); err != nil {
		t.Fatalf("read ack: %v", err)
	}
	if ack.NodeToken == "" || ack.NodeToken == "install-token" {
		t.Fatalf("NodeToken = %q, want generated node token", ack.NodeToken)
	}

	secondURL := "ws" + strings.TrimPrefix(server.URL, "http") + "?token=" + ack.NodeToken
	secondConn, _, err := websocket.DefaultDialer.Dial(secondURL, nil)
	if err != nil {
		t.Fatalf("dial node token websocket: %v", err)
	}
	secondConn.Close()
}

func TestAgentWebSocketRegistersNodeAndStoresMetrics(t *testing.T) {
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

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "?token=secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(map[string]string{
		"type":          protocol.MessageTypeHello,
		"agent_version": "0.1.0",
		"hostname":      "oracle-sg",
		"name":          "Oracle SG",
		"ip":            "10.0.0.8",
		"os":            "linux",
		"arch":          "arm64",
		"kernel":        "6.6",
	}); err != nil {
		t.Fatalf("write hello: %v", err)
	}

	var ack protocol.HelloAckMessage
	if err := conn.ReadJSON(&ack); err != nil {
		t.Fatalf("read ack: %v", err)
	}
	if ack.Type != protocol.MessageTypeHelloAck || ack.NodeID == "" || ack.Interval != 5 {
		t.Fatalf("unexpected ack: %#v", ack)
	}

	if err := conn.WriteJSON(protocol.MetricsMessage{
		Type:      protocol.MessageTypeMetrics,
		NodeID:    ack.NodeID,
		Timestamp: time.Now().Unix(),
		CPU:       protocol.CPUInfo{Cores: 4, Usage: 12.5},
		Memory:    protocol.MemoryInfo{Total: 1000, Used: 500, Usage: 50},
		Disk:      protocol.DiskInfo{Total: 2000, Used: 500, Usage: 25},
		Network:   protocol.NetworkInfo{RXSpeed: 10, TXSpeed: 20, RXTotal: 100, TXTotal: 200},
		Load:      protocol.LoadInfo{Load1: 0.1, Load5: 0.2, Load15: 0.3},
	}); err != nil {
		t.Fatalf("write metrics: %v", err)
	}

	gotNode, err := nodes.Get(t.Context(), ack.NodeID)
	if err != nil {
		t.Fatalf("get node: %v", err)
	}
	if gotNode.Name != "Oracle SG" || gotNode.Status != "online" || gotNode.IP != "10.0.0.8" {
		t.Fatalf("node = %#v", gotNode)
	}

	var gotMetrics []store.Metric
	for range 20 {
		gotMetrics, err = metrics.ListRange(t.Context(), ack.NodeID, time.Now().Add(-time.Minute), time.Now().Add(time.Minute))
		if err != nil {
			t.Fatalf("list metrics: %v", err)
		}
		if len(gotMetrics) == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(gotMetrics) != 1 || gotMetrics[0].CPUUsage != 12.5 || gotMetrics[0].TXTotal != 200 {
		t.Fatalf("metrics = %#v", gotMetrics)
	}
}

func TestAgentWebSocketRejectsInvalidToken(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	handler := NewHandler(store.NewNodeStore(database), store.NewMetricStore(database), Options{AgentToken: "secret"})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "?token=wrong"
	_, response, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatal("dial succeeded, want unauthorized failure")
	}
	if response == nil || response.StatusCode != 401 {
		t.Fatalf("status = %#v, want 401", response)
	}
}
