package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/mizupanel/mizupanel/internal/server/store"
)

type Server struct {
	nodes   *store.NodeStore
	metrics *store.MetricStore
}

func NewRouter(nodes *store.NodeStore, metrics *store.MetricStore) *http.ServeMux {
	server := &Server{nodes: nodes, metrics: metrics}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/nodes", server.handleNodes)
	mux.HandleFunc("/api/nodes/", server.handleNodeRoutes)
	return mux
}

func (s *Server) handleNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	nodes, err := s.nodes.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	response := struct {
		Nodes []NodeResponse `json:"nodes"`
	}{Nodes: make([]NodeResponse, 0, len(nodes))}
	for _, node := range nodes {
		item := nodeResponse(node)
		metric, ok, err := s.metrics.Latest(r.Context(), node.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if ok {
			latest := metricResponse(metric)
			item.LatestMetric = &latest
		}
		response.Nodes = append(response.Nodes, item)
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleNodeRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/nodes/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 2 && parts[1] == "metrics" {
		s.handleNodeMetrics(w, r, parts[0])
		return
	}
	if len(parts) == 1 && parts[0] != "" && r.Method == http.MethodGet {
		s.handleNode(w, r, parts[0])
		return
	}
	http.NotFound(w, r)
}

func (s *Server) handleNode(w http.ResponseWriter, r *http.Request, id string) {
	node, err := s.nodes.Get(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "node not found")
		return
	}
	writeJSON(w, http.StatusOK, nodeResponse(node))
}

func (s *Server) handleNodeMetrics(w http.ResponseWriter, r *http.Request, nodeID string) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	rangeValue := r.URL.Query().Get("range")
	duration, ok := map[string]time.Duration{
		"1h": time.Hour,
		"6h": 6 * time.Hour,
	}[rangeValue]
	if !ok {
		writeError(w, http.StatusBadRequest, "range must be 1h or 6h")
		return
	}
	now := time.Now().UTC()
	metrics, err := s.metrics.ListRange(r.Context(), nodeID, now.Add(-duration), now)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	response := struct {
		Metrics []MetricResponse `json:"metrics"`
	}{Metrics: make([]MetricResponse, 0, len(metrics))}
	for _, metric := range metrics {
		response.Metrics = append(response.Metrics, metricResponse(metric))
	}
	writeJSON(w, http.StatusOK, response)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
