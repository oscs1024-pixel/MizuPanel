package agenthub

import (
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
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
	AgentToken       string
	Interval         int
	InstallAuth      *InstallAuthStore
	AgentTokens      *store.AgentTokenStore
	ProcessSnapshots *store.ProcessSnapshotStore
	DockerSnapshots  *store.DockerSnapshotStore
}

const (
	installTokenTTL      = 30 * time.Minute
	maxInstallTokens     = 1024
	maxAgentMessageBytes = 512 * 1024
	maxBrowserInputBytes = 128 * 1024
	// maxServerTerminalSessions is a combined cap across node terminals and container exec sessions per agent connection.
	maxServerTerminalSessions = 4
	terminalWriteTimeout      = 5 * time.Second
)

type installToken struct {
	nodeID    string
	createdAt time.Time
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
	s.installTokens[token] = installToken{createdAt: now, expiresAt: now.Add(installTokenTTL)}
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

func (s *InstallAuthStore) RevokeNodeToken(nodeID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.nodeTokens, nodeID)
}

func (s *InstallAuthStore) InstallTokenCreatedAt(token string) (time.Time, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	installToken, ok := s.installTokens[token]
	if !ok || time.Now().After(installToken.expiresAt) {
		return time.Time{}, false
	}
	return installToken.createdAt, true
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
	nodes       *store.NodeStore
	metrics     *store.MetricStore
	options     Options
	upgrader    websocket.Upgrader
	mu          sync.Mutex
	sessions    map[string]string
	connections map[string]*agentConnection
}

type agentConnection struct {
	nodeID          string
	sessionID       string
	conn            *websocket.Conn
	writeMu         sync.Mutex
	terminalEnabled bool
	sessionMu       sync.Mutex
	terminals       map[string]*browserTerminal
	containerExecs  map[string]*browserContainerExec
	pendingMu       sync.Mutex
	pendingLists    map[string]chan protocol.FileListResponse
	pendingReads    map[string]chan protocol.FileReadResponse
	pendingWrites   map[string]chan protocol.FileWriteResponse
	pendingUploads  map[string]chan protocol.FileUploadResponse
	pendingDeletes  map[string]chan protocol.FileDeleteResponse
	pendingReboots  map[string]chan protocol.RebootResponse
}

type browserTerminal struct {
	sessionID string
	conn      *websocket.Conn
	writeMu   sync.Mutex
	closeOnce sync.Once
}

type browserContainerExec struct {
	sessionID   string
	containerID string
	conn        *websocket.Conn
	writeMu     sync.Mutex
	closeOnce   sync.Once
}

