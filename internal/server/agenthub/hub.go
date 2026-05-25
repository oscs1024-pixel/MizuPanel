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
	AgentTokens *store.AgentTokenStore
}

const (
	installTokenTTL  = 30 * time.Minute
	maxInstallTokens = 1024
)

type installToken struct {
	nodeID    string
	expiresAt time.Time
}

type InstallAuthStore struct {
	nodeTokens    map[string]string
	installTokens map[string]installToken
	mu            sync.Mutex
}

func NewInstallAuthStore() *InstallAuthStore {
	return &InstallAuthStore{nodeTokens: make(map[string]string), installTokens: make(map[string]installToken)}
}

func randomNodeToken() (string, error) {
	var bytes [24]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}

func (s *InstallAuthStore) CreateInstallToken(token string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	s.pruneExpiredInstallTokensLocked(now)
	if len(s.installTokens) >= maxInstallTokens {
		return false
	}
	s.installTokens[token] = installToken{expiresAt: now.Add(installTokenTTL)}
	return true
}

func (s *InstallAuthStore) pruneExpiredInstallTokensLocked(now time.Time) {
	for token, entry := range s.installTokens {
		if now.After(entry.expiresAt) {
			delete(s.installTokens, token)
		}
	}
}

func (s *InstallAuthStore) ExchangeInstallToken(token string, nodeID string, saveToken func(string) error) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.installTokens[token]
	if !ok || entry.nodeID != "" {
		return "", false
	}
	if time.Now().After(entry.expiresAt) {
		delete(s.installTokens, token)
		return "", false
	}
	nodeToken, err := randomNodeToken()
	if err != nil {
		return "", false
	}
	if saveToken != nil {
		if err := saveToken(nodeToken); err != nil {
			return "", false
		}
	}
	delete(s.installTokens, token)
	s.nodeTokens[nodeID] = nodeToken
	return nodeToken, true
}

func (s *InstallAuthStore) NodeToken(nodeID string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	token, ok := s.nodeTokens[nodeID]
	return token, ok
}

func (s *InstallAuthStore) MayAuthenticateInstallToken(token string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if installToken, ok := s.installTokens[token]; ok {
		if time.Now().After(installToken.expiresAt) {
			delete(s.installTokens, token)
			return false
		}
		return installToken.nodeID == ""
	}
	return false
}

func (s *InstallAuthStore) MayAuthenticateNodeToken(token string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
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
	suppliedToken := bearerToken(r)
	usingHeaderToken := suppliedToken != ""
	if suppliedToken == "" {
		suppliedToken = r.URL.Query().Get("token")
	}
	usingAgentToken := usingHeaderToken && h.options.AgentToken != "" && suppliedToken == h.options.AgentToken
	persistentNodeID := ""
	usingPersistentNodeToken := false
	if usingHeaderToken && !usingAgentToken && h.options.AgentTokens != nil && suppliedToken != "" {
		var err error
		persistentNodeID, usingPersistentNodeToken, err = h.options.AgentTokens.NodeIDForToken(r.Context(), suppliedToken)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}
	if h.options.AgentToken == "" && h.options.InstallAuth == nil && !usingPersistentNodeToken {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if h.options.InstallAuth == nil && !usingAgentToken && !usingPersistentNodeToken {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if h.options.InstallAuth != nil && !usingAgentToken && !usingPersistentNodeToken {
		if usingHeaderToken {
			if !h.options.InstallAuth.MayAuthenticateNodeToken(suppliedToken) && !h.options.InstallAuth.MayAuthenticateInstallToken(suppliedToken) {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		} else if !h.options.InstallAuth.MayAuthenticateInstallToken(suppliedToken) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
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
	if usingPersistentNodeToken {
		if persistentNodeID != nodeID {
			return
		}
		nodeToken = suppliedToken
	} else if h.options.InstallAuth != nil && !usingAgentToken {
		var ok bool
		if existingNodeToken, exists := h.options.InstallAuth.NodeToken(nodeID); exists && suppliedToken == existingNodeToken {
			nodeToken = existingNodeToken
		} else {
			saveToken := func(token string) error {
				if h.options.AgentTokens == nil {
					return nil
				}
				return h.options.AgentTokens.SaveNodeToken(r.Context(), nodeID, token, time.Now().UTC())
			}
			if nodeToken, ok = h.options.InstallAuth.ExchangeInstallToken(suppliedToken, nodeID, saveToken); !ok {
				return
			}
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

func bearerToken(r *http.Request) string {
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return parts[1]
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
