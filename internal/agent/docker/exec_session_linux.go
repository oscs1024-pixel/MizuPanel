//go:build linux

package docker

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const dockerExecTimeout = 5 * time.Second

type execSession struct {
	id          string
	containerID string
	execID      string
	manager     *ExecManager
	conn        net.Conn
	once        sync.Once
}

func startExecSession(sessionID string, containerID string, command string, rows uint16, cols uint16, manager *ExecManager) (*execSession, error) {
	commands := []string{commandOrDefault(command)}
	if commands[0] == "/bin/sh" {
		commands = append(commands, "/bin/bash")
	}
	var lastErr error
	for _, candidate := range commands {
		sess, err := startExecSessionWithCommand(sessionID, containerID, candidate, rows, cols, manager)
		if err == nil {
			return sess, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func startExecSessionWithCommand(sessionID string, containerID string, command string, rows uint16, cols uint16, manager *ExecManager) (*execSession, error) {
	client := newSocketClient(defaultSocketPath, dockerExecTimeout)
	ctx, cancel := context.WithTimeout(context.Background(), dockerExecTimeout)
	defer cancel()
	execID, err := client.CreateExec(ctx, containerID, command)
	if err != nil {
		return nil, err
	}
	conn, err := startAttachedExec(ctx, defaultSocketPath, execID)
	if err != nil {
		return nil, err
	}
	sess := &execSession{id: sessionID, containerID: containerID, execID: execID, manager: manager, conn: conn}
	_ = sess.resize(rows, cols)
	go sess.readLoop()
	go sess.waitLoop(client)
	return sess, nil
}

func (s *execSession) write(data []byte) error {
	_, err := s.conn.Write(data)
	return err
}

func (s *execSession) resize(rows uint16, cols uint16) error {
	client := newSocketClient(defaultSocketPath, dockerExecTimeout)
	ctx, cancel := context.WithTimeout(context.Background(), dockerExecTimeout)
	defer cancel()
	return client.ResizeExec(ctx, s.execID, rows, cols)
}

func (s *execSession) close() {
	s.once.Do(func() { _ = s.conn.Close() })
}

func (s *execSession) readLoop() {
	buffer := make([]byte, 8192)
	for {
		count, err := s.conn.Read(buffer)
		if count > 0 {
			s.manager.emitData(s.id, s.containerID, buffer[:count])
		}
		if err != nil {
			return
		}
	}
}

func (s *execSession) waitLoop(client *socketClient) {
	defer s.close()
	exitCode := 0
	for {
		ctx, cancel := context.WithTimeout(context.Background(), dockerExecTimeout)
		inspect, err := client.InspectExec(ctx, s.execID)
		cancel()
		if err != nil {
			exitCode = 1
			break
		}
		if !inspect.Running {
			exitCode = inspect.ExitCode
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	s.manager.emitExit(s.id, s.containerID, exitCode)
}

func (c *socketClient) CreateExec(ctx context.Context, containerID string, command string) (string, error) {
	payload := map[string]any{
		"AttachStdin":  true,
		"AttachStdout": true,
		"AttachStderr": true,
		"Tty":          true,
		"Cmd":          []string{command},
		"Env":          []string{"TERM=xterm-256color"},
	}
	var response struct {
		ID string `json:"Id"`
	}
	if err := c.postJSON(ctx, "/containers/"+containerID+"/exec", payload, &response); err != nil {
		return "", err
	}
	if response.ID == "" {
		return "", errors.New("Docker exec create returned empty id")
	}
	return response.ID, nil
}

func (c *socketClient) ResizeExec(ctx context.Context, execID string, rows uint16, cols uint16) error {
	path := fmt.Sprintf("/exec/%s/resize?h=%d&w=%d", execID, rows, cols)
	return c.postJSON(ctx, path, nil, nil)
}

func (c *socketClient) InspectExec(ctx context.Context, execID string) (execInspect, error) {
	var response execInspect
	if err := c.getJSON(ctx, "/exec/"+execID+"/json", &response); err != nil {
		return execInspect{}, err
	}
	return response, nil
}

func (c *socketClient) postJSON(ctx context.Context, path string, payload any, target any) error {
	var body io.Reader
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, body)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("Docker API status %d: %s", response.StatusCode, strings.TrimSpace(string(message)))
	}
	if target == nil {
		return nil
	}
	return json.NewDecoder(response.Body).Decode(target)
}

type execInspect struct {
	Running  bool `json:"Running"`
	ExitCode int  `json:"ExitCode"`
}

func startAttachedExec(ctx context.Context, socketPath string, execID string) (net.Conn, error) {
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "unix", socketPath)
	if err != nil {
		return nil, err
	}
	payload := []byte(`{"Detach":false,"Tty":true}`)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://docker/exec/"+execID+"/start", bytes.NewReader(payload))
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "tcp")
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	if err := request.Write(conn); err != nil {
		_ = conn.Close()
		return nil, err
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, request)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusSwitchingProtocols && (response.StatusCode < 200 || response.StatusCode >= 300) {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		_ = conn.Close()
		return nil, fmt.Errorf("Docker exec start status %d: %s", response.StatusCode, strings.TrimSpace(string(message)))
	}
	_ = conn.SetDeadline(time.Time{})
	return &bufferedConn{Conn: conn, reader: reader}, nil
}

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *bufferedConn) Read(p []byte) (int, error) {
	if c.reader.Buffered() > 0 {
		return c.reader.Read(p)
	}
	return c.Conn.Read(p)
}
