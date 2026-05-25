package app

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	_ "github.com/mattn/go-sqlite3"

	"github.com/mizupanel/mizupanel/internal/protocol"
	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
	"github.com/mizupanel/mizupanel/internal/server/store"
)

func TestNewHandlerCreatesInstallCommandWithoutLogin(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	handler := NewHandler(Dependencies{
		Nodes:   store.NewNodeStore(database),
		Metrics: store.NewMetricStore(database),
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/install/command", nil)
	request.Host = "panel.example:8080"
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "curl -fsSL 'http://panel.example:8080/scripts/install-agent.sh'") {
		t.Fatalf("install command missing script URL: %s", body)
	}
	if !strings.Contains(body, "--binary-base-url 'http://panel.example:8080/downloads'") {
		t.Fatalf("install command missing binary base URL: %s", body)
	}
	if strings.Contains(body, "<install_token>") || strings.Contains(body, "agent_token") {
		t.Fatalf("install command exposed placeholder or global token language: %s", body)
	}
}

func TestNewHandlerCreatesInstallCommandFromPublicURL(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	handler := NewHandler(Dependencies{
		Nodes:     store.NewNodeStore(database),
		Metrics:   store.NewMetricStore(database),
		PublicURL: "https://panel.example",
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/install/command", nil)
	request.Host = "internal:8080"
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "curl -fsSL 'https://panel.example/scripts/install-agent.sh'") {
		t.Fatalf("install command missing public script URL: %s", body)
	}
	if !strings.Contains(body, "--binary-base-url 'https://panel.example/downloads'") {
		t.Fatalf("install command missing public binary base URL: %s", body)
	}
	if !strings.Contains(body, "--server-url 'wss://panel.example/api/agent/ws'") {
		t.Fatalf("install command missing public websocket URL: %s", body)
	}
	if strings.Contains(body, "internal:8080") {
		t.Fatalf("install command leaked internal host: %s", body)
	}
}

func TestNewHandlerCreatesInstallCommandFromPublicURLWithPathPrefix(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	handler := NewHandler(Dependencies{
		Nodes:     store.NewNodeStore(database),
		Metrics:   store.NewMetricStore(database),
		PublicURL: "https://panel.example/mizupanel",
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/install/command", nil)
	request.Host = "internal:8080"
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "curl -fsSL 'https://panel.example/mizupanel/scripts/install-agent.sh'") {
		t.Fatalf("install command missing public script URL with path prefix: %s", body)
	}
	if !strings.Contains(body, "--binary-base-url 'https://panel.example/mizupanel/downloads'") {
		t.Fatalf("install command missing public binary base URL with path prefix: %s", body)
	}
	if !strings.Contains(body, "--server-url 'wss://panel.example/mizupanel/api/agent/ws'") {
		t.Fatalf("install command missing public websocket URL with path prefix: %s", body)
	}
	if strings.Contains(body, "internal:8080") {
		t.Fatalf("install command leaked internal host: %s", body)
	}
}

func TestNewHandlerGeneratedInstallTokenRegistersAgentAndReturnsNodeToken(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	database.SetMaxOpenConns(1)
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	handler := NewHandler(Dependencies{
		Nodes:    store.NewNodeStore(database),
		Metrics:  store.NewMetricStore(database),
		Interval: 5,
	})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/install/command", nil)
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("install command status = %d, want 200", recorder.Code)
	}
	var response struct {
		InstallToken string `json:"install_token"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode install command response: %v", err)
	}
	if response.InstallToken == "" {
		t.Fatal("install_token is empty")
	}

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/agent/ws?token=" + response.InstallToken
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close()
	if err := conn.WriteJSON(protocol.HelloMessage{Type: protocol.MessageTypeHello, NodeID: "node-1", Hostname: "oracle-sg"}); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	var ack protocol.HelloAckMessage
	if err := conn.ReadJSON(&ack); err != nil {
		t.Fatalf("read ack: %v", err)
	}
	if ack.NodeToken == "" || ack.NodeToken == response.InstallToken {
		t.Fatalf("NodeToken = %q, want generated node token", ack.NodeToken)
	}
}

func TestServedAgentInstallScriptSelectsBinaryURLForMachineArchitecture(t *testing.T) {
	downloads := make(map[string]int)
	binaryServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downloads[r.URL.Path]++
		if r.URL.Path != "/downloads/mizupanel-agent-linux-arm64" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte("arm64-agent"))
	}))
	t.Cleanup(binaryServer.Close)

	script := filepath.Join(t.TempDir(), "install-agent.sh")
	if err := os.WriteFile(script, agentInstallScript, 0755); err != nil {
		t.Fatalf("write embedded script: %v", err)
	}
	dest := t.TempDir()
	fakeBin := t.TempDir()
	if err := os.WriteFile(filepath.Join(fakeBin, "uname"), []byte("#!/bin/sh\nif [ \"$1\" = \"-s\" ]; then echo Linux; else echo aarch64; fi\n"), 0755); err != nil {
		t.Fatalf("write fake uname: %v", err)
	}
	if err := os.WriteFile(filepath.Join(fakeBin, "systemctl"), []byte("#!/bin/sh\necho systemctl should not run in dest-root mode >&2\nexit 1\n"), 0755); err != nil {
		t.Fatalf("write fake systemctl: %v", err)
	}

	output, err := runCommand(t, script, map[string]string{"PATH": fakeBin + string(os.PathListSeparator) + os.Getenv("PATH")},
		"--dest-root", dest,
		"--binary-base-url", binaryServer.URL+"/downloads",
		"--server-url", "ws://panel.example.com:8080/api/agent/ws",
		"--token", "install-token",
		"--node-id", "oracle-sg-01",
		"--name", "Oracle SG",
	)
	if err != nil {
		t.Fatalf("embedded install script failed: %v\n%s", err, output)
	}
	if downloads["/downloads/mizupanel-agent-linux-arm64"] != 1 {
		t.Fatalf("arm64 binary downloads = %d, want 1", downloads["/downloads/mizupanel-agent-linux-arm64"])
	}
	installedBinary, err := os.ReadFile(filepath.Join(dest, "usr", "local", "mizupanel", "mizupanel-agent"))
	if err != nil {
		t.Fatalf("read downloaded binary: %v", err)
	}
	if string(installedBinary) != "arm64-agent" {
		t.Fatalf("installed binary = %q, want arm64 payload", installedBinary)
	}
}

func TestEmbeddedAgentInstallScriptMatchesRepositoryScript(t *testing.T) {
	repositoryScript, err := os.ReadFile(filepath.Join("..", "..", "..", "scripts", "install-agent.sh"))
	if err != nil {
		t.Fatalf("read repository install script: %v", err)
	}
	if string(agentInstallScript) != string(repositoryScript) {
		t.Fatal("embedded install script differs from scripts/install-agent.sh")
	}
}

func TestNewHandlerMountsNodeAPIWithoutLogin(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	handler := NewHandler(Dependencies{
		Nodes:   store.NewNodeStore(database),
		Metrics: store.NewMetricStore(database),
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/nodes", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
}

func TestNewHandlerServesAgentBinaryDownload(t *testing.T) {
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "mizupanel-agent-linux-amd64")
	if err := os.WriteFile(binaryPath, []byte("agent-binary"), 0755); err != nil {
		t.Fatalf("write agent binary: %v", err)
	}

	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	handler := NewHandler(Dependencies{
		Nodes:       store.NewNodeStore(database),
		Metrics:     store.NewMetricStore(database),
		DownloadDir: tempDir,
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/downloads/mizupanel-agent-linux-amd64", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if recorder.Body.String() != "agent-binary" {
		t.Fatalf("body = %q, want agent binary", recorder.Body.String())
	}
	if contentType := recorder.Header().Get("Content-Type"); contentType != "application/octet-stream" {
		t.Fatalf("Content-Type = %q, want application/octet-stream", contentType)
	}
}

func TestNewHandlerServesAgentInstallScript(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	handler := NewHandler(Dependencies{
		Nodes:   store.NewNodeStore(database),
		Metrics: store.NewMetricStore(database),
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/scripts/install-agent.sh", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if contentType := recorder.Header().Get("Content-Type"); contentType != "text/x-shellscript; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want shell script", contentType)
	}
	if body := recorder.Body.String(); body == "" || body[:19] != "#!/usr/bin/env bash" {
		t.Fatalf("unexpected script body prefix: %q", body)
	}
}

func TestNewHandlerServesEmbeddedAgentInstallScript(t *testing.T) {
	tempDir := t.TempDir()
	if err := os.Mkdir(filepath.Join(tempDir, "scripts"), 0755); err != nil {
		t.Fatalf("mkdir scripts: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tempDir, "scripts", "install-agent.sh"), []byte("#!/usr/bin/env bash\nprintf poisoned\n"), 0644); err != nil {
		t.Fatalf("write poisoned script: %v", err)
	}
	oldWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(oldWD) })

	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	handler := NewHandler(Dependencies{
		Nodes:   store.NewNodeStore(database),
		Metrics: store.NewMetricStore(database),
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/scripts/install-agent.sh", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	body := recorder.Body.String()
	if strings.Contains(body, "poisoned") {
		t.Fatalf("served script from process working directory: %q", body)
	}
	if !strings.Contains(body, "MizuPanel agent installed") {
		t.Fatalf("served script does not look like bundled installer: %q", body)
	}
}

func TestServedAgentInstallScriptGeneratesConfig(t *testing.T) {
	script := filepath.Join(t.TempDir(), "install-agent.sh")
	if err := os.WriteFile(script, agentInstallScript, 0755); err != nil {
		t.Fatalf("write embedded script: %v", err)
	}
	binary := filepath.Join(t.TempDir(), "mizupanel-agent")
	if err := os.WriteFile(binary, []byte("#!/bin/sh\n"), 0755); err != nil {
		t.Fatalf("write binary: %v", err)
	}
	dest := t.TempDir()
	fakeBin := t.TempDir()
	if err := os.WriteFile(filepath.Join(fakeBin, "systemctl"), []byte("#!/bin/sh\necho systemctl should not run in dest-root mode >&2\nexit 1\n"), 0755); err != nil {
		t.Fatalf("write fake systemctl: %v", err)
	}

	output, err := runCommand(t, script, map[string]string{"PATH": fakeBin + string(os.PathListSeparator) + os.Getenv("PATH")},
		"--dest-root", dest,
		"--binary", binary,
		"--server-url", "ws://panel.example.com:8080/api/agent/ws",
		"--token", "secret-token",
		"--node-id", "oracle-sg-01",
		"--name", "Oracle SG",
	)
	if err != nil {
		t.Fatalf("embedded install script failed: %v\n%s", err, output)
	}
	config, err := os.ReadFile(filepath.Join(dest, "usr", "local", "mizupanel", "agent.yaml"))
	if err != nil {
		t.Fatalf("read generated config: %v", err)
	}
	if !strings.Contains(string(config), `token: "secret-token"`) {
		t.Fatalf("generated config missing token:\n%s", config)
	}
}

func TestServedAgentInstallScriptDownloadsBinaryURL(t *testing.T) {
	binaryPayload := []byte("#!/bin/sh\necho mizupanel-agent\n")
	binaryServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/downloads/mizupanel-agent-linux-amd64" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(binaryPayload)
	}))
	t.Cleanup(binaryServer.Close)

	script := filepath.Join(t.TempDir(), "install-agent.sh")
	if err := os.WriteFile(script, agentInstallScript, 0755); err != nil {
		t.Fatalf("write embedded script: %v", err)
	}
	dest := t.TempDir()
	fakeBin := t.TempDir()
	if err := os.WriteFile(filepath.Join(fakeBin, "systemctl"), []byte("#!/bin/sh\necho systemctl should not run in dest-root mode >&2\nexit 1\n"), 0755); err != nil {
		t.Fatalf("write fake systemctl: %v", err)
	}

	output, err := runCommand(t, script, map[string]string{"PATH": fakeBin + string(os.PathListSeparator) + os.Getenv("PATH")},
		"--dest-root", dest,
		"--binary-url", binaryServer.URL+"/downloads/mizupanel-agent-linux-amd64",
		"--server-url", "ws://panel.example.com:8080/api/agent/ws",
		"--token", "install-token",
		"--node-id", "oracle-sg-01",
		"--name", "Oracle SG",
	)
	if err != nil {
		t.Fatalf("embedded install script failed: %v\n%s", err, output)
	}
	installedBinary, err := os.ReadFile(filepath.Join(dest, "usr", "local", "mizupanel", "mizupanel-agent"))
	if err != nil {
		t.Fatalf("read downloaded binary: %v", err)
	}
	if string(installedBinary) != string(binaryPayload) {
		t.Fatalf("installed binary = %q, want downloaded payload", installedBinary)
	}
	config, err := os.ReadFile(filepath.Join(dest, "usr", "local", "mizupanel", "agent.yaml"))
	if err != nil {
		t.Fatalf("read generated config: %v", err)
	}
	if !strings.Contains(string(config), `token: "install-token"`) {
		t.Fatalf("generated config missing install token:\n%s", config)
	}
}

func runCommand(t *testing.T, path string, env map[string]string, args ...string) (string, error) {
	t.Helper()
	cmd := exec.Command(path, args...)
	cmd.Env = os.Environ()
	for key, value := range env {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	output, err := cmd.CombinedOutput()
	return string(output), err
}

func TestNewHandlerMountsAgentWebSocketWithTokenCheck(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	handler := NewHandler(Dependencies{
		Nodes:      store.NewNodeStore(database),
		Metrics:    store.NewMetricStore(database),
		AgentToken: "secret",
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/agent/ws?token=wrong", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
}
