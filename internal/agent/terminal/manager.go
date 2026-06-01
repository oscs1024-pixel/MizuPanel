package terminal

import (
	"encoding/base64"
	"errors"
	"sync"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

const (
	maxSessions             = 4
	maxTerminalPayloadBytes = 64 * 1024
)

var ErrUnsupported = errors.New("terminal is unsupported on this platform")

type Sender interface {
	SendTerminal(protocol.TerminalMessage) error
}

type Manager struct {
	enabled  bool
	sender   Sender
	mu       sync.Mutex
	sessions map[string]*session
}

func NewManager(enabled bool, sender Sender) *Manager {
	return &Manager{enabled: enabled, sender: sender, sessions: make(map[string]*session)}
}

func (m *Manager) Handle(message protocol.TerminalMessage) {
	if !m.enabled {
		m.send(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalError, SessionID: message.SessionID, Error: "Agent 未启用终端"})
		return
	}
	switch message.Type {
	case protocol.MessageTypeTerminalStart:
		m.start(message)
	case protocol.MessageTypeTerminalData:
		m.write(message)
	case protocol.MessageTypeTerminalResize:
		m.resize(message)
	case protocol.MessageTypeTerminalClose:
		m.close(message.SessionID)
	}
}

func (m *Manager) CloseAll() {
	m.mu.Lock()
	sessions := make([]*session, 0, len(m.sessions))
	for sessionID, sess := range m.sessions {
		sessions = append(sessions, sess)
		delete(m.sessions, sessionID)
	}
	m.mu.Unlock()
	for _, sess := range sessions {
		sess.close()
	}
}

func (m *Manager) start(message protocol.TerminalMessage) {
	if message.SessionID == "" {
		m.send(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalError, Error: "终端会话缺少 session_id"})
		return
	}
	m.mu.Lock()
	if _, exists := m.sessions[message.SessionID]; exists {
		m.mu.Unlock()
		m.send(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalError, SessionID: message.SessionID, Error: "终端会话已存在"})
		return
	}
	if len(m.sessions) >= maxSessions {
		m.mu.Unlock()
		m.send(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalError, SessionID: message.SessionID, Error: "终端会话数量已达上限"})
		return
	}
	sess, err := startSession(message.SessionID, rowsOrDefault(message.Rows), colsOrDefault(message.Cols), m)
	if err != nil {
		m.mu.Unlock()
		m.send(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalError, SessionID: message.SessionID, Error: err.Error()})
		return
	}
	m.sessions[message.SessionID] = sess
	m.mu.Unlock()
	m.send(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalStarted, SessionID: message.SessionID})
}

func (m *Manager) write(message protocol.TerminalMessage) {
	if base64.StdEncoding.DecodedLen(len(message.Data)) > maxTerminalPayloadBytes {
		m.send(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalError, SessionID: message.SessionID, Error: "终端输入过大"})
		return
	}
	payload, err := base64.StdEncoding.DecodeString(message.Data)
	if err != nil {
		m.send(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalError, SessionID: message.SessionID, Error: "终端输入数据无效"})
		return
	}
	if len(payload) > maxTerminalPayloadBytes {
		m.send(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalError, SessionID: message.SessionID, Error: "终端输入过大"})
		return
	}
	if sess := m.session(message.SessionID); sess != nil {
		if err := sess.write(payload); err != nil {
			m.send(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalError, SessionID: message.SessionID, Error: err.Error()})
		}
	}
}

func (m *Manager) resize(message protocol.TerminalMessage) {
	if sess := m.session(message.SessionID); sess != nil {
		if err := sess.resize(rowsOrDefault(message.Rows), colsOrDefault(message.Cols)); err != nil {
			m.send(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalError, SessionID: message.SessionID, Error: err.Error()})
		}
	}
}

func (m *Manager) close(sessionID string) {
	m.mu.Lock()
	sess := m.sessions[sessionID]
	delete(m.sessions, sessionID)
	m.mu.Unlock()
	if sess != nil {
		sess.close()
	}
}

func (m *Manager) session(sessionID string) *session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[sessionID]
}

func (m *Manager) emitData(sessionID string, data []byte) {
	m.send(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalData, SessionID: sessionID, Data: base64.StdEncoding.EncodeToString(data)})
}

func (m *Manager) emitExit(sessionID string, exitCode int) {
	m.mu.Lock()
	delete(m.sessions, sessionID)
	m.mu.Unlock()
	m.send(protocol.TerminalMessage{Type: protocol.MessageTypeTerminalExit, SessionID: sessionID, ExitCode: exitCode})
}

func (m *Manager) send(message protocol.TerminalMessage) {
	if m.sender != nil {
		_ = m.sender.SendTerminal(message)
	}
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