func NewHandler(nodes *store.NodeStore, metrics *store.MetricStore, options Options) *Handler {
	if options.Interval == 0 {
		options.Interval = 5
	}
	return &Handler{
		nodes:       nodes,
		metrics:     metrics,
		options:     options,
		sessions:    make(map[string]string),
		connections: make(map[string]*agentConnection),
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
	conn.SetReadLimit(maxAgentMessageBytes)

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
	if usingAgentToken && h.nodeDeleted(r.Context(), nodeID) {
		return
	}
	nodeToken := ""
	usedInstallToken := false
	installTokenCreatedAt := time.Time{}
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
			installTokenCreatedAt, _ = h.options.InstallAuth.InstallTokenCreatedAt(suppliedToken)
			saveToken := func(token string) error {
				if h.options.AgentTokens == nil {
					return nil
				}
				return h.options.AgentTokens.SaveNodeToken(r.Context(), nodeID, token, time.Now().UTC())
			}
			if nodeToken, ok = h.options.InstallAuth.ExchangeInstallToken(suppliedToken, nodeID, saveToken); !ok {
				return
			}
			usedInstallToken = true
		}
	}
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
		AgentMode:    hello.AgentMode,
		AgentUser:    hello.AgentUser,
		Status:       "online",
		LastSeenAt:   now,
	}); err != nil {
		return
	}
	if usedInstallToken {
		allowed, err := h.allowNode(r.Context(), nodeID, installTokenCreatedAt)
		if err != nil {
			return
		}
		if !allowed {
			_ = h.nodes.DeleteIfDeleted(context.WithoutCancel(r.Context()), nodeID)
			return
		}
	}
	if !h.agentCredentialStillValid(r.Context(), nodeID, suppliedToken, nodeToken, usingAgentToken, usingPersistentNodeToken) {
		_ = h.nodes.DeleteIfDeleted(context.WithoutCancel(r.Context()), nodeID)
		return
	}
	sessionID := h.startSession(nodeID)
	agent := &agentConnection{nodeID: nodeID, sessionID: sessionID, conn: conn, terminalEnabled: hello.Terminal, terminals: make(map[string]*browserTerminal), containerExecs: make(map[string]*browserContainerExec), pendingLists: make(map[string]chan protocol.FileListResponse), pendingReads: make(map[string]chan protocol.FileReadResponse), pendingWrites: make(map[string]chan protocol.FileWriteResponse), pendingUploads: make(map[string]chan protocol.FileUploadResponse), pendingDeletes: make(map[string]chan protocol.FileDeleteResponse), pendingReboots: make(map[string]chan protocol.RebootResponse)}
	h.registerConnection(agent)
	defer h.unregisterConnection(agent)
	defer h.finishSession(context.WithoutCancel(r.Context()), nodeID, sessionID)
	if err := agent.writeJSON(protocol.HelloAckMessage{Type: protocol.MessageTypeHelloAck, NodeID: nodeID, NodeToken: nodeToken, Interval: h.options.Interval}); err != nil {
		h.unregisterConnection(agent)
		return
	}

	for {
		var rawMessage json.RawMessage
		if err := conn.ReadJSON(&rawMessage); err != nil {
			return
		}
		var incoming struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(rawMessage, &incoming); err != nil {
			continue
		}
		switch incoming.Type {
		case protocol.MessageTypeMetrics:
			var message protocol.MetricsMessage
			if err := json.Unmarshal(rawMessage, &message); err != nil {
				continue
			}
			if err := h.handleMetrics(r.Context(), nodeID, message); err != nil {
				return
			}
		case protocol.MessageTypeFileListResponse:
			var message protocol.FileListResponse
			if err := json.Unmarshal(rawMessage, &message); err != nil {
				continue
			}
			agent.deliverFileList(message)
		case protocol.MessageTypeFileReadResponse:
			var message protocol.FileReadResponse
			if err := json.Unmarshal(rawMessage, &message); err != nil {
				continue
			}
			agent.deliverFileRead(message)
		case protocol.MessageTypeFileWriteResponse:
			var message protocol.FileWriteResponse
			if err := json.Unmarshal(rawMessage, &message); err != nil {
				continue
			}
			agent.deliverFileWrite(message)
		case protocol.MessageTypeFileUploadResponse:
			var message protocol.FileUploadResponse
			if err := json.Unmarshal(rawMessage, &message); err != nil {
				continue
			}
			agent.deliverFileUpload(message)
		case protocol.MessageTypeFileDeleteResponse:
			var message protocol.FileDeleteResponse
			if err := json.Unmarshal(rawMessage, &message); err != nil {
				continue
			}
			agent.deliverFileDelete(message)
		case protocol.MessageTypeRebootResponse:
			var message protocol.RebootResponse
			if err := json.Unmarshal(rawMessage, &message); err != nil {
				continue
			}
			agent.deliverReboot(message)
		case protocol.MessageTypeTerminalStarted, protocol.MessageTypeTerminalData, protocol.MessageTypeTerminalExit, protocol.MessageTypeTerminalError, protocol.MessageTypeTerminalClose:
			var message protocol.TerminalMessage
			if err := json.Unmarshal(rawMessage, &message); err != nil {
				continue
			}
			h.routeTerminalMessage(agent, message)
		case protocol.MessageTypeContainerExecStarted, protocol.MessageTypeContainerExecData, protocol.MessageTypeContainerExecExit, protocol.MessageTypeContainerExecError, protocol.MessageTypeContainerExecClose:
			var message protocol.ContainerExecMessage
			if err := json.Unmarshal(rawMessage, &message); err != nil {
				continue
			}
			h.routeContainerExecMessage(agent, message)
		}
	}
}

