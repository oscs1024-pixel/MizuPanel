package logtail

import (
	"context"
	"sync"

	"github.com/mizupanel/mizupanel/internal/agent/ws"
	"github.com/mizupanel/mizupanel/internal/protocol"
)

// Handler handles log tail requests from the server
type Handler struct {
	manager *Manager
	mu      sync.RWMutex
}

// NewHandler creates a new log tail handler
func NewHandler() *Handler {
	return &Handler{
		manager: NewManager(),
	}
}

// Handle processes a log tail request
func (h *Handler) Handle(ctx context.Context, request protocol.LogTailRequest, sender ws.LogTailSender) error {
	// Send response that we're starting
	response := protocol.LogTailResponse{
		Type:      protocol.MessageTypeLogTailResponse,
		SessionID: request.SessionID,
		NodeID:    request.NodeID,
		Path:      request.Path,
		Started:   true,
	}

	if err := sender.SendLogTail(response); err != nil {
		return err
	}

	// Start tailing
	onData := func(data string) {
		msg := protocol.LogTailData{
			Type:      protocol.MessageTypeLogTailData,
			SessionID: request.SessionID,
			Data:      data,
		}
		_ = sender.SendLogTail(msg)
	}

	onExit := func(err error) {
		msg := protocol.LogTailExit{
			Type:      protocol.MessageTypeLogTailExit,
			SessionID: request.SessionID,
		}
		if err != nil {
			msg.Error = err.Error()
		}
		_ = sender.SendLogTail(msg)
	}

	if err := h.manager.Start(ctx, request.SessionID, request.Path, request.Lines, onData, onExit); err != nil {
		errResponse := protocol.LogTailError{
			Type:      protocol.MessageTypeLogTailError,
			SessionID: request.SessionID,
			Error:     err.Error(),
		}
		return sender.SendLogTail(errResponse)
	}

	return nil
}

// Stop stops a log tail session
func (h *Handler) Stop(sessionID string) {
	h.manager.Stop(sessionID)
}

// CloseAll closes all log tail sessions
func (h *Handler) CloseAll() {
	h.mu.Lock()
	defer h.mu.Unlock()

	for sessionID := range h.manager.sessions {
		h.manager.Stop(sessionID)
	}
}
