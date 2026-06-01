package app

import (
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mizupanel/mizupanel/internal/server/agenthub"
	"github.com/mizupanel/mizupanel/internal/server/api"
	"github.com/mizupanel/mizupanel/internal/server/store"
)

//go:embed install-agent.sh
var agentInstallScript []byte

//go:embed install-agent.ps1
var windowsAgentInstallScript []byte

//go:embed uninstall-agent.sh
var agentUninstallScript []byte

//go:embed uninstall-agent.ps1
var windowsAgentUninstallScript []byte

type Dependencies struct {
	Nodes            *store.NodeStore
	Metrics          *store.MetricStore
	ProcessSnapshots *store.ProcessSnapshotStore
	DockerSnapshots  *store.DockerSnapshotStore
	AgentTokens      *store.AgentTokenStore
	Settings         *store.SettingsStore
	AgentToken       string
	PublicURL        string
	Interval         int
	StaticDir        string
	DownloadDir      string
	EnableTerminal   bool
	MetricsRetention time.Duration
}

func NewHandler(deps Dependencies) http.Handler {
	mux := http.NewServeMux()
	installAuth := agenthub.NewInstallAuthStore()
	hub := agenthub.NewHandler(deps.Nodes, deps.Metrics, agenthub.Options{
		AgentToken:       deps.AgentToken,
		InstallAuth:      installAuth,
		AgentTokens:      deps.AgentTokens,
		ProcessSnapshots: deps.ProcessSnapshots,
		DockerSnapshots:  deps.DockerSnapshots,
		Interval:         deps.Interval,
	})
	apiRouter := api.NewRouter(deps.Nodes, deps.Metrics, deps.ProcessSnapshots, deps.DockerSnapshots, hub, api.TerminalConfig{Enabled: deps.EnableTerminal}, api.SettingsConfig{Store: deps.Settings, DefaultMetricsRetention: deps.MetricsRetention})
	mux.Handle("/api/settings", apiRouter)
	mux.Handle("/api/nodes", apiRouter)
	mux.Handle("/api/nodes/", apiRouter)
	mux.HandleFunc("/api/install/command", func(w http.ResponseWriter, r *http.Request) {
		handleInstallCommand(w, r, deps.PublicURL, installAuth)
	})
	mux.Handle("/api/agent/ws", hub)
	mux.HandleFunc("/scripts/install-agent.sh", agentInstallScriptHandler)
	mux.HandleFunc("/scripts/install-agent.ps1", windowsAgentInstallScriptHandler)
	mux.HandleFunc("/scripts/uninstall-agent.sh", agentUninstallScriptHandler)
	mux.HandleFunc("/scripts/uninstall-agent.ps1", windowsAgentUninstallScriptHandler)
	if deps.DownloadDir != "" {
		mux.Handle("/downloads/", downloadHandler(deps.DownloadDir))
	}
	if deps.StaticDir != "" {
		mux.Handle("/", staticHandler(deps.StaticDir))
	}
	return mux
}

func agentInstallScriptHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(agentInstallScript)
}

func windowsAgentInstallScriptHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(windowsAgentInstallScript)
}

func agentUninstallScriptHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(agentUninstallScript)
}

func windowsAgentUninstallScriptHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(windowsAgentUninstallScript)
}

type installPlatform string

type installMode string

const (
	installPlatformLinux   installPlatform = "linux"
	installPlatformWindows installPlatform = "windows"
	installModeNormal      installMode     = "normal"
	installModeOps         installMode     = "ops"
)

func parseInstallPlatform(value string) (installPlatform, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", string(installPlatformLinux):
		return installPlatformLinux, true
	case string(installPlatformWindows):
		return installPlatformWindows, true
	default:
		return "", false
	}
}

func parseInstallMode(value string) (installMode, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", string(installModeNormal):
		return installModeNormal, true
	case string(installModeOps):
		return installModeOps, true
	default:
		return "", false
	}
}