func (h *Handler) agentCredentialStillValid(ctx context.Context, nodeID string, suppliedToken string, nodeToken string, usingAgentToken bool, usingPersistentNodeToken bool) bool {
	if h.nodeDeleted(ctx, nodeID) {
		return false
	}
	if usingAgentToken {
		return true
	}
	if usingPersistentNodeToken {
		if h.options.AgentTokens == nil {
			return false
		}
		currentNodeID, ok, err := h.options.AgentTokens.NodeIDForToken(ctx, suppliedToken)
		return err == nil && ok && currentNodeID == nodeID
	}
	if h.options.InstallAuth != nil && nodeToken != "" {
		currentToken, ok := h.options.InstallAuth.NodeToken(nodeID)
		return ok && currentToken == nodeToken
	}
	return true
}

func (h *Handler) handleMetrics(ctx context.Context, nodeID string, message protocol.MetricsMessage) error {
	createdAt := time.Now().UTC()
	if err := h.nodes.UpdateSystemInfo(ctx, nodeID, message.System.Hostname, message.System.OS, message.System.Arch, message.System.Kernel, createdAt); err != nil {
		return err
	}
	if err := h.metrics.Insert(ctx, store.Metric{
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
		return err
	}
	if message.ProcessSnapshot != nil && h.options.ProcessSnapshots != nil {
		if err := h.options.ProcessSnapshots.Upsert(ctx, nodeID, *message.ProcessSnapshot); err != nil {
			return err
		}
	}
	if message.DockerSnapshot != nil && h.options.DockerSnapshots != nil {
		if err := h.options.DockerSnapshots.Upsert(ctx, nodeID, *message.DockerSnapshot); err != nil {
			return err
		}
	}
	return nil
}

func (h *Handler) NodeTerminalEnabled(nodeID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	connection := h.connections[nodeID]
	return connection != nil && connection.terminalEnabled
}

func (h *Handler) FileList(ctx context.Context, nodeID string, path string) (protocol.FileListResponse, error) {
	agent := h.connection(nodeID)
	if agent == nil {
		return protocol.FileListResponse{Type: protocol.MessageTypeFileListResponse, Code: "offline", Error: "节点离线，无法发送文件树命令。"}, nil
	}
	requestID, err := randomTerminalSessionID()
	if err != nil {
		return protocol.FileListResponse{}, err
	}
	ch := make(chan protocol.FileListResponse, 1)
	agent.addFileListRequest(requestID, ch)
	defer agent.removeFileListRequest(requestID)
	if err := agent.writeJSON(protocol.FileListRequest{Type: protocol.MessageTypeFileListRequest, RequestID: requestID, NodeID: nodeID, Path: path}); err != nil {
		return protocol.FileListResponse{}, err
	}
	select {
	case response := <-ch:
		return response, nil
	case <-time.After(10 * time.Second):
		return protocol.FileListResponse{Type: protocol.MessageTypeFileListResponse, Code: "timeout", Error: "文件树请求超时。"}, nil
	case <-ctx.Done():
		return protocol.FileListResponse{}, ctx.Err()
	}
}

func (h *Handler) FileRead(ctx context.Context, nodeID string, path string) (protocol.FileReadResponse, error) {
	agent := h.connection(nodeID)
	if agent == nil {
		return protocol.FileReadResponse{Type: protocol.MessageTypeFileReadResponse, Code: "offline", Error: "节点离线，无法读取文件。"}, nil
	}
	requestID, err := randomTerminalSessionID()
	if err != nil {
		return protocol.FileReadResponse{}, err
	}
	ch := make(chan protocol.FileReadResponse, 1)
	agent.addFileReadRequest(requestID, ch)
	defer agent.removeFileReadRequest(requestID)
	if err := agent.writeJSON(protocol.FileReadRequest{Type: protocol.MessageTypeFileReadRequest, RequestID: requestID, NodeID: nodeID, Path: path}); err != nil {
		return protocol.FileReadResponse{}, err
	}
	select {
	case response := <-ch:
		return response, nil
	case <-time.After(10 * time.Second):
		return protocol.FileReadResponse{Type: protocol.MessageTypeFileReadResponse, Code: "timeout", Error: "文件读取请求超时。"}, nil
	case <-ctx.Done():
		return protocol.FileReadResponse{}, ctx.Err()
	}
}

func (h *Handler) FileWrite(ctx context.Context, nodeID string, path string, content string) (protocol.FileWriteResponse, error) {
	agent := h.connection(nodeID)
	if agent == nil {
		return protocol.FileWriteResponse{Type: protocol.MessageTypeFileWriteResponse, Code: "offline", Error: "节点离线，无法保存文件。"}, nil
	}
	requestID, err := randomTerminalSessionID()
	if err != nil {
		return protocol.FileWriteResponse{}, err
	}
	ch := make(chan protocol.FileWriteResponse, 1)
	agent.addFileWriteRequest(requestID, ch)
	defer agent.removeFileWriteRequest(requestID)
	if err := agent.writeJSON(protocol.FileWriteRequest{Type: protocol.MessageTypeFileWriteRequest, RequestID: requestID, NodeID: nodeID, Path: path, Content: content}); err != nil {
		return protocol.FileWriteResponse{}, err
	}
	select {
	case response := <-ch:
		return response, nil
	case <-time.After(10 * time.Second):
		return protocol.FileWriteResponse{Type: protocol.MessageTypeFileWriteResponse, Code: "timeout", Error: "文件保存请求超时。"}, nil
	case <-ctx.Done():
		return protocol.FileWriteResponse{}, ctx.Err()
	}
}

func (h *Handler) FileUpload(ctx context.Context, nodeID string, path string, contentBase64 string) (protocol.FileUploadResponse, error) {
	agent := h.connection(nodeID)
	if agent == nil {
		return protocol.FileUploadResponse{Type: protocol.MessageTypeFileUploadResponse, Code: "offline", Error: "节点离线，无法上传文件。"}, nil
	}
	requestID, err := randomTerminalSessionID()
	if err != nil {
		return protocol.FileUploadResponse{}, err
	}
	ch := make(chan protocol.FileUploadResponse, 1)
	agent.addFileUploadRequest(requestID, ch)
	defer agent.removeFileUploadRequest(requestID)
	if err := agent.writeJSON(protocol.FileUploadRequest{Type: protocol.MessageTypeFileUploadRequest, RequestID: requestID, NodeID: nodeID, Path: path, ContentBase64: contentBase64}); err != nil {
		return protocol.FileUploadResponse{}, err
	}
	select {
	case response := <-ch:
		return response, nil
	case <-time.After(10 * time.Second):
		return protocol.FileUploadResponse{Type: protocol.MessageTypeFileUploadResponse, Code: "timeout", Error: "文件上传请求超时。"}, nil
	case <-ctx.Done():
		return protocol.FileUploadResponse{}, ctx.Err()
	}
}

func (h *Handler) FileDelete(ctx context.Context, nodeID string, path string) (protocol.FileDeleteResponse, error) {
	agent := h.connection(nodeID)
	if agent == nil {
		return protocol.FileDeleteResponse{Type: protocol.MessageTypeFileDeleteResponse, Code: "offline", Error: "节点离线，无法删除文件。"}, nil
	}
	requestID, err := randomTerminalSessionID()
	if err != nil {
		return protocol.FileDeleteResponse{}, err
	}
	ch := make(chan protocol.FileDeleteResponse, 1)
	agent.addFileDeleteRequest(requestID, ch)
	defer agent.removeFileDeleteRequest(requestID)
	if err := agent.writeJSON(protocol.FileDeleteRequest{Type: protocol.MessageTypeFileDeleteRequest, RequestID: requestID, NodeID: nodeID, Path: path}); err != nil {
		return protocol.FileDeleteResponse{}, err
	}
	select {
	case response := <-ch:
		return response, nil
	case <-time.After(10 * time.Second):
		return protocol.FileDeleteResponse{Type: protocol.MessageTypeFileDeleteResponse, Code: "timeout", Error: "文件删除请求超时。"}, nil
	case <-ctx.Done():
		return protocol.FileDeleteResponse{}, ctx.Err()
	}
}

func (h *Handler) Reboot(ctx context.Context, nodeID string) (protocol.RebootResponse, error) {
	agent := h.connection(nodeID)
	if agent == nil {
		return protocol.RebootResponse{Type: protocol.MessageTypeRebootResponse, Code: "offline", Error: "节点离线，无法发送重启命令。"}, nil
	}
	requestID, err := randomTerminalSessionID()
	if err != nil {
		return protocol.RebootResponse{}, err
	}
	ch := make(chan protocol.RebootResponse, 1)
	agent.addRebootRequest(requestID, ch)
	defer agent.removeRebootRequest(requestID)
	if err := agent.writeJSON(protocol.RebootRequest{Type: protocol.MessageTypeRebootRequest, RequestID: requestID, NodeID: nodeID}); err != nil {
		return protocol.RebootResponse{}, err
	}
	select {
	case response := <-ch:
		return response, nil
	case <-time.After(10 * time.Second):
		return protocol.RebootResponse{Type: protocol.MessageTypeRebootResponse, Code: "timeout", Error: "重启请求超时。"}, nil
	case <-ctx.Done():
		return protocol.RebootResponse{}, ctx.Err()
	}
}

func (h *Handler) AttachTerminal(ctx context.Context, nodeID string, browser *websocket.Conn) error {
	browser.SetReadLimit(maxBrowserInputBytes)
	agent := h.connection(nodeID)
	if agent == nil {
		_ = browser.WriteJSON(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalError, Error: "节点 Agent 当前不在线"})
		return errors.New("agent offline")
	}
	if !agent.terminalEnabled {
		_ = browser.WriteJSON(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalError, Error: "该节点未启用终端"})
		return errors.New("terminal disabled")
	}
	sessionID, err := randomTerminalSessionID()
	if err != nil {
		return err
	}
	terminal := &browserTerminal{sessionID: sessionID, conn: browser}
	if !agent.addTerminal(terminal) {
		_ = terminal.writeJSON(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalError, Error: "终端会话数量已达上限"})
		return errors.New("too many terminal sessions")
	}
	defer func() {
		agent.removeTerminal(sessionID)
		_ = agent.writeJSON(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalClose, SessionID: sessionID})
	}()
	if err := agent.writeJSON(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalStart, SessionID: sessionID, Rows: 24, Cols: 80}); err != nil {
		return err
	}
	for {
		var message protocol.TerminalMessage
		if err := browser.ReadJSON(&message); err != nil {
			return err
		}
		message.SessionID = sessionID
		message.NodeID = ""
		switch message.Type {
		case protocol.MessageTypeTerminalData, protocol.MessageTypeTerminalResize, protocol.MessageTypeTerminalClose:
			if err := agent.writeJSON(message); err != nil {
				return err
			}
			if message.Type == protocol.MessageTypeTerminalClose {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
	}
}

func (h *Handler) AttachContainerExec(ctx context.Context, nodeID string, containerID string, browser *websocket.Conn) error {
	browser.SetReadLimit(maxBrowserInputBytes)
	agent := h.connection(nodeID)
	if agent == nil {
		_ = browser.WriteJSON(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecError, Error: "节点 Agent 当前不在线"})
		return errors.New("agent offline")
	}
	if !agent.terminalEnabled {
		_ = browser.WriteJSON(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecError, Error: "该节点未启用终端或 Docker exec"})
		return errors.New("container exec disabled")
	}
	sessionID, err := randomTerminalSessionID()
	if err != nil {
		return err
	}
	execSession := &browserContainerExec{sessionID: sessionID, containerID: containerID, conn: browser}
	if !agent.addContainerExec(execSession) {
		_ = execSession.writeJSON(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecError, Error: "终端会话数量已达上限"})
		return errors.New("too many container exec sessions")
	}
	defer func() {
		agent.removeContainerExec(sessionID)
		_ = agent.writeJSON(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecClose, SessionID: sessionID, ContainerID: containerID})
	}()
	if err := agent.writeJSON(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecStart, SessionID: sessionID, ContainerID: containerID, Command: "/bin/sh", Rows: 24, Cols: 80}); err != nil {
		return err
	}
	for {
		var message protocol.ContainerExecMessage
		if err := browser.ReadJSON(&message); err != nil {
			return err
		}
		message.SessionID = sessionID
		message.NodeID = ""
		message.ContainerID = containerID
		switch message.Type {
		case protocol.MessageTypeContainerExecData, protocol.MessageTypeContainerExecResize, protocol.MessageTypeContainerExecClose:
			if err := agent.writeJSON(message); err != nil {
				return err
			}
			if message.Type == protocol.MessageTypeContainerExecClose {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
	}
}

func (h *Handler) connection(nodeID string) *agentConnection {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.connections[nodeID]
}

func (h *Handler) RevokeNode(nodeID string) {
	if h.options.InstallAuth != nil {
		h.options.InstallAuth.RevokeNodeToken(nodeID)
	}
}

func (h *Handler) allowNode(ctx context.Context, nodeID string, installTokenCreatedAt time.Time) (bool, error) {
	return h.nodes.AllowIfDeletedBefore(ctx, nodeID, installTokenCreatedAt)
}

func (h *Handler) nodeDeleted(ctx context.Context, nodeID string) bool {
	persisted, err := h.nodes.IsDeleted(ctx, nodeID)
	return err == nil && persisted
}

func (h *Handler) DisconnectNode(nodeID string) {
	h.mu.Lock()
	connection := h.connections[nodeID]
	delete(h.connections, nodeID)
	delete(h.sessions, nodeID)
	h.mu.Unlock()
	h.RevokeNode(nodeID)
	if connection != nil {
		connection.closeTerminals("节点已从面板移除")
		connection.closeContainerExecs("节点已从面板移除")
		connection.closePendingOperations("节点已从面板移除")
		_ = connection.conn.Close()
	}
}

func (h *Handler) registerConnection(connection *agentConnection) {
	h.mu.Lock()
	previous := h.connections[connection.nodeID]
	h.connections[connection.nodeID] = connection
	h.mu.Unlock()
	if previous != nil && previous != connection {
		previous.closeTerminals("Agent 已重新连接，旧终端会话已关闭")
		previous.closeContainerExecs("Agent 已重新连接，旧容器终端会话已关闭")
		previous.closePendingOperations("Agent 已重新连接，请重试操作")
		_ = previous.conn.Close()
	}
}

func (h *Handler) unregisterConnection(connection *agentConnection) {
	h.mu.Lock()
	current := h.connections[connection.nodeID]
	if current == connection {
		delete(h.connections, connection.nodeID)
	}
	h.mu.Unlock()
	connection.closeTerminals("Agent 连接已断开")
	connection.closeContainerExecs("Agent 连接已断开")
	connection.closePendingOperations("Agent 连接已断开")
}

func (h *Handler) routeTerminalMessage(agent *agentConnection, message protocol.TerminalMessage) {
	terminal := agent.terminal(message.SessionID)
	if terminal == nil {
		return
	}
	if err := terminal.writeJSON(message); err != nil {
		agent.removeTerminal(message.SessionID)
		terminal.close()
		return
	}
	if message.Type == protocol.MessageTypeTerminalExit || message.Type == protocol.MessageTypeTerminalError || message.Type == protocol.MessageTypeTerminalClose {
		agent.removeTerminal(message.SessionID)
		terminal.close()
	}
}

func (h *Handler) routeContainerExecMessage(agent *agentConnection, message protocol.ContainerExecMessage) {
	execSession := agent.containerExec(message.SessionID)
	if execSession == nil {
		return
	}
	if err := execSession.writeJSON(message); err != nil {
		agent.removeContainerExec(message.SessionID)
		execSession.close()
		return
	}
	if message.Type == protocol.MessageTypeContainerExecExit || message.Type == protocol.MessageTypeContainerExecError || message.Type == protocol.MessageTypeContainerExecClose {
		agent.removeContainerExec(message.SessionID)
		execSession.close()
	}
}

func (c *agentConnection) addFileListRequest(requestID string, ch chan protocol.FileListResponse) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	c.pendingLists[requestID] = ch
}

