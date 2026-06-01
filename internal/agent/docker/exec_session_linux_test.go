//go:build linux

package docker

import (
	"context"
	"io"
	"net"
	"strings"
	"testing"
)

func TestStartAttachedExecAcceptsSwitchingProtocols(t *testing.T) {
	socketPath := t.TempDir() + "/docker.sock"
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("listen unix socket: %v", err)
	}
	defer listener.Close()

	serverErr := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			serverErr <- err
			return
		}
		defer conn.Close()
		buffer := make([]byte, 4096)
		n, err := conn.Read(buffer)
		if err != nil {
			serverErr <- err
			return
		}
		request := string(buffer[:n])
		if !strings.Contains(request, "POST /exec/exec-1/start HTTP/1.1") {
			serverErr <- errUnexpectedRequest(request)
			return
		}
		if _, err := io.WriteString(conn, "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\nready"); err != nil {
			serverErr <- err
			return
		}
		serverErr <- nil
	}()

	conn, err := startAttachedExec(context.Background(), socketPath, "exec-1")
	if err != nil {
		t.Fatalf("startAttachedExec returned error for 101 response: %v", err)
	}
	defer conn.Close()

	payload := make([]byte, 5)
	if _, err := io.ReadFull(conn, payload); err != nil {
		t.Fatalf("read hijacked payload: %v", err)
	}
	if string(payload) != "ready" {
		t.Fatalf("payload = %q, want ready", payload)
	}
	if err := <-serverErr; err != nil {
		t.Fatalf("fake Docker server: %v", err)
	}
}

type errUnexpectedRequest string

func (e errUnexpectedRequest) Error() string { return "unexpected request: " + string(e) }
