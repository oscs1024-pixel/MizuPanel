package agenthub

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
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

	nodeToken, ok := auth.ExchangeInstallToken("install-token", "node-1", nil)
	if !ok {
		t.Fatal("ExchangeInstallToken returned false")
	}
	if strings.Contains(nodeToken, "install-token") || strings.Contains(nodeToken, "node-1") {
		t.Fatalf("node token %q includes install token or node id", nodeToken)
	}
}

func TestInstallAuthStoreRevokesNodeToken(t *testing.T) {
	auth := NewInstallAuthStore()
	auth.CreateInstallToken("install-token")
	nodeToken, ok := auth.ExchangeInstallToken("install-token", "node-1", nil)
	if !ok {
		t.Fatal("ExchangeInstallToken returned false")
	}
	if !auth.MayAuthenticateNodeToken(nodeToken) {
		t.Fatal("node token should authenticate before revoke")
	}

	auth.RevokeNodeToken("node-1")
	if auth.MayAuthenticateNodeToken(nodeToken) {
		t.Fatal("node token still authenticates after revoke")
	}
}

func TestInstallTokenAllowsNodeOnlyWhenCreatedAfterDeletion(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	handler := NewHandler(store.NewNodeStore(database), store.NewMetricStore(database), Options{})
	deletedAt := time.Date(2026, 5, 31, 12, 0, 0, 0, time.UTC)
	if _, err := database.Exec(`INSERT INTO deleted_nodes (id, deleted_at) VALUES (?, ?)`, "node-1", deletedAt.UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert tombstone: %v", err)
	}
	allowed, err := handler.allowNode(t.Context(), "node-1", deletedAt.Add(-time.Second))
	if err != nil {
		t.Fatalf("allow with old token: %v", err)
	}
	if allowed {
		t.Fatal("old install token should not clear tombstone")
	}
	allowed, err = handler.allowNode(t.Context(), "node-1", deletedAt.Add(time.Second))
	if err != nil {
		t.Fatalf("allow with new token: %v", err)
	}
	if !allowed {
		t.Fatal("new install token should clear tombstone")
	}
}

func TestAgentCredentialStillValidRejectsRevokedPersistentToken(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	tokens := store.NewAgentTokenStore(database)
	if err := tokens.SaveNodeToken(t.Context(), "node-1", "node-token", time.Now().UTC()); err != nil {
		t.Fatalf("save node token: %v", err)
	}
	handler := NewHandler(store.NewNodeStore(database), store.NewMetricStore(database), Options{AgentTokens: tokens})
	if !handler.agentCredentialStillValid(t.Context(), "node-1", "node-token", "node-token", false, true) {
		t.Fatal("node token should be valid before delete")
	}
	if _, err := database.Exec(`DELETE FROM node_tokens WHERE node_id = ?`, "node-1"); err != nil {
		t.Fatalf("delete token: %v", err)
	}
	if handler.agentCredentialStillValid(t.Context(), "node-1", "node-token", "node-token", false, true) {
		t.Fatal("node token should be invalid after delete")
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

	secondURL := "ws" + strings.TrimPrefix(server.URL, "http")
	secondHeader := http.Header{"Authorization": {"Bearer " + ack.NodeToken}}
	secondConn, _, err := websocket.DefaultDialer.Dial(secondURL, secondHeader)
	if err != nil {
		t.Fatalf("dial node token websocket: %v", err)
	}
	secondConn.Close()
}

func TestAgentWebSocketRejectsConfiguredAgentTokenInQuery(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	database.SetMaxOpenConns(1)
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	handler := NewHandler(store.NewNodeStore(database), store.NewMetricStore(database), Options{AgentToken: "secret", Interval: 5})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "?token=secret"
	_, response, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatal("dial succeeded, want unauthorized failure")
	}
	if response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %#v, want 401", response)
	}
}

func TestAgentWebSocketRejectsPersistedNodeTokenInQuery(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	database.SetMaxOpenConns(1)
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	tokens := store.NewAgentTokenStore(database)
	if err := tokens.SaveNodeToken(t.Context(), "node-1", "node-token", time.Now().UTC()); err != nil {
		t.Fatalf("save node token: %v", err)
	}
	handler := NewHandler(store.NewNodeStore(database), store.NewMetricStore(database), Options{AgentTokens: tokens, Interval: 5})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "?token=node-token"
	_, response, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatal("dial succeeded, want unauthorized failure")
	}
	if response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %#v, want 401", response)
	}
}