func (c *agentConnection) addFileReadRequest(requestID string, ch chan protocol.FileReadResponse) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	c.pendingReads[requestID] = ch
}

func (c *agentConnection) addFileWriteRequest(requestID string, ch chan protocol.FileWriteResponse) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	c.pendingWrites[requestID] = ch
}

func (c *agentConnection) addFileUploadRequest(requestID string, ch chan protocol.FileUploadResponse) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	c.pendingUploads[requestID] = ch
}

func (c *agentConnection) addFileDeleteRequest(requestID string, ch chan protocol.FileDeleteResponse) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	c.pendingDeletes[requestID] = ch
}

func (c *agentConnection) addRebootRequest(requestID string, ch chan protocol.RebootResponse) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	c.pendingReboots[requestID] = ch
}

func (c *agentConnection) removeFileListRequest(requestID string) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	delete(c.pendingLists, requestID)
}

func (c *agentConnection) removeFileReadRequest(requestID string) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	delete(c.pendingReads, requestID)
}

func (c *agentConnection) removeFileWriteRequest(requestID string) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	delete(c.pendingWrites, requestID)
}

func (c *agentConnection) removeFileUploadRequest(requestID string) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	delete(c.pendingUploads, requestID)
}

func (c *agentConnection) removeFileDeleteRequest(requestID string) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	delete(c.pendingDeletes, requestID)
}

