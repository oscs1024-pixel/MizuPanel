package ws

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"

	"github.com/mizupanel/mizupanel/internal/agent/filetree"
	"github.com/mizupanel/mizupanel/internal/protocol"
)

func TestMaxServerMessageBytesAllowsDefaultUploadPayload(t *testing.T) {
	encodedUploadBytes := base64.StdEncoding.EncodedLen(filetree.DefaultMaxUploadBytes)
	if maxServerMessageBytes <= encodedUploadBytes {
		t.Fatalf("maxServerMessageBytes = %d, want > encoded default upload size %d", maxServerMessageBytes, encodedUploadBytes)
	}
}

func TestClientUsesNodeTokenFromHelloAckOnNextConnection(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	tokens := make(chan string, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokens <- strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
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
		if err := conn.WriteJSON(protocol.HelloAckMessage{Type: protocol.MessageTypeHelloAck, NodeID: "node-1", NodeToken: "node-token", Interval: 5}); err != nil {
			t.Errorf("write ack: %v", err)
			return
		}
		var metric protocol.MetricsMessage
		_ = conn.ReadJSON(&metric)
	}))
	t.Cleanup(server.Close)

	client := NewClient("ws"+strings.TrimPrefix(server.URL, "http"), "install-token")
	for range 2 {
		_, err := client.SendHelloAndMetric(t.Context(), protocol.HelloMessage{Type: protocol.MessageTypeHello, Hostname: "oracle-sg"}, protocol.MetricsMessage{Type: protocol.MessageTypeMetrics})
		if err != nil {
			t.Fatalf("SendHelloAndMetric returned error: %v", err)
		}
	}
	if first, second := <-tokens, <-tokens; first != "install-token" || second != "node-token" {
		t.Fatalf("tokens = %q, %q; want install-token, node-token", first, second)
	}
}
func TestClientPersistsNodeTokenFromHelloAck(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
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
		if err := conn.WriteJSON(protocol.HelloAckMessage{Type: protocol.MessageTypeHelloAck, NodeID: "node-1", NodeToken: "node-token", Interval: 5}); err != nil {
			t.Errorf("write ack: %v", err)
			return
		}
		var metric protocol.MetricsMessage
		_ = conn.ReadJSON(&metric)
	}))
	t.Cleanup(server.Close)

	persistedToken := ""
	client := NewClient("ws"+strings.TrimPrefix(server.URL, "http"), "install-token")
	client.SetNodeTokenHandler(func(token string) error {
		persistedToken = token
		return nil
	})
	_, err := client.SendHelloAndMetric(t.Context(), protocol.HelloMessage{Type: protocol.MessageTypeHello, Hostname: "oracle-sg"}, protocol.MetricsMessage{Type: protocol.MessageTypeMetrics})
	if err != nil {
		t.Fatalf("SendHelloAndMetric returned error: %v", err)
	}
	if persistedToken != "node-token" {
		t.Fatalf("persisted token = %q, want node-token", persistedToken)
	}
}

func TestSendHelloAndMetricSendsHelloBeforeMetric(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	messages := make(chan string, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
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
		messages <- hello.Type
		if err := conn.WriteJSON(protocol.HelloAckMessage{Type: protocol.MessageTypeHelloAck, NodeID: "node-1", Interval: 5}); err != nil {
			t.Errorf("write ack: %v", err)
			return
		}

		var metric protocol.MetricsMessage
		if err := conn.ReadJSON(&metric); err != nil {
			t.Errorf("read metric: %v", err)
			return
		}
		messages <- metric.Type
	}))
	t.Cleanup(server.Close)

	client := NewClient("ws"+strings.TrimPrefix(server.URL, "http"), "secret")
	ack, err := client.SendHelloAndMetric(t.Context(), protocol.HelloMessage{Type: protocol.MessageTypeHello, Hostname: "oracle-sg"}, protocol.MetricsMessage{Type: protocol.MessageTypeMetrics})
	if err != nil {
		t.Fatalf("SendHelloAndMetric returned error: %v", err)
	}
	if ack.NodeID != "node-1" {
		t.Fatalf("NodeID = %q, want node-1", ack.NodeID)
	}
	if first, second := <-messages, <-messages; first != protocol.MessageTypeHello || second != protocol.MessageTypeMetrics {
		t.Fatalf("message order = %s, %s", first, second)
	}
}
