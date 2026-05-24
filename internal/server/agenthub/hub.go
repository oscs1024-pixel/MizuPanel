package agenthub

import (
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/mizupanel/mizupanel/internal/protocol"
	"github.com/mizupanel/mizupanel/internal/server/store"
)

type Options struct {
	AgentToken  string
	Interval    int
	InstallAuth *InstallAuthStore
}

type InstallAuthStore struct {
	nodeTokens    map[string]string
	installTokens map[string]string
	mu            sync.Mutex
}

func NewInstallAuthStore() *InstallAuthStore {
	return &InstallAuthStore{nodeTokens: make(map[string]string), installTokens: make(map[string]string)}
}

func randomNodeToken() (string, error) {
	var bytes [24]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}

func (s *InstallAuthStore) CreateInstallToken(token string) {
	s.mu.Lock()
	s.installTokens[token] = ""
	s.mu.Unlock()
}

func (s *InstallAuthStore) ExchangeInstallToken(token string, nodeID string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if nodeIDForToken, ok := s.installTokens[token]; !ok || nodeIDForToken != "" {
		return "", false
	}
	nodeToken, err := randomNodeToken()
	if err != nil {
		return "", false
	}
	s.installTokens[token] = nodeID
	s.nodeTokens[nodeID] = nodeToken
	return nodeToken, true
}

func (s *InstallAuthStore) NodeToken(nodeID string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	token, ok := s.nodeTokens[nodeID]
	return token, ok
}

func (s *InstallAuthStore) MayAuthenticate(token string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if nodeID, ok := s.installTokens[token]; ok {
		return nodeID == ""
	}
	for _, nodeToken := range s.nodeTokens {
		if token == nodeToken {
			return true
		}
	}
	return false
}

type Handler struct {
	nodes    *store.NodeStore
	metrics  *store.MetricStore
	options  Options
	upgrader websocket.Upgrader
	mu       sync.Mutex
	sessions map[string]string
}

func NewHandler(nodes *store.NodeStore, metrics *store.MetricStore, options Options) http.Handler {
	if options.Interval == 0 {
		options.Interval = 5
	}
	return &Handler{
		nodes:    nodes,
		metrics:  metrics,
		options:  options,
		sessions: make(map[string]string),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool { return true },
		},
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	suppliedToken := r.URL.Query().Get("token")
	if h.options.AgentToken == "" && h.options.InstallAuth == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if h.options.AgentToken != "" && suppliedToken != h.options.AgentToken && h.options.InstallAuth == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if h.options.InstallAuth != nil && !h.options.InstallAuth.MayAuthenticate(suppliedToken) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	var raw json.RawMessage
	if err := conn.ReadJSON(&raw); err != nil {
		return
	}
	var header struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &header); err != nil || header.Type != protocol.MessageTypeHello {
		return
	}
	var hello protocol.HelloMessage
	if err := json.Unmarshal(raw, &hello); err != nil {
		return
	}

	nodeID := nodeIDForHello(hello)
	if nodeID == "" {
		return
	}
	nodeToken := ""
	if h.options.InstallAuth != nil {
		var ok bool
		if existingNodeToken, exists := h.options.InstallAuth.NodeToken(nodeID); exists && suppliedToken == existingNodeToken {
			nodeToken = existingNodeToken
		} else if nodeToken, ok = h.options.InstallAuth.ExchangeInstallToken(suppliedToken, nodeID); !ok {
			return
		}
	}
	sessionID := h.startSession(nodeID)
	now := time.Now().UTC()
	name := hello.Name
	if name == "" {
		name = hello.Hostname
	}
	if err := h.nodes.Upsert(r.Context(), store.Node{
		ID:           nodeID,
		Name:         name,
		Hostname:     hello.Hostname,
		IP:           hello.IP,
		OS:           hello.OS,
		Arch:         hello.Arch,
		Kernel:       hello.Kernel,
		AgentVersion: hello.AgentVersion,
		Status:       "online",
		LastSeenAt:   now,
	}); err != nil {
		return
	}
	defer h.finishSession(context.WithoutCancel(r.Context()), nodeID, sessionID)
	if err := conn.WriteJSON(protocol.HelloAckMessage{Type: protocol.MessageTypeHelloAck, NodeID: nodeID, NodeToken: nodeToken, Interval: h.options.Interval}); err != nil {
		return
	}

	for {
		var message protocol.MetricsMessage
		if err := conn.ReadJSON(&message); err != nil {
			return
		}
		if message.Type != protocol.MessageTypeMetrics {
			continue
		}
		createdAt := time.Now().UTC()
		if err := h.nodes.UpdateSystemInfo(r.Context(), nodeID, message.System.Hostname, message.System.OS, message.System.Arch, message.System.Kernel, createdAt); err != nil {
			return
		}
		if err := h.metrics.Insert(r.Context(), store.Metric{
			NodeID:      nodeID,
			CPUUsage:    message.CPU.Usage,
			CPUCores:    message.CPU.Cores,
			MemoryTotal: message.Memory.Total,
			MemoryUsed:  message.Memory.Used,
			MemoryUsage: message.Memory.Usage,
			DiskTotal:   message.Disk.Total,
			DiskUsed:    message.Disk.Used,
			DiskUsage:   message.Disk.Usage,
			RXSpeed:     message.Network.RXSpeed,
			TXSpeed:     message.Network.TXSpeed,
			RXTotal:     message.Network.RXTotal,
			TXTotal:     message.Network.TXTotal,
			Load1:       message.Load.Load1,
			Load5:       message.Load.Load5,
			Load15:      message.Load.Load15,
			CreatedAt:   createdAt,
		}); err != nil {
			return
		}
	}
}

func nodeIDForHello(hello protocol.HelloMessage) string {
	if nodeID := strings.TrimSpace(hello.NodeID); nodeID != "" {
		return nodeID
	}
	sum := sha1.Sum([]byte(hello.Hostname + "|" + hello.OS + "|" + hello.Arch))
	return "node_" + hex.EncodeToString(sum[:])[:12]
}

func (h *Handler) startSession(nodeID string) string {
	sessionID := strconv.FormatInt(time.Now().UnixNano(), 10)
	h.mu.Lock()
	h.sessions[nodeID] = sessionID
	h.mu.Unlock()
	return sessionID
}

func (h *Handler) finishSession(ctx context.Context, nodeID string, sessionID string) {
	h.mu.Lock()
	current := h.sessions[nodeID]
	if current == sessionID {
		delete(h.sessions, nodeID)
	}
	h.mu.Unlock()
	if current == sessionID {
		_ = h.nodes.SetStatus(ctx, nodeID, "offline", time.Now().UTC())
	}
}