func (c *agentConnection) removeRebootRequest(requestID string) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	delete(c.pendingReboots, requestID)
}

func (c *agentConnection) deliverFileList(response protocol.FileListResponse) {
	c.pendingMu.Lock()
	ch := c.pendingLists[response.RequestID]
	c.pendingMu.Unlock()
	if ch != nil {
		ch <- response
	}
}

func (c *agentConnection) deliverFileRead(response protocol.FileReadResponse) {
	c.pendingMu.Lock()
	ch := c.pendingReads[response.RequestID]
	c.pendingMu.Unlock()
	if ch != nil {
		ch <- response
	}
}

func (c *agentConnection) deliverFileWrite(response protocol.FileWriteResponse) {
	c.pendingMu.Lock()
	ch := c.pendingWrites[response.RequestID]
	c.pendingMu.Unlock()
	if ch != nil {
		ch <- response
	}
}

func (c *agentConnection) deliverFileUpload(response protocol.FileUploadResponse) {
	c.pendingMu.Lock()
	ch := c.pendingUploads[response.RequestID]
	c.pendingMu.Unlock()
	if ch != nil {
		ch <- response
	}
}

func (c *agentConnection) deliverFileDelete(response protocol.FileDeleteResponse) {
	c.pendingMu.Lock()
	ch := c.pendingDeletes[response.RequestID]
	c.pendingMu.Unlock()
	if ch != nil {
		ch <- response
	}
}

