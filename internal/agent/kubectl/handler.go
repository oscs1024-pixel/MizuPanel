package kubectl

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

// Handler kubectl 消息处理器
type Handler struct {
	clients map[string]*Client // clusterID -> Client
	debug   bool
}

// NewHandler 创建消息处理器
func NewHandler() *Handler {
	return &Handler{clients: make(map[string]*Client)}
}

func (h *Handler) SetDebug(debug bool) {
	h.debug = debug
}

type messageMeta struct {
	RequestID string `json:"request_id"`
	ClusterID string `json:"cluster_id"`
	Namespace string `json:"namespace"`
}

func k8sMessageMeta(data json.RawMessage) messageMeta {
	var meta messageMeta
	_ = json.Unmarshal(data, &meta)
	return meta
}

// Handle 处理 kubectl 相关消息
func (h *Handler) Handle(ctx context.Context, msgType string, data json.RawMessage, sendFunc func(interface{}) error) (err error) {
	meta := k8sMessageMeta(data)
	start := time.Now()
	if h.debug {
		log.Printf("[debug][agent][k8s] handle start type=%s request_id=%s cluster_id=%s namespace=%s", msgType, meta.RequestID, meta.ClusterID, meta.Namespace)
	}
	defer func() {
		if !h.debug {
			return
		}
		if err != nil {
			log.Printf("[debug][agent][k8s] handle done type=%s request_id=%s cluster_id=%s namespace=%s elapsed=%s error=%v", msgType, meta.RequestID, meta.ClusterID, meta.Namespace, time.Since(start), err)
			return
		}
		log.Printf("[debug][agent][k8s] handle done type=%s request_id=%s cluster_id=%s namespace=%s elapsed=%s success=true", msgType, meta.RequestID, meta.ClusterID, meta.Namespace, time.Since(start))
	}()
	switch msgType {
	case protocol.MessageTypeK8sClusterConnect:
		return h.handleClusterConnect(ctx, data, sendFunc)
	case protocol.MessageTypeK8sGetSummary:
		return h.handleGetSummary(ctx, data, sendFunc)
	case protocol.MessageTypeK8sGetNamespaces:
		return h.handleGetNamespaces(ctx, data, sendFunc)
	case protocol.MessageTypeK8sGetNodes:
		return h.handleGetNodes(ctx, data, sendFunc)
	case protocol.MessageTypeK8sGetPods:
		return h.handleGetPods(ctx, data, sendFunc)
	case protocol.MessageTypeK8sGetDeployments:
		return h.handleGetDeployments(ctx, data, sendFunc)
	case protocol.MessageTypeK8sGetStatefulSets:
		return h.handleGetStatefulSets(ctx, data, sendFunc)
	case protocol.MessageTypeK8sGetDaemonSets:
		return h.handleGetDaemonSets(ctx, data, sendFunc)
	case protocol.MessageTypeK8sGetServices:
		return h.handleGetServices(ctx, data, sendFunc)
	case protocol.MessageTypeK8sGetIngresses:
		return h.handleGetIngresses(ctx, data, sendFunc)
	case protocol.MessageTypeK8sGetPodLogs:
		return h.handleGetPodLogs(ctx, data, sendFunc)
	}
	return nil
}

func (h *Handler) clientFor(clusterID, kubeconfigContent, contextName string) (*Client, error) {
	if client, ok := h.clients[clusterID]; ok {
		return client, nil
	}
	client, err := NewClientFromKubeconfig(kubeconfigContent, contextName)
	if err != nil {
		return nil, err
	}
	h.clients[clusterID] = client
	return client, nil
}

func (h *Handler) handleClusterConnect(ctx context.Context, data json.RawMessage, sendFunc func(interface{}) error) error {
	var req protocol.K8sClusterConnectRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return h.sendConnectError(req.RequestID, "解析连接请求失败", sendFunc)
	}

	if h.debug {
		log.Printf("[debug][agent][k8s] connect cluster_id=%s request_id=%s context=%s", req.ClusterID, req.RequestID, req.Context)
	}
	client, err := NewClientFromKubeconfig(req.KubeconfigContent, req.Context)
	if err != nil {
		return h.sendConnectError(req.RequestID, err.Error(), sendFunc)
	}
	clusterInfo, err := client.GetClusterInfo(ctx)
	if err != nil {
		return h.sendConnectError(req.RequestID, err.Error(), sendFunc)
	}
	h.clients[req.ClusterID] = client
	return sendFunc(protocol.K8sClusterConnectResult{Type: protocol.MessageTypeK8sClusterConnectResult, RequestID: req.RequestID, Success: true, ClusterInfo: &protocol.K8sClusterInfo{Version: clusterInfo.Version, NodeCount: clusterInfo.NodeCount, NamespaceCount: clusterInfo.NamespaceCount}})
}

