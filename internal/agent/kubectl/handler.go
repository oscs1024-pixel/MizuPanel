package kubectl

import (
	"context"
	"encoding/json"
	"log"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

// Handler kubectl 消息处理器
type Handler struct {
	clients map[string]*Client // clusterID -> Client
}

// NewHandler 创建消息处理器
func NewHandler() *Handler {
	return &Handler{
		clients: make(map[string]*Client),
	}
}

// Handle 处理 kubectl 相关消息
func (h *Handler) Handle(ctx context.Context, msgType string, data json.RawMessage, sendFunc func(interface{}) error) error {
	switch msgType {
	case protocol.MessageTypeK8sClusterConnect:
		return h.handleClusterConnect(ctx, data, sendFunc)
	case protocol.MessageTypeK8sGetPods:
		return h.handleGetPods(ctx, data, sendFunc)
	case protocol.MessageTypeK8sGetPodLogs:
		return h.handleGetPodLogs(ctx, data, sendFunc)
	}
	return nil
}

// handleClusterConnect 处理集群连接验证
func (h *Handler) handleClusterConnect(ctx context.Context, data json.RawMessage, sendFunc func(interface{}) error) error {
	var req protocol.K8sClusterConnectRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return h.sendConnectError(req.RequestID, "解析连接请求失败", sendFunc)
	}

	log.Printf("[kubectl] 连接集群: kubeconfig=%s, context=%s", req.KubeconfigPath, req.Context)

	// 创建 kubectl 客户端
	client := NewClient(req.KubeconfigPath, req.Context)

	// 验证连接并获取集群信息
	clusterInfo, err := client.GetClusterInfo(ctx)
	if err != nil {
		return h.sendConnectError(req.RequestID, err.Error(), sendFunc)
	}

	// 存储客户端（使用 RequestID 作为临时 clusterID）
	h.clients[req.RequestID] = client

	// 发送成功响应
	result := protocol.K8sClusterConnectResult{
		Type:      protocol.MessageTypeK8sClusterConnectResult,
		RequestID: req.RequestID,
		Success:   true,
		ClusterInfo: &protocol.K8sClusterInfo{
			Version:        clusterInfo.Version,
			NodeCount:      clusterInfo.NodeCount,
			NamespaceCount: clusterInfo.NamespaceCount,
		},
	}
	return sendFunc(result)
}

// handleGetPods 处理 Pod 列表查询
func (h *Handler) handleGetPods(ctx context.Context, data json.RawMessage, sendFunc func(interface{}) error) error {
	var req protocol.K8sGetPodsRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return h.sendPodsError(req.RequestID, "解析查询请求失败", sendFunc)
	}

	log.Printf("[kubectl] 获取 Pod 列表: clusterID=%s, namespace=%s", req.ClusterID, req.Namespace)

	// 获取客户端
	client, ok := h.clients[req.ClusterID]
	if !ok {
		return h.sendPodsError(req.RequestID, "集群未连接", sendFunc)
	}

	// 查询 Pod 列表
	pods, err := client.GetPods(ctx, req.Namespace)
	if err != nil {
		return h.sendPodsError(req.RequestID, err.Error(), sendFunc)
	}

	// 转换为协议格式
	protocolPods := make([]protocol.K8sPod, len(pods))
	for i, pod := range pods {
		protocolPods[i] = protocol.K8sPod{
			Name:      pod.Name,
			Namespace: pod.Namespace,
			Status:    pod.Status,
			Ready:     pod.Ready,
			Restarts:  pod.Restarts,
			Age:       pod.Age,
			Node:      pod.Node,
			IP:        pod.IP,
		}
	}

	// 发送响应
	result := protocol.K8sGetPodsResult{
		Type:      protocol.MessageTypeK8sGetPodsResult,
		RequestID: req.RequestID,
		Success:   true,
		Pods:      protocolPods,
	}
	return sendFunc(result)
}

// handleGetPodLogs 处理 Pod 日志查询
func (h *Handler) handleGetPodLogs(ctx context.Context, data json.RawMessage, sendFunc func(interface{}) error) error {
	var req protocol.K8sGetPodLogsRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return h.sendLogsError(req.RequestID, "解析日志请求失败", sendFunc)
	}

	log.Printf("[kubectl] 获取 Pod 日志: clusterID=%s, namespace=%s, pod=%s", req.ClusterID, req.Namespace, req.PodName)

	// 获取客户端
	client, ok := h.clients[req.ClusterID]
	if !ok {
		return h.sendLogsError(req.RequestID, "集群未连接", sendFunc)
	}

	// 获取日志
	logs, err := client.GetPodLogs(ctx, req.Namespace, req.PodName, req.Container, req.Follow, req.TailLines)
	if err != nil {
		return h.sendLogsError(req.RequestID, err.Error(), sendFunc)
	}

	// 发送响应
	result := protocol.K8sGetPodLogsResult{
		Type:      protocol.MessageTypeK8sGetPodLogsResult,
		RequestID: req.RequestID,
		Success:   true,
		Logs:      logs,
		Stream:    req.Follow,
	}
	return sendFunc(result)
}

// sendConnectError 发送连接错误
func (h *Handler) sendConnectError(requestID, errMsg string, sendFunc func(interface{}) error) error {
	result := protocol.K8sClusterConnectResult{
		Type:      protocol.MessageTypeK8sClusterConnectResult,
		RequestID: requestID,
		Success:   false,
		Error:     errMsg,
	}
	return sendFunc(result)
}

// sendPodsError 发送 Pod 查询错误
func (h *Handler) sendPodsError(requestID, errMsg string, sendFunc func(interface{}) error) error {
	result := protocol.K8sGetPodsResult{
		Type:      protocol.MessageTypeK8sGetPodsResult,
		RequestID: requestID,
		Success:   false,
		Error:     errMsg,
	}
	return sendFunc(result)
}

// sendLogsError 发送日志查询错误
func (h *Handler) sendLogsError(requestID, errMsg string, sendFunc func(interface{}) error) error {
	result := protocol.K8sGetPodLogsResult{
		Type:      protocol.MessageTypeK8sGetPodLogsResult,
		RequestID: requestID,
		Success:   false,
		Error:     errMsg,
	}
	return sendFunc(result)
}
