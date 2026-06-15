package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/mizupanel/mizupanel/internal/server/k8s"
)

// handleK8sClusters 处理 K8s 集群列表
func (s *Server) handleK8sClusters(k8sService *k8s.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			s.handleGetK8sClusters(k8sService, w, r)
		case http.MethodPost:
			s.handleConnectK8sCluster(k8sService, w, r)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

// handleGetK8sClusters 获取集群列表
func (s *Server) handleGetK8sClusters(k8sService *k8s.Service, w http.ResponseWriter, r *http.Request) {
	clusters, err := k8sService.ListClustersWithNodeInfo()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "获取集群列表失败: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"clusters": clusters,
	})
}

// handleConnectK8sCluster 连接新集群
func (s *Server) handleConnectK8sCluster(k8sService *k8s.Service, w http.ResponseWriter, r *http.Request) {
	var req k8s.ConnectClusterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求格式错误")
		return
	}

	cluster, clusterInfo, err := k8sService.ConnectCluster(r.Context(), &req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":      true,
		"cluster":      cluster,
		"cluster_info": clusterInfo,
	})
}

// handleK8sClusterRoutes 处理单个集群的路由
func (s *Server) handleK8sClusterRoutes(k8sService *k8s.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// /api/k8s/clusters/:id/...
		path := strings.TrimPrefix(r.URL.Path, "/api/k8s/clusters/")
		parts := strings.Split(path, "/")
		if len(parts) < 1 {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		clusterID := parts[0]

		// /api/k8s/clusters/:id
		if len(parts) == 1 {
			switch r.Method {
			case http.MethodGet:
				s.handleGetK8sCluster(k8sService, clusterID, w, r)
			case http.MethodDelete:
				s.handleDeleteK8sCluster(k8sService, clusterID, w, r)
			default:
				w.WriteHeader(http.StatusMethodNotAllowed)
			}
			return
		}

		// /api/k8s/clusters/:id/pods
		if len(parts) == 2 && parts[1] == "pods" {
			s.handleGetK8sPods(k8sService, clusterID, w, r)
			return
		}

		// /api/k8s/clusters/:id/pods/:namespace/:name/logs
		if len(parts) == 5 && parts[1] == "pods" && parts[4] == "logs" {
			namespace := parts[2]
			podName := parts[3]
			s.handleGetK8sPodLogs(k8sService, clusterID, namespace, podName, w, r)
			return
		}

		w.WriteHeader(http.StatusNotFound)
	}
}

// handleGetK8sCluster 获取集群详情
func (s *Server) handleGetK8sCluster(k8sService *k8s.Service, clusterID string, w http.ResponseWriter, r *http.Request) {
	cluster, err := k8sService.GetCluster(clusterID)
	if err != nil {
		writeError(w, http.StatusNotFound, "集群不存在")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"cluster": cluster,
	})
}

// handleDeleteK8sCluster 删除集群
func (s *Server) handleDeleteK8sCluster(k8sService *k8s.Service, clusterID string, w http.ResponseWriter, r *http.Request) {
	if err := k8sService.DeleteCluster(clusterID); err != nil {
		writeError(w, http.StatusInternalServerError, "删除集群失败: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
	})
}

// handleGetK8sPods 获取 Pod 列表
func (s *Server) handleGetK8sPods(k8sService *k8s.Service, clusterID string, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	namespace := r.URL.Query().Get("namespace")

	pods, err := k8sService.GetPods(r.Context(), clusterID, namespace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"pods":    pods,
	})
}

// handleGetK8sPodLogs 获取 Pod 日志
func (s *Server) handleGetK8sPodLogs(k8sService *k8s.Service, clusterID, namespace, podName string, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	container := r.URL.Query().Get("container")
	follow := r.URL.Query().Get("follow") == "true"
	tailLines := 100
	if t := r.URL.Query().Get("tail_lines"); t != "" {
		if n, err := strconv.Atoi(t); err == nil && n > 0 {
			tailLines = n
		}
	}

	logs, err := k8sService.GetPodLogs(r.Context(), clusterID, namespace, podName, container, follow, tailLines)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"logs":    logs,
	})
}