func (h *Handler) resourceClient(data json.RawMessage) (protocol.K8sResourceRequest, *Client, error) {
	var req protocol.K8sResourceRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return req, nil, err
	}
	client, err := h.clientFor(req.ClusterID, req.KubeconfigContent, req.Context)
	return req, client, err
}

func (h *Handler) handleGetSummary(ctx context.Context, data json.RawMessage, sendFunc func(interface{}) error) error {
	req, client, err := h.resourceClient(data)
	if err != nil {
		return sendFunc(protocol.K8sGetSummaryResult{Type: protocol.MessageTypeK8sGetSummaryResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	items, err := client.GetSummary(ctx)
	if err != nil {
		return sendFunc(protocol.K8sGetSummaryResult{Type: protocol.MessageTypeK8sGetSummaryResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	return sendFunc(protocol.K8sGetSummaryResult{Type: protocol.MessageTypeK8sGetSummaryResult, RequestID: req.RequestID, Success: true, Summary: items})
}

func (h *Handler) handleGetNamespaces(ctx context.Context, data json.RawMessage, sendFunc func(interface{}) error) error {
	req, client, err := h.resourceClient(data)
	if err != nil {
		return sendFunc(protocol.K8sGetNamespacesResult{Type: protocol.MessageTypeK8sGetNamespacesResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	items, err := client.GetNamespaces(ctx)
	if err != nil {
		return sendFunc(protocol.K8sGetNamespacesResult{Type: protocol.MessageTypeK8sGetNamespacesResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	return sendFunc(protocol.K8sGetNamespacesResult{Type: protocol.MessageTypeK8sGetNamespacesResult, RequestID: req.RequestID, Success: true, Namespaces: items})
}

func (h *Handler) handleGetNodes(ctx context.Context, data json.RawMessage, sendFunc func(interface{}) error) error {
	req, client, err := h.resourceClient(data)
	if err != nil {
		return sendFunc(protocol.K8sGetNodesResult{Type: protocol.MessageTypeK8sGetNodesResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	items, err := client.GetNodes(ctx)
	if err != nil {
		return sendFunc(protocol.K8sGetNodesResult{Type: protocol.MessageTypeK8sGetNodesResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	return sendFunc(protocol.K8sGetNodesResult{Type: protocol.MessageTypeK8sGetNodesResult, RequestID: req.RequestID, Success: true, Nodes: items})
}

func (h *Handler) handleGetPods(ctx context.Context, data json.RawMessage, sendFunc func(interface{}) error) error {
	var req protocol.K8sGetPodsRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return h.sendPodsError(req.RequestID, "解析查询请求失败", sendFunc)
	}
	client, err := h.clientFor(req.ClusterID, req.KubeconfigContent, req.Context)
	if err != nil {
		return h.sendPodsError(req.RequestID, err.Error(), sendFunc)
	}
	pods, err := client.GetProtocolPods(ctx, req.Namespace)
	if err != nil {
		return h.sendPodsError(req.RequestID, err.Error(), sendFunc)
	}
	return sendFunc(protocol.K8sGetPodsResult{Type: protocol.MessageTypeK8sGetPodsResult, RequestID: req.RequestID, Success: true, Pods: pods})
}

func (h *Handler) handleGetDeployments(ctx context.Context, data json.RawMessage, sendFunc func(interface{}) error) error {
	req, client, err := h.resourceClient(data)
	if err != nil {
		return sendFunc(protocol.K8sGetDeploymentsResult{Type: protocol.MessageTypeK8sGetDeploymentsResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	items, err := client.GetDeployments(ctx, req.Namespace)
	if err != nil {
		return sendFunc(protocol.K8sGetDeploymentsResult{Type: protocol.MessageTypeK8sGetDeploymentsResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	return sendFunc(protocol.K8sGetDeploymentsResult{Type: protocol.MessageTypeK8sGetDeploymentsResult, RequestID: req.RequestID, Success: true, Deployments: items})
}

func (h *Handler) handleGetStatefulSets(ctx context.Context, data json.RawMessage, sendFunc func(interface{}) error) error {
	req, client, err := h.resourceClient(data)
	if err != nil {
		return sendFunc(protocol.K8sGetStatefulSetsResult{Type: protocol.MessageTypeK8sGetStatefulSetsResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	items, err := client.GetStatefulSets(ctx, req.Namespace)
	if err != nil {
		return sendFunc(protocol.K8sGetStatefulSetsResult{Type: protocol.MessageTypeK8sGetStatefulSetsResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	return sendFunc(protocol.K8sGetStatefulSetsResult{Type: protocol.MessageTypeK8sGetStatefulSetsResult, RequestID: req.RequestID, Success: true, StatefulSets: items})
}

func (h *Handler) handleGetDaemonSets(ctx context.Context, data json.RawMessage, sendFunc func(interface{}) error) error {
	req, client, err := h.resourceClient(data)
	if err != nil {
		return sendFunc(protocol.K8sGetDaemonSetsResult{Type: protocol.MessageTypeK8sGetDaemonSetsResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	items, err := client.GetDaemonSets(ctx, req.Namespace)
	if err != nil {
		return sendFunc(protocol.K8sGetDaemonSetsResult{Type: protocol.MessageTypeK8sGetDaemonSetsResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	return sendFunc(protocol.K8sGetDaemonSetsResult{Type: protocol.MessageTypeK8sGetDaemonSetsResult, RequestID: req.RequestID, Success: true, DaemonSets: items})
}

func (h *Handler) handleGetServices(ctx context.Context, data json.RawMessage, sendFunc func(interface{}) error) error {
	req, client, err := h.resourceClient(data)
	if err != nil {
		return sendFunc(protocol.K8sGetServicesResult{Type: protocol.MessageTypeK8sGetServicesResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	items, err := client.GetServices(ctx, req.Namespace)
	if err != nil {
		return sendFunc(protocol.K8sGetServicesResult{Type: protocol.MessageTypeK8sGetServicesResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	return sendFunc(protocol.K8sGetServicesResult{Type: protocol.MessageTypeK8sGetServicesResult, RequestID: req.RequestID, Success: true, Services: items})
}

func (h *Handler) handleGetIngresses(ctx context.Context, data json.RawMessage, sendFunc func(interface{}) error) error {
	req, client, err := h.resourceClient(data)
	if err != nil {
		return sendFunc(protocol.K8sGetIngressesResult{Type: protocol.MessageTypeK8sGetIngressesResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	items, err := client.GetIngresses(ctx, req.Namespace)
	if err != nil {
		return sendFunc(protocol.K8sGetIngressesResult{Type: protocol.MessageTypeK8sGetIngressesResult, RequestID: req.RequestID, Success: false, Error: err.Error()})
	}
	return sendFunc(protocol.K8sGetIngressesResult{Type: protocol.MessageTypeK8sGetIngressesResult, RequestID: req.RequestID, Success: true, Ingresses: items})
}

func (h *Handler) handleGetPodLogs(ctx context.Context, data json.RawMessage, sendFunc func(interface{}) error) error {
	var req protocol.K8sGetPodLogsRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return h.sendLogsError(req.RequestID, "解析日志请求失败", sendFunc)
	}
	client, err := h.clientFor(req.ClusterID, req.KubeconfigContent, req.Context)
	if err != nil {
		return h.sendLogsError(req.RequestID, err.Error(), sendFunc)
	}
	logs, err := client.GetPodLogs(ctx, req.Namespace, req.PodName, req.Container, req.Follow, req.TailLines)
	if err != nil {
		return h.sendLogsError(req.RequestID, err.Error(), sendFunc)
	}
	return sendFunc(protocol.K8sGetPodLogsResult{Type: protocol.MessageTypeK8sGetPodLogsResult, RequestID: req.RequestID, Success: true, Logs: logs, Stream: req.Follow})
}

func (h *Handler) sendConnectError(requestID, errMsg string, sendFunc func(interface{}) error) error {
	return sendFunc(protocol.K8sClusterConnectResult{Type: protocol.MessageTypeK8sClusterConnectResult, RequestID: requestID, Success: false, Error: errMsg})
}

func (h *Handler) sendPodsError(requestID, errMsg string, sendFunc func(interface{}) error) error {
	return sendFunc(protocol.K8sGetPodsResult{Type: protocol.MessageTypeK8sGetPodsResult, RequestID: requestID, Success: false, Error: errMsg})
}

func (h *Handler) sendLogsError(requestID, errMsg string, sendFunc func(interface{}) error) error {
	return sendFunc(protocol.K8sGetPodLogsResult{Type: protocol.MessageTypeK8sGetPodLogsResult, RequestID: requestID, Success: false, Error: errMsg})
}
