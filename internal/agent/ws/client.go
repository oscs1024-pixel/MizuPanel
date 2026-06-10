package ws

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/mizupanel/mizupanel/internal/agent/filetree"
	"github.com/mizupanel/mizupanel/internal/agent/reboot"
	"github.com/mizupanel/mizupanel/internal/protocol"
)

type Client struct {
	serverURL                   string
	token                       string
	onNodeToken                 func(string) error
	agentManagementHandler      AgentManagementHandler
	terminalHandlerFactory      TerminalHandlerFactory
	containerExecHandlerFactory ContainerExecHandlerFactory
}

type TerminalSender interface {
	SendTerminal(protocol.TerminalMessage) error
}

type ContainerExecSender interface {
	SendContainerExec(protocol.ContainerExecMessage) error
}

type AgentManagementHandler interface {
	Status() protocol.AgentStatusResponse
	Restart() protocol.AgentRestartResponse
	Logs(lines int) protocol.AgentLogsResponse
}

type TerminalHandler interface {
	Handle(protocol.TerminalMessage)
	CloseAll()
}

type ContainerExecHandler interface {
	Handle(protocol.ContainerExecMessage)
	CloseAll()
}

type TerminalHandlerFactory func(TerminalSender) TerminalHandler

type ContainerExecHandlerFactory func(ContainerExecSender) ContainerExecHandler

const maxServerMessageBytes = filetree.DefaultMaxUploadBytes*4/3 + 64*1024

type connectionWriter struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func NewClient(serverURL string, token string) *Client {
	return &Client{serverURL: serverURL, token: token}
}

func (c *Client) SetNodeTokenHandler(handler func(string) error) {
	c.onNodeToken = handler
}

func (c *Client) SetAgentManagementHandler(handler AgentManagementHandler) {
	c.agentManagementHandler = handler
}

func (c *Client) SetTerminalHandlerFactory(factory TerminalHandlerFactory) {
	c.terminalHandlerFactory = factory
}

func (c *Client) SetContainerExecHandlerFactory(factory ContainerExecHandlerFactory) {
	c.containerExecHandlerFactory = factory
}

func (c *Client) SendHelloAndMetric(ctx context.Context, hello protocol.HelloMessage, metric protocol.MetricsMessage) (protocol.HelloAckMessage, error) {
	conn, ack, err := c.connect(ctx, hello)
	if err != nil {
		return protocol.HelloAckMessage{}, err
	}
	defer conn.Close()

	metric.NodeID = ack.NodeID
	if err := conn.WriteJSON(metric); err != nil {
		return protocol.HelloAckMessage{}, err
	}
	return ack, nil
}

type CollectFunc func(nodeID string, timestamp int64) (protocol.MetricsMessage, error)

func (c *Client) Run(ctx context.Context, hello protocol.HelloMessage, interval time.Duration, collect CollectFunc) error {
	conn, ack, err := c.connect(ctx, hello)
	if err != nil {
		return err
	}
	defer conn.Close()
	writer := &connectionWriter{conn: conn}
	var terminalHandler TerminalHandler
	if c.terminalHandlerFactory != nil {
		terminalHandler = c.terminalHandlerFactory(writer)
		defer terminalHandler.CloseAll()
	}
	var containerExecHandler ContainerExecHandler
	if c.containerExecHandlerFactory != nil {
		containerExecHandler = c.containerExecHandlerFactory(writer)
		defer containerExecHandler.CloseAll()
	}

	errCh := make(chan error, 1)
	go c.readLoop(writer, terminalHandler, containerExecHandler, errCh)
	if err := c.writeCollectedMetric(writer, ack.NodeID, collect); err != nil {
		return err
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-errCh:
			return err
		case <-ticker.C:
			if err := c.writeCollectedMetric(writer, ack.NodeID, collect); err != nil {
				return err
			}
		}
	}
}

func (c *Client) RunForever(ctx context.Context, hello protocol.HelloMessage, interval time.Duration, reconnectDelay time.Duration, collect CollectFunc) error {
	for {
		if err := c.Run(ctx, hello, interval, collect); err != nil && ctx.Err() != nil {
			return ctx.Err()
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(reconnectDelay):
		}
	}
}

func (c *Client) connect(ctx context.Context, hello protocol.HelloMessage) (*websocket.Conn, protocol.HelloAckMessage, error) {
	header := http.Header{}
	if c.token != "" {
		header.Set("Authorization", "Bearer "+c.token)
	}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, c.serverURL, header)
	if err != nil {
		return nil, protocol.HelloAckMessage{}, err
	}
	conn.SetReadLimit(maxServerMessageBytes)
	if err := conn.WriteJSON(hello); err != nil {
		conn.Close()
		return nil, protocol.HelloAckMessage{}, err
	}
	var ack protocol.HelloAckMessage
	if err := conn.ReadJSON(&ack); err != nil {
		conn.Close()
		return nil, protocol.HelloAckMessage{}, err
	}
	if ack.NodeToken != "" {
		c.token = ack.NodeToken
		if c.onNodeToken != nil {
			if err := c.onNodeToken(ack.NodeToken); err != nil {
				conn.Close()
				return nil, protocol.HelloAckMessage{}, err
			}
		}
	}
	return conn, ack, nil
}