func TestAgentWebSocketAcceptsConfiguredAgentTokenWhenInstallAuthExists(t *testing.T) {
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
	handler := NewHandler(store.NewNodeStore(database), store.NewMetricStore(database), Options{AgentToken: "secret", InstallAuth: auth, Interval: 5})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	header := http.Header{"Authorization": {"Bearer secret"}}
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
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
	if ack.Type != protocol.MessageTypeHelloAck || ack.NodeID != "node-1" {
		t.Fatalf("unexpected ack: %#v", ack)
	}
}

func TestInstallAuthStoreRejectsExpiredInstallToken(t *testing.T) {
	auth := NewInstallAuthStore()
	auth.CreateInstallToken("install-token")
	auth.installTokens["install-token"] = installToken{expiresAt: time.Now().Add(-time.Second)}

	if auth.MayAuthenticateInstallToken("install-token") {
		t.Fatal("MayAuthenticateInstallToken accepted expired install token")
	}
	if _, ok := auth.ExchangeInstallToken("install-token", "node-1", nil); ok {
		t.Fatal("ExchangeInstallToken accepted expired install token")
	}
}

func TestInstallAuthStorePrunesAndCapsOutstandingInstallTokens(t *testing.T) {
	auth := NewInstallAuthStore()
	auth.CreateInstallToken("expired")
	auth.installTokens["expired"] = installToken{expiresAt: time.Now().Add(-time.Second)}

	for i := range maxInstallTokens {
		if !auth.CreateInstallToken("install-token-" + strconv.Itoa(i)) {
			t.Fatalf("CreateInstallToken rejected token %d before cap", i)
		}
	}
	if auth.CreateInstallToken("one-too-many") {
		t.Fatal("CreateInstallToken accepted token beyond cap")
	}
	if _, ok := auth.installTokens["expired"]; ok {
		t.Fatal("expired token was not pruned before cap check")
	}
}

func TestAgentWebSocketAcceptsPersistedNodeTokenWithoutInstallAuth(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	database.SetMaxOpenConns(1)
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	tokens := store.NewAgentTokenStore(database)
	if err := tokens.SaveNodeToken(t.Context(), "node-1", "node-token", time.Now().UTC()); err != nil {
		t.Fatalf("save node token: %v", err)
	}
	handler := NewHandler(store.NewNodeStore(database), store.NewMetricStore(database), Options{AgentTokens: tokens, Interval: 5})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	header := http.Header{"Authorization": {"Bearer node-token"}}
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
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
	if ack.NodeID != "node-1" {
		t.Fatalf("NodeID = %q, want node-1", ack.NodeID)
	}
}

func TestAgentWebSocketPrefersConfiguredAgentTokenOverStoredNodeToken(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	database.SetMaxOpenConns(1)
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	tokens := store.NewAgentTokenStore(database)
	if err := tokens.SaveNodeToken(t.Context(), "node-2", "secret", time.Now().UTC()); err != nil {
		t.Fatalf("save node token: %v", err)
	}
	handler := NewHandler(store.NewNodeStore(database), store.NewMetricStore(database), Options{AgentToken: "secret", AgentTokens: tokens, Interval: 5})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	header := http.Header{"Authorization": {"Bearer secret"}}
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
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
	if ack.NodeID != "node-1" {
		t.Fatalf("NodeID = %q, want node-1", ack.NodeID)
	}
}

func TestBearerTokenAcceptsCaseInsensitiveScheme(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/agent/ws", nil)
	request.Header.Set("Authorization", "bearer secret")

	if got := bearerToken(request); got != "secret" {
		t.Fatalf("bearerToken = %q, want secret", got)
	}
}

func TestAgentConnectionEnforcesCombinedTerminalSessionLimit(t *testing.T) {
	agent := &agentConnection{
		terminals:      make(map[string]*browserTerminal),
		containerExecs: make(map[string]*browserContainerExec),
	}

	for i := range maxServerTerminalSessions - 1 {
		if !agent.addTerminal(&browserTerminal{sessionID: "terminal-" + strconv.Itoa(i)}) {
			t.Fatalf("addTerminal rejected terminal %d before combined cap", i)
		}
	}
	if !agent.addContainerExec(&browserContainerExec{sessionID: "exec-1", containerID: "container-1"}) {
		t.Fatal("addContainerExec rejected session at combined cap")
	}
	if agent.addTerminal(&browserTerminal{sessionID: "terminal-over-limit"}) {
		t.Fatal("addTerminal accepted session beyond combined terminal/container exec cap")
	}
}

