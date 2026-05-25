package ws

import (
	"context"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

type Client struct {
	serverURL   string
	token       string
	onNodeToken func(string) error
}

func NewClient(serverURL string, token string) *Client {
	return &Client{serverURL: serverURL, token: token}
}

func (c *Client) SetNodeTokenHandler(handler func(string) error) {
	c.onNodeToken = handler
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

	if err := c.writeCollectedMetric(conn, ack.NodeID, collect); err != nil {
		return err
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := c.writeCollectedMetric(conn, ack.NodeID, collect); err != nil {
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

func (c *Client) writeCollectedMetric(conn *websocket.Conn, nodeID string, collect CollectFunc) error {
	message, err := collect(nodeID, time.Now().Unix())
	if err != nil {
		return err
	}
	message.NodeID = nodeID
	message.Type = protocol.MessageTypeMetrics
	return conn.WriteJSON(message)
}
