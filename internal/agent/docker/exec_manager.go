package docker

import (
	"encoding/base64"
	"errors"
	"sync"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

const (
	maxExecSessions     = 4
	maxExecPayloadBytes = 64 * 1024
)

var ErrExecUnsupported = errors.New("docker exec is unsupported on this platform")

type ExecSender interface {
	SendContainerExec(protocol.ContainerExecMessage) error
}

type ExecManager struct {
	enabled  bool
	sender   ExecSender
	mu       sync.Mutex
	sessions map[string]*execSession
}

func NewExecManager(enabled bool, sender ExecSender) *ExecManager {
	return &ExecManager{enabled: enabled, sender: sender, sessions: make(map[string]*execSession)}
}

func (m *ExecManager) Handle(message protocol.ContainerExecMessage) {
	if !m.enabled {
		m.send(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecError, SessionID: message.SessionID, ContainerID: message.ContainerID, Error: "Agent 未启用 Docker exec"})
		return
	}
	switch message.Type {
	case protocol.MessageTypeContainerExecStart:
		m.start(message)
	case protocol.MessageTypeContainerExecData:
		m.write(message)
	case protocol.MessageTypeContainerExecResize:
		m.resize(message)
	case protocol.MessageTypeContainerExecClose:
		m.close(message.SessionID)
	}
}

func (m *ExecManager) CloseAll() {
	m.mu.Lock()
	sessions := make([]*execSession, 0, len(m.sessions))
	for sessionID, sess := range m.sessions {
		sessions = append(sessions, sess)
		delete(m.sessions, sessionID)
	}
	m.mu.Unlock()
	for _, sess := range sessions {
		sess.close()
	}
}

func (m *ExecManager) start(message protocol.ContainerExecMessage) {
	if message.SessionID == "" || message.ContainerID == "" {
		m.send(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecError, SessionID: message.SessionID, ContainerID: message.ContainerID, Error: "容器 exec 会话缺少 session_id 或 container_id"})
		return
	}
	m.mu.Lock()
	if _, exists := m.sessions[message.SessionID]; exists {
		m.mu.Unlock()
		m.send(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecError, SessionID: message.SessionID, ContainerID: message.ContainerID, Error: "容器 exec 会话已存在"})
		return
	}
	if len(m.sessions) >= maxExecSessions {
		m.mu.Unlock()
		m.send(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecError, SessionID: message.SessionID, ContainerID: message.ContainerID, Error: "终端会话数量已达上限"})
		return
	}
	sess, err := startExecSession(message.SessionID, message.ContainerID, commandOrDefault(message.Command), rowsOrDefault(message.Rows), colsOrDefault(message.Cols), m)
	if err != nil {
		m.mu.Unlock()
		m.send(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecError, SessionID: message.SessionID, ContainerID: message.ContainerID, Error: err.Error()})
		return
	}
	m.sessions[message.SessionID] = sess
	m.mu.Unlock()
	m.send(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecStarted, SessionID: message.SessionID, ContainerID: message.ContainerID})
}

func (m *ExecManager) write(message protocol.ContainerExecMessage) {
	if base64.StdEncoding.DecodedLen(len(message.Data)) > maxExecPayloadBytes {
		m.send(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecError, SessionID: message.SessionID, ContainerID: message.ContainerID, Error: "容器 exec 输入过大"})
		return
	}
	payload, err := base64.StdEncoding.DecodeString(message.Data)
	if err != nil {
		m.send(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecError, SessionID: message.SessionID, ContainerID: message.ContainerID, Error: "容器 exec 输入数据无效"})
		return
	}
	if len(payload) > maxExecPayloadBytes {
		m.send(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecError, SessionID: message.SessionID, ContainerID: message.ContainerID, Error: "容器 exec 输入过大"})
		return
	}
	if sess := m.session(message.SessionID); sess != nil {
		if err := sess.write(payload); err != nil {
			m.send(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecError, SessionID: message.SessionID, ContainerID: sess.containerID, Error: err.Error()})
		}
	}
}

func (m *ExecManager) resize(message protocol.ContainerExecMessage) {
	if sess := m.session(message.SessionID); sess != nil {
		if err := sess.resize(rowsOrDefault(message.Rows), colsOrDefault(message.Cols)); err != nil {
			m.send(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecError, SessionID: message.SessionID, ContainerID: sess.containerID, Error: err.Error()})
		}
	}
}

func (m *ExecManager) close(sessionID string) {
	m.mu.Lock()
	sess := m.sessions[sessionID]
	delete(m.sessions, sessionID)
	m.mu.Unlock()
	if sess != nil {
		sess.close()
	}
}

func (m *ExecManager) session(sessionID string) *execSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[sessionID]
}

func (m *ExecManager) emitData(sessionID string, containerID string, data []byte) {
	m.send(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecData, SessionID: sessionID, ContainerID: containerID, Data: base64.StdEncoding.EncodeToString(data)})
}

func (m *ExecManager) emitExit(sessionID string, containerID string, exitCode int) {
	m.mu.Lock()
	delete(m.sessions, sessionID)
	m.mu.Unlock()
	m.send(protocol.ContainerExecMessage{Type: protocol.MessageTypeContainerExecExit, SessionID: sessionID, ContainerID: containerID, ExitCode: exitCode})
}

func (m *ExecManager) send(message protocol.ContainerExecMessage) {
	if m.sender != nil {
		_ = m.sender.SendContainerExec(message)
	}
}

func commandOrDefault(command string) string {
	if command == "" {
		return "/bin/sh"
	}
	return command
}

func rowsOrDefault(rows uint16) uint16 {
	if rows == 0 {
		return 24
	}
	return rows
}

func colsOrDefault(cols uint16) uint16 {
	if cols == 0 {
		return 80
	}
	return cols
}