func TestAgentConnectionMixedSessionLimitConcurrentAccess(t *testing.T) {
	agent := &agentConnection{
		terminals:      make(map[string]*browserTerminal),
		containerExecs: make(map[string]*browserContainerExec),
	}
	var wg sync.WaitGroup
	for i := range 50 {
		wg.Add(2)
		go func(i int) {
			defer wg.Done()
			_ = agent.addTerminal(&browserTerminal{sessionID: "terminal-" + strconv.Itoa(i)})
		}(i)
		go func(i int) {
			defer wg.Done()
			_ = agent.addContainerExec(&browserContainerExec{sessionID: "exec-" + strconv.Itoa(i), containerID: "container-1"})
		}(i)
	}
	wg.Wait()

	if got := len(agent.terminals) + len(agent.containerExecs); got > maxServerTerminalSessions {
		t.Fatalf("combined sessions = %d, want at most %d", got, maxServerTerminalSessions)
	}
}

func TestAgentWebSocketReconnectsWithPersistedNodeTokenAfterRestart(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	database.SetMaxOpenConns(1)
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	tokens := store.NewAgentTokenStore(database)
	auth := NewInstallAuthStore()
	auth.CreateInstallToken("install-token")
	firstHandler := NewHandler(store.NewNodeStore(database), store.NewMetricStore(database), Options{InstallAuth: auth, AgentTokens: tokens, Interval: 5})
	firstServer := httptest.NewServer(firstHandler)

	firstURL := "ws" + strings.TrimPrefix(firstServer.URL, "http") + "?token=install-token"
	firstConn, _, err := websocket.DefaultDialer.Dial(firstURL, nil)
	if err != nil {
		firstServer.Close()
		t.Fatalf("dial first websocket: %v", err)
	}
	if err := firstConn.WriteJSON(protocol.HelloMessage{Type: protocol.MessageTypeHello, NodeID: "node-1", Hostname: "oracle-sg"}); err != nil {
		firstConn.Close()
		firstServer.Close()
		t.Fatalf("write first hello: %v", err)
	}
	var firstAck protocol.HelloAckMessage
	if err := firstConn.ReadJSON(&firstAck); err != nil {
		firstConn.Close()
		firstServer.Close()
		t.Fatalf("read first ack: %v", err)
	}
	firstConn.Close()
	firstServer.Close()
	if firstAck.NodeToken == "" {
		t.Fatal("first ack node token is empty")
	}

	restartedHandler := NewHandler(store.NewNodeStore(database), store.NewMetricStore(database), Options{InstallAuth: NewInstallAuthStore(), AgentTokens: store.NewAgentTokenStore(database), Interval: 5})
	restartedServer := httptest.NewServer(restartedHandler)
	t.Cleanup(restartedServer.Close)

	reconnectURL := "ws" + strings.TrimPrefix(restartedServer.URL, "http")
	reconnectHeader := http.Header{"Authorization": {"Bearer " + firstAck.NodeToken}}
	reconnectConn, _, err := websocket.DefaultDialer.Dial(reconnectURL, reconnectHeader)
	if err != nil {
		t.Fatalf("dial restarted websocket: %v", err)
	}
	defer reconnectConn.Close()
	if err := reconnectConn.WriteJSON(protocol.HelloMessage{Type: protocol.MessageTypeHello, NodeID: "node-1", Hostname: "oracle-sg"}); err != nil {
		t.Fatalf("write reconnect hello: %v", err)
	}
	var reconnectAck protocol.HelloAckMessage
	if err := reconnectConn.ReadJSON(&reconnectAck); err != nil {
		t.Fatalf("read reconnect ack: %v", err)
	}
	if reconnectAck.NodeToken != firstAck.NodeToken {
		t.Fatalf("reconnect node token = %q, want persisted token", reconnectAck.NodeToken)
	}
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

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	header := http.Header{"Authorization": {"Bearer secret"}}
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
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
		System:    protocol.SystemInfo{Uptime: 86400},
		CPU:       protocol.CPUInfo{Cores: 4, Usage: 12.5},
		Memory:    protocol.MemoryInfo{Total: 1000, Used: 500, Usage: 50},
		Disk:      protocol.DiskInfo{Total: 2000, Used: 500, Usage: 25, ReadSpeed: 4096, WriteSpeed: 8192},
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
	if len(gotMetrics) != 1 || gotMetrics[0].CPUUsage != 12.5 || gotMetrics[0].TXTotal != 200 || gotMetrics[0].Uptime != 86400 || gotMetrics[0].DiskReadSpeed != 4096 || gotMetrics[0].DiskWriteSpeed != 8192 {
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