func handleInstallCommand(w http.ResponseWriter, r *http.Request, publicURL string, installAuth *agenthub.InstallAuthStore) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	platform, ok := parseInstallPlatform(r.URL.Query().Get("platform"))
	if !ok {
		http.Error(w, "unsupported install platform", http.StatusBadRequest)
		return
	}
	mode, ok := parseInstallMode(r.URL.Query().Get("mode"))
	if !ok || platform == installPlatformWindows && mode == installModeOps {
		http.Error(w, "unsupported install mode", http.StatusBadRequest)
		return
	}
	installToken, err := randomToken()
	if err != nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	if !installAuth.CreateInstallToken(installToken) {
		http.Error(w, "too many install tokens", http.StatusTooManyRequests)
		return
	}
	baseURL, wsURL := installURLs(publicURL, r)
	enableDocker := platform == installPlatformLinux && r.URL.Query().Get("enable_docker") == "true"
	enableTerminal := platform == installPlatformLinux && r.URL.Query().Get("enable_terminal") == "true"
	command := linuxInstallCommand(baseURL, wsURL, installToken, enableDocker, enableTerminal, mode)
	if platform == installPlatformWindows {
		command = windowsInstallCommand(baseURL, wsURL, installToken)
	}
	writeJSON(w, http.StatusOK, map[string]string{"command": command, "install_token": installToken})
}

func linuxInstallCommand(baseURL, wsURL, installToken string, enableDocker bool, enableTerminal bool, mode installMode) string {
	lines := []string{
		fmt.Sprintf("curl -fsSL %s -o install-agent.sh \\", shellQuote(baseURL+"/scripts/install-agent.sh")),
		"  && chmod +x install-agent.sh \\",
		"  && sudo ./install-agent.sh \\",
		fmt.Sprintf("    --binary-base-url %s \\", shellQuote(baseURL+"/downloads")),
		fmt.Sprintf("    --server-url %s \\", shellQuote(wsURL)),
		fmt.Sprintf("    --token %s \\", shellQuote(installToken)),
		fmt.Sprintf("    --mode %s \\", shellQuote(string(mode))),
		"    --node-id \"$(hostname)\" \\",
		"    --name \"$(hostname)\"",
	}
	for _, option := range []struct {
		enabled bool
		flag    string
	}{
		{enabled: enableDocker, flag: "--enable-docker"},
		{enabled: enableTerminal, flag: "--enable-terminal"},
	} {
		if option.enabled {
			lines[len(lines)-1] += " \\"
			lines = append(lines, "    "+option.flag)
		}
	}
	return strings.Join(lines, "\n")
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func powershellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func windowsInstallCommand(baseURL, wsURL, installToken string) string {
	return strings.Join([]string{
		fmt.Sprintf("powershell -NoProfile -ExecutionPolicy Bypass -Command \"`$ErrorActionPreference='Stop'; `$script = Join-Path `$env:TEMP ('mizupanel-install-' + [guid]::NewGuid().ToString() + '.ps1'); Invoke-WebRequest -Uri %s -UseBasicParsing -OutFile `$script -ErrorAction Stop; & `$script `", powershellQuote(baseURL+"/scripts/install-agent.ps1")),
		fmt.Sprintf("    -BinaryBaseUrl %s `", powershellQuote(baseURL+"/downloads")),
		fmt.Sprintf("    -ServerUrl %s `", powershellQuote(wsURL)),
		fmt.Sprintf("    -Token %s `", powershellQuote(installToken)),
		"    -NodeId `$env:COMPUTERNAME `",
		"    -Name `$env:COMPUTERNAME\"",
	}, "\n")
}

func installURLs(publicURL string, r *http.Request) (string, string) {
	baseURL := strings.TrimRight(publicURL, "/")
	if baseURL == "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		baseURL = fmt.Sprintf("%s://%s", scheme, r.Host)
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return baseURL, baseURL + "/api/agent/ws"
	}
	wsScheme := "ws"
	if parsed.Scheme == "https" {
		wsScheme = "wss"
	}
	basePath := strings.TrimRight(parsed.Path, "/")
	parsed.Scheme = wsScheme
	parsed.Path = basePath + "/api/agent/ws"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return baseURL, parsed.String()
}

func randomToken() (string, error) {
	var bytes [24]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func downloadHandler(dir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/downloads/")
		if name == "" || name != filepath.Base(name) {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		http.ServeFile(w, r, filepath.Join(dir, name))
	})
}

func staticHandler(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(dir, filepath.Clean(r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			files.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}
