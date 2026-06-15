package docker

import (
	"context"
	"sync"

	"github.com/mizupanel/mizupanel/internal/agent/ws"
	"github.com/mizupanel/mizupanel/internal/protocol"
)

// LogsHandler handles container logs requests from the server
type LogsHandler struct {
	manager       *LogsManager
	client        *Collector
	cancelFuncs   map[string]context.CancelFunc
	mu            sync.RWMutex
}

// NewLogsHandler creates a new container logs handler
func NewLogsHandler(client *Collector) *LogsHandler {
	return &LogsHandler{
		manager:     NewLogsManager(client),
		client:      client,
		cancelFuncs: make(map[string]context.CancelFunc),
	}
}

// Handle processes a container logs request
func (h *LogsHandler) Handle(ctx context.Context, request protocol.ContainerLogsRequest, sender ws.ContainerLogsSender) error {
	// Send response that we're starting
	response := protocol.ContainerLogsResponse{
		Type:        protocol.MessageTypeContainerLogsResponse,
		SessionID:   request.SessionID,
		ContainerID: request.ContainerID,
		Started:     true,
	}

	if err := sender.SendContainerLogs(response); err != nil {
		return err
	}

	// Create a background context that only respects cancellation, not deadlines
	// This prevents "context deadline exceeded" errors during long log reads
	logsCtx, cancel := context.WithCancel(context.Background())

	// Store cancel function
	h.mu.Lock()
	h.cancelFuncs[request.SessionID] = cancel
	h.mu.Unlock()

	// Monitor parent context cancellation
	go func() {
		<-ctx.Done()
		h.Stop(request.SessionID)
	}()

	// Start streaming logs
	onData := func(data string, stream string) {
		msg := protocol.ContainerLogsData{
			Type:      protocol.MessageTypeContainerLogsData,
			SessionID: request.SessionID,
			Data:      data,
			Stream:    stream,
		}
		_ = sender.SendContainerLogs(msg)
	}

	onExit := func(err error) {
		// Clean up cancel function
		h.mu.Lock()
		if cancelFunc, exists := h.cancelFuncs[request.SessionID]; exists {
			cancelFunc()
			delete(h.cancelFuncs, request.SessionID)
		}
		h.mu.Unlock()

		msg := protocol.ContainerLogsExit{
			Type:      protocol.MessageTypeContainerLogsExit,
			SessionID: request.SessionID,
		}
		if err != nil {
			msg.Error = err.Error()
		}
		_ = sender.SendContainerLogs(msg)
	}

	if err := h.manager.Start(logsCtx, request.SessionID, request.ContainerID, request.Lines, request.Follow, request.Timestamps, onData, onExit); err != nil {
		// Clean up on error
		h.mu.Lock()
		cancel()
		delete(h.cancelFuncs, request.SessionID)
		h.mu.Unlock()

		errResponse := protocol.ContainerLogsError{
			Type:      protocol.MessageTypeContainerLogsError,
			SessionID: request.SessionID,
			Error:     err.Error(),
		}
		return sender.SendContainerLogs(errResponse)
	}

	return nil
}

// Stop stops a container logs session
func (h *LogsHandler) Stop(sessionID string) {
	h.mu.Lock()
	if cancelFunc, exists := h.cancelFuncs[sessionID]; exists {
		cancelFunc()
		delete(h.cancelFuncs, sessionID)
	}
	h.mu.Unlock()
	h.manager.Stop(sessionID)
}

// CloseAll closes all container logs sessions
func (h *LogsHandler) CloseAll() {
	h.mu.Lock()
	defer h.mu.Unlock()

	for sessionID := range h.manager.sessions {
		h.manager.Stop(sessionID)
	}
}
