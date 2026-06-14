package api

import (
	"net/http"
	"strconv"

	"github.com/mizupanel/mizupanel/internal/server/store"
)

func (s *Server) handleAlertHistory(alertStore *store.AlertStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}

		nodeID := r.URL.Query().Get("node_id")
		if nodeID == "" {
			writeError(w, http.StatusBadRequest, "node_id is required")
			return
		}

		limit := 100
		if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
			if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 && parsed <= 1000 {
				limit = parsed
			}
		}

		history, err := alertStore.GetAlertHistory(nodeID, limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"history": history})
	}
}
