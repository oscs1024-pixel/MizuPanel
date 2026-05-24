package app

import (
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/mizupanel/mizupanel/internal/server/agenthub"
	"github.com/mizupanel/mizupanel/internal/server/api"
	"github.com/mizupanel/mizupanel/internal/server/store"
)

//go:embed install-agent.sh
var agentInstallScript []byte

type Dependencies struct {
	Nodes         *store.NodeStore
	Metrics       *store.MetricStore
	AgentToken    string
	AdminPassword string
	Interval      int
	StaticDir     string
	DownloadDir   string
}

func NewHandler(deps Dependencies) http.Handler {
	mux := http.NewServeMux()
	installAuth := agenthub.NewInstallAuthStore()
	auth := newAuthServer(deps.AdminPassword, installAuth)
	apiRouter := api.NewRouter(deps.Nodes, deps.Metrics)
	mux.Handle("/api/nodes", apiRouter)
	mux.Handle("/api/nodes/", apiRouter)
	mux.HandleFunc("/api/auth/login", auth.handleLogin)
	mux.HandleFunc("/api/install/command", auth.requireLogin(auth.handleInstallCommand))
	mux.Handle("/api/agent/ws", agenthub.NewHandler(deps.Nodes, deps.Metrics, agenthub.Options{
		AgentToken:  deps.AgentToken,
		InstallAuth: installAuth,
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

type authServer struct {
	mu            sync.Mutex
	sessions      map[string]struct{}
	adminPassword string
	installAuth   *agenthub.InstallAuthStore
}

func newAuthServer(adminPassword string, installAuth *agenthub.InstallAuthStore) *authServer {
	return &authServer{sessions: make(map[string]struct{}), adminPassword: adminPassword, installAuth: installAuth}
}

func (s *authServer) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var request struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if request.Password == "" || s.adminPassword == "" || subtle.ConstantTimeCompare([]byte(request.Password), []byte(s.adminPassword)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	sessionID, err := randomToken()
	if err != nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	s.mu.Lock()
	s.sessions[sessionID] = struct{}{}
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "mizupanel_session", Value: sessionID, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *authServer) requireLogin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("mizupanel_session")
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		s.mu.Lock()
		_, ok := s.sessions[cookie.Value]
		s.mu.Unlock()
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func (s *authServer) handleInstallCommand(w http.ResponseWriter, r *http.Request) {
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
	s.installAuth.CreateInstallToken(installToken)
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	wsScheme := "ws"
	if scheme == "https" {
		wsScheme = "wss"
	}
	baseURL := fmt.Sprintf("%s://%s", scheme, r.Host)
	command := strings.Join([]string{
		fmt.Sprintf("curl -fsSL '%s/scripts/install-agent.sh' -o install-agent.sh \\", baseURL),
		"  && chmod +x install-agent.sh \\",
		"  && sudo ./install-agent.sh \\",
		fmt.Sprintf("    --binary-base-url '%s/downloads' \\", baseURL),
		fmt.Sprintf("    --server-url '%s://%s/api/agent/ws' \\", wsScheme, r.Host),
		fmt.Sprintf("    --token '%s' \\", installToken),
		"    --node-id \"$(hostname)\" \\",
		"    --name \"$(hostname)\"",
	}, "\n")
	writeJSON(w, http.StatusOK, map[string]string{"command": command, "install_token": installToken})
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