func (c *agentConnection) deliverReboot(response protocol.RebootResponse) {
	c.pendingMu.Lock()
	ch := c.pendingReboots[response.RequestID]
	c.pendingMu.Unlock()
	if ch != nil {
		ch <- response
	}
}

func (c *agentConnection) closePendingOperations(reason string) {
	c.pendingMu.Lock()
	lists := c.pendingLists
	reads := c.pendingReads
	writes := c.pendingWrites
	uploads := c.pendingUploads
	deletes := c.pendingDeletes
	reboots := c.pendingReboots
	c.pendingLists = make(map[string]chan protocol.FileListResponse)
	c.pendingReads = make(map[string]chan protocol.FileReadResponse)
	c.pendingWrites = make(map[string]chan protocol.FileWriteResponse)
	c.pendingUploads = make(map[string]chan protocol.FileUploadResponse)
	c.pendingDeletes = make(map[string]chan protocol.FileDeleteResponse)
	c.pendingReboots = make(map[string]chan protocol.RebootResponse)
	c.pendingMu.Unlock()
	for requestID, ch := range lists {
		ch <- protocol.FileListResponse{Type: protocol.MessageTypeFileListResponse, RequestID: requestID, Code: "offline", Error: reason}
	}
	for requestID, ch := range reads {
		ch <- protocol.FileReadResponse{Type: protocol.MessageTypeFileReadResponse, RequestID: requestID, Code: "offline", Error: reason}
	}
	for requestID, ch := range writes {
		ch <- protocol.FileWriteResponse{Type: protocol.MessageTypeFileWriteResponse, RequestID: requestID, Code: "offline", Error: reason}
	}
	for requestID, ch := range uploads {
		ch <- protocol.FileUploadResponse{Type: protocol.MessageTypeFileUploadResponse, RequestID: requestID, Code: "offline", Error: reason}
	}
	for requestID, ch := range deletes {
		ch <- protocol.FileDeleteResponse{Type: protocol.MessageTypeFileDeleteResponse, RequestID: requestID, Code: "offline", Error: reason}
	}
	for requestID, ch := range reboots {
		ch <- protocol.RebootResponse{Type: protocol.MessageTypeRebootResponse, RequestID: requestID, Code: "offline", Error: reason}
	}
}