func (c *Client) readLoop(writer *connectionWriter, terminalHandler TerminalHandler, containerExecHandler ContainerExecHandler, errCh chan<- error) {
	for {
		var raw json.RawMessage
		if err := writer.conn.ReadJSON(&raw); err != nil {
			errCh <- err
			return
		}
		var header struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &header); err != nil {
			continue
		}
		switch header.Type {
		case protocol.MessageTypeFileListRequest:
			var request protocol.FileListRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				continue
			}
			response := filetree.List(request.Path, filetree.DefaultMaxEntries)
			response.Type = protocol.MessageTypeFileListResponse
			response.RequestID = request.RequestID
			_ = writer.writeJSON(response)
		case protocol.MessageTypeFileReadRequest:
			var request protocol.FileReadRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				continue
			}
			response := filetree.Read(request.Path, filetree.DefaultMaxEditableBytes)
			response.Type = protocol.MessageTypeFileReadResponse
			response.RequestID = request.RequestID
			_ = writer.writeJSON(response)
		case protocol.MessageTypeFileWriteRequest:
			var request protocol.FileWriteRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				continue
			}
			response := filetree.Write(request.Path, request.Content, filetree.DefaultMaxEditableBytes)
			response.Type = protocol.MessageTypeFileWriteResponse
			response.RequestID = request.RequestID
			_ = writer.writeJSON(response)
		case protocol.MessageTypeFileUploadRequest:
			var request protocol.FileUploadRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				continue
			}
			response := filetree.Upload(request.Path, request.ContentBase64, filetree.DefaultMaxUploadBytes)
			response.Type = protocol.MessageTypeFileUploadResponse
			response.RequestID = request.RequestID
			_ = writer.writeJSON(response)
		case protocol.MessageTypeFileDeleteRequest:
			var request protocol.FileDeleteRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				continue
			}
			response := filetree.Delete(request.Path)
			response.Type = protocol.MessageTypeFileDeleteResponse
			response.RequestID = request.RequestID
			_ = writer.writeJSON(response)
		case protocol.MessageTypeRebootRequest:
			var request protocol.RebootRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				continue
			}
			response := reboot.Run(context.Background(), reboot.CurrentOS(), nil)
			response.Type = protocol.MessageTypeRebootResponse
			response.RequestID = request.RequestID
			_ = writer.writeJSON(response)
		case protocol.MessageTypeAgentStatusRequest:
			if c.agentManagementHandler == nil {
				continue
			}
			var request protocol.AgentStatusRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				continue
			}
			response := c.agentManagementHandler.Status()
			response.Type = protocol.MessageTypeAgentStatusResponse
			response.RequestID = request.RequestID
			response.NodeID = request.NodeID
			_ = writer.writeJSON(response)
		case protocol.MessageTypeAgentRestartRequest:
			if c.agentManagementHandler == nil {
				continue
			}
			var request protocol.AgentRestartRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				continue
			}
			response := c.agentManagementHandler.Restart()
			response.Type = protocol.MessageTypeAgentRestartResponse
			response.RequestID = request.RequestID
			_ = writer.writeJSON(response)
		case protocol.MessageTypeAgentLogsRequest:
			if c.agentManagementHandler == nil {
				continue
			}
			var request protocol.AgentLogsRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				continue
			}
			response := c.agentManagementHandler.Logs(request.Lines)
			response.Type = protocol.MessageTypeAgentLogsResponse
			response.RequestID = request.RequestID
			response.NodeID = request.NodeID
			_ = writer.writeJSON(response)
		case protocol.MessageTypeTerminalStart, protocol.MessageTypeTerminalData, protocol.MessageTypeTerminalResize, protocol.MessageTypeTerminalClose:
			if terminalHandler == nil {
				continue
			}
			var message protocol.TerminalMessage
			if err := json.Unmarshal(raw, &message); err != nil {
				continue
			}
			terminalHandler.Handle(message)
		case protocol.MessageTypeContainerExecStart, protocol.MessageTypeContainerExecData, protocol.MessageTypeContainerExecResize, protocol.MessageTypeContainerExecClose:
			if containerExecHandler == nil {
				continue
			}
			var message protocol.ContainerExecMessage
			if err := json.Unmarshal(raw, &message); err != nil {
				continue
			}
			containerExecHandler.Handle(message)
		}
	}
}

func (c *Client) writeCollectedMetric(writer *connectionWriter, nodeID string, collect CollectFunc) error {
	message, err := collect(nodeID, time.Now().Unix())
	if err != nil {
		return err
	}
	message.NodeID = nodeID
	message.Type = protocol.MessageTypeMetrics
	return writer.writeJSON(message)
}

func (w *connectionWriter) SendTerminal(message protocol.TerminalMessage) error {
	return w.writeJSON(message)
}

func (w *connectionWriter) SendContainerExec(message protocol.ContainerExecMessage) error {
	return w.writeJSON(message)
}

func (w *connectionWriter) writeJSON(value any) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.conn.WriteJSON(value)
}
