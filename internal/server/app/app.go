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

	"github.com/mizupanel/mizupanel/internal/server/agenthub"
	"github.com/mizupanel/mizupanel/internal/server/api"
	"github.com/mizupanel/mizupanel/internal/server/store"
)

//go:embed install-agent.sh
var agentInstallScript []byte

type Dependencies struct {
	Nodes       *store.NodeStore
	Metrics     *store.MetricStore
	AgentTokens *store.AgentTokenStore
	AgentToken  string
	PublicURL   string
	Interval    int
	StaticDir   string
	DownloadDir string
}

func NewHandler(deps Dependencies) http.Handler {
	mux := http.NewServeMux()
	installAuth := agenthub.NewInstallAuthStore()
	apiRouter := api.NewRouter(deps.Nodes, deps.Metrics)
	mux.Handle("/api/nodes", apiRouter)
	mux.Handle("/api/nodes/", apiRouter)
	mux.HandleFunc("/api/install/command", func(w http.ResponseWriter, r *http.Request) {
		handleInstallCommand(w, r, deps.PublicURL, installAuth)
	})
	mux.Handle("/api/agent/ws", agenthub.NewHandler(deps.Nodes, deps.Metrics, agenthub.Options{
		AgentToken:  deps.AgentToken,
		InstallAuth: installAuth,
		AgentTokens: deps.AgentTokens,
		Interval:    deps.Interval,
	}))
	mux.HandleFunc("/scripts/install-agent.sh", agentInstallScriptHandler)
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

func handleInstallCommand(w http.ResponseWriter, r *http.Request, publicURL string, installAuth *agenthub.InstallAuthStore) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
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
	command := strings.Join([]string{
		fmt.Sprintf("curl -fsSL '%s/scripts/install-agent.sh' -o install-agent.sh \\", baseURL),
		"  && chmod +x install-agent.sh \\",
		"  && sudo ./install-agent.sh \\",
		fmt.Sprintf("    --binary-base-url '%s/downloads' \\", baseURL),
		fmt.Sprintf("    --server-url '%s' \\", wsURL),
		fmt.Sprintf("    --token '%s' \\", installToken),
		"    --node-id \"$(hostname)\" \\",
		"    --name \"$(hostname)\"",
	}, "\n")
	writeJSON(w, http.StatusOK, map[string]string{"command": command, "install_token": installToken})
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