func (c *agentConnection) writeJSON(value any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(terminalWriteTimeout))
	defer c.conn.SetWriteDeadline(time.Time{})
	return c.conn.WriteJSON(value)
}

func (c *agentConnection) addTerminal(terminal *browserTerminal) bool {
	c.sessionMu.Lock()
	defer c.sessionMu.Unlock()
	if len(c.terminals)+len(c.containerExecs) >= maxServerTerminalSessions {
		return false
	}
	c.terminals[terminal.sessionID] = terminal
	return true
}

func (c *agentConnection) removeTerminal(sessionID string) {
	c.sessionMu.Lock()
	defer c.sessionMu.Unlock()
	delete(c.terminals, sessionID)
}

func (c *agentConnection) terminal(sessionID string) *browserTerminal {
	c.sessionMu.Lock()
	defer c.sessionMu.Unlock()
	return c.terminals[sessionID]
}

func (c *agentConnection) closeTerminals(reason string) {
	c.sessionMu.Lock()
	terminals := make([]*browserTerminal, 0, len(c.terminals))
	for sessionID, terminal := range c.terminals {
		terminals = append(terminals, terminal)
		delete(c.terminals, sessionID)
	}
	c.sessionMu.Unlock()
	for _, terminal := range terminals {
		go func(terminal *browserTerminal) {
			defer terminal.close()
			_ = terminal.writeJSON(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalError, SessionID: terminal.sessionID, Error: reason})
		}(terminal)
	}
}

