package docker

import (
	"context"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

// OperationsHandler handles container operation requests
type OperationsHandler struct {
	collector *Collector
}

// NewOperationsHandler creates a new container operations handler
func NewOperationsHandler(collector *Collector) *OperationsHandler {
	return &OperationsHandler{collector: collector}
}

func (h *OperationsHandler) HandleContainerStart(ctx context.Context, req protocol.ContainerStartRequest) protocol.ContainerStartResponse {
	err := h.collector.ContainerStart(ctx, req.ContainerID)
	if err != nil {
		return protocol.ContainerStartResponse{
			Type:    protocol.MessageTypeContainerStartResponse,
			Success: false,
			Error:   err.Error(),
		}
	}
	return protocol.ContainerStartResponse{
		Type:    protocol.MessageTypeContainerStartResponse,
		Success: true,
	}
}

func (h *OperationsHandler) HandleContainerStop(ctx context.Context, req protocol.ContainerStopRequest) protocol.ContainerStopResponse {
	err := h.collector.ContainerStop(ctx, req.ContainerID)
	if err != nil {
		return protocol.ContainerStopResponse{
			Type:    protocol.MessageTypeContainerStopResponse,
			Success: false,
			Error:   err.Error(),
		}
	}
	return protocol.ContainerStopResponse{
		Type:    protocol.MessageTypeContainerStopResponse,
		Success: true,
	}
}

func (h *OperationsHandler) HandleContainerRestart(ctx context.Context, req protocol.ContainerRestartRequest) protocol.ContainerRestartResponse {
	err := h.collector.ContainerRestart(ctx, req.ContainerID)
	if err != nil {
		return protocol.ContainerRestartResponse{
			Type:    protocol.MessageTypeContainerRestartResponse,
			Success: false,
			Error:   err.Error(),
		}
	}
	return protocol.ContainerRestartResponse{
		Type:    protocol.MessageTypeContainerRestartResponse,
		Success: true,
	}
}

func (h *OperationsHandler) HandleContainerDelete(ctx context.Context, req protocol.ContainerDeleteRequest) protocol.ContainerDeleteResponse {
	err := h.collector.ContainerDelete(ctx, req.ContainerID, req.Force)
	if err != nil {
		return protocol.ContainerDeleteResponse{
			Type:    protocol.MessageTypeContainerDeleteResponse,
			Success: false,
			Error:   err.Error(),
		}
	}
	return protocol.ContainerDeleteResponse{
		Type:    protocol.MessageTypeContainerDeleteResponse,
		Success: true,
	}
}
