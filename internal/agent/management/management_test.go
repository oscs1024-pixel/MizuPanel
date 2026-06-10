package management

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestHandlerStatusReturnsConfiguredAgentDetails(t *testing.T) {
	handler := NewHandler(Options{
		Version:         "0.1.0",
		User:            "root",
		Mode:            "ops",
		TerminalEnabled: true,
		DockerAvailable: true,
		ConfigPath:      "/usr/local/mizupanel/agent.yaml",
		StartTime:       time.Now().Add(-2 * time.Minute),
	})

	status := handler.Status()

	if status.Version != "0.1.0" || status.User != "root" || status.Mode != "ops" || !status.TerminalEnabled || !status.DockerAvailable || status.ConfigPath != "/usr/local/mizupanel/agent.yaml" || status.ServiceName != "mizupanel-agent" {
		t.Fatalf("status = %#v", status)
	}
	if status.Uptime <= 0 || status.CollectedAt <= 0 {
		t.Fatalf("status timing = %#v", status)
	}
}

func TestHandlerStatusUsesLiveDockerStatus(t *testing.T) {
	handler := NewHandler(Options{
		DockerAvailable: true,
		DockerError:     "stale",
		DockerStatus: func() (bool, string) {
			return false, "Docker socket not found"
		},
	})

	status := handler.Status()

	if status.DockerAvailable || status.DockerError != "Docker socket not found" {
		t.Fatalf("docker status = %#v", status)
	}
}

func TestHandlerRestartUsesFixedSystemctlCommand(t *testing.T) {
	runner := newFakeRunner()
	handler := NewHandler(Options{GOOS: "linux", Runner: runner})

	response := handler.Restart()

	if !response.Accepted || response.Message == "" || response.Code != "" || response.Error != "" {
		t.Fatalf("restart response = %#v", response)
	}
	if !runner.wait() {
		t.Fatal("restart command was not executed")
	}
	if runner.name != "systemctl" || strings.Join(runner.args, " ") != "restart mizupanel-agent" {
		t.Fatalf("command = %q %q", runner.name, runner.args)
	}
}

func TestHandlerLogsClampLinesAndTruncateOutput(t *testing.T) {
	runner := &fakeRunner{output: strings.Repeat("x", MaxLogOutputBytes+10)}
	handler := NewHandler(Options{GOOS: "linux", Runner: runner})

	response := handler.Logs(999)

	if response.Code != "" || response.Error != "" {
		t.Fatalf("logs response error = %#v", response)
	}
	if response.Lines != 500 {
		t.Fatalf("lines = %d, want 500", response.Lines)
	}
	if runner.name != "journalctl" || strings.Join(runner.args, " ") != "-u mizupanel-agent -n 500 --no-pager" {
		t.Fatalf("command = %q %q", runner.name, runner.args)
	}
	if !response.Truncated || len(response.Content) != MaxLogOutputBytes {
		t.Fatalf("truncation = %v len=%d", response.Truncated, len(response.Content))
	}
}

func TestHandlerRejectsUnsupportedOS(t *testing.T) {
	handler := NewHandler(Options{GOOS: "windows", Runner: &fakeRunner{}})

	if response := handler.Restart(); response.Code != "unsupported" || response.Accepted {
		t.Fatalf("restart response = %#v", response)
	}
	if response := handler.Logs(100); response.Code != "unsupported" || response.Content != "" {
		t.Fatalf("logs response = %#v", response)
	}
}

type fakeRunner struct {
	mu     sync.Mutex
	done   chan struct{}
	name   string
	args   []string
	output string
	err    error
}

func newFakeRunner() *fakeRunner {
	return &fakeRunner{done: make(chan struct{}, 1)}
}

func (r *fakeRunner) Run(ctx context.Context, name string, args ...string) error {
	_, err := r.Output(ctx, name, args...)
	return err
}

func (r *fakeRunner) Output(ctx context.Context, name string, args ...string) (string, error) {
	r.mu.Lock()
	r.name = name
	r.args = args
	r.mu.Unlock()
	select {
	case r.done <- struct{}{}:
	default:
	}
	return r.output, r.err
}

func (r *fakeRunner) wait() bool {
	select {
	case <-r.done:
		return true
	case <-time.After(time.Second):
		return false
	}
}