func (c *agentConnection) addContainerExec(execSession *browserContainerExec) bool {
	c.sessionMu.Lock()
	defer c.sessionMu.Unlock()
	if len(c.terminals)+len(c.containerExecs) >= maxServerTerminalSessions {
		return false
	}
	c.containerExecs[execSession.sessionID] = execSession
	return true
}

func (c *agentConnection) removeContainerExec(sessionID string) {
	c.sessionMu.Lock()
	defer c.sessionMu.Unlock()
	delete(c.containerExecs, sessionID)
}

func (c *agentConnection) containerExec(sessionID string) *browserContainerExec {
	c.sessionMu.Lock()
	defer c.sessionMu.Unlock()
	return c.containerExecs[sessionID]
}

func (c *agentConnection) closeContainerExecs(reason string) {
	c.sessionMu.Lock()
	execSessions := make([]*browserContainerExec, 0, len(c.containerExecs))
	for sessionID, execSession := range c.containerExecs {
		execSessions = append(execSessions, execSession)
		delete(c.containerExecs, sessionID)
	}
	c.sessionMu.Unlock()
	for _, execSession := range execSessions {
		go func(execSession *browserContainerExec) {
			defer execSession.close()
			_ = execSession.writeJSON(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecError, SessionID: execSession.sessionID, ContainerID: execSession.containerID, Error: reason})
		}(execSession)
	}
}

func (t *browserTerminal) writeJSON(value any) error {
	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	_ = t.conn.SetWriteDeadline(time.Now().Add(terminalWriteTimeout))
	defer t.conn.SetWriteDeadline(time.Time{})
	return t.conn.WriteJSON(value)
}

func (t *browserTerminal) close() {
	t.closeOnce.Do(func() { _ = t.conn.Close() })
}

func (e *browserContainerExec) writeJSON(value any) error {
	e.writeMu.Lock()
	defer e.writeMu.Unlock()
	_ = e.conn.SetWriteDeadline(time.Now().Add(terminalWriteTimeout))
	defer e.conn.SetWriteDeadline(time.Time{})
	return e.conn.WriteJSON(value)
}

func (e *browserContainerExec) close() {
	e.closeOnce.Do(func() { _ = e.conn.Close() })
}

func randomTerminalSessionID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
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
