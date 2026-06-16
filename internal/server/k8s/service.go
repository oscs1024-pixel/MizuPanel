package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/mizupanel/mizupanel/internal/protocol"
)

// Service K8s 业务逻辑层
type Service struct {
	store *Store
	hub   AgentHub
}

// AgentHub Agent 通信接口
type AgentHub interface {
	IsNodeOnline(nodeID string) bool
	SendToNodeWithTimeout(nodeID string, message interface{}, timeout time.Duration) (json.RawMessage, error)
}

// NewService 创建业务逻辑层
func NewService(store *Store, hub AgentHub) *Service {
	return &Service{
		store: store,
		hub:   hub,
	}
}

// ConnectClusterRequest 连接集群请求
type ConnectClusterRequest struct {
	Name           string `json:"name"`
	NodeID         string `json:"node_id"`
	KubeconfigPath string `json:"kubeconfig_path"`
	Context        string `json:"context,omitempty"`
}

// ConnectCluster 连接 K8s 集群
func (s *Service) ConnectCluster(ctx context.Context, req *ConnectClusterRequest) (*Cluster, *ClusterInfo, error) {
	// 1. 验证节点在线
	if !s.hub.IsNodeOnline(req.NodeID) {
		return nil, nil, fmt.Errorf("Agent 节点离线，无法连接集群")
	}

	// 2. 通过 Agent 验证 kubeconfig
	requestID := uuid.New().String()
	agentReq := protocol.K8sClusterConnectRequest{
		Type:           protocol.MessageTypeK8sClusterConnect,
		RequestID:      requestID,
		KubeconfigPath: req.KubeconfigPath,
		Context:        req.Context,
	}

	rawResp, err := s.hub.SendToNodeWithTimeout(req.NodeID, agentReq, 10*time.Second)
	if err != nil {
		return nil, nil, fmt.Errorf("Agent 响应超时: %w", err)
	}

	var agentResp protocol.K8sClusterConnectResult
	if err := json.Unmarshal(rawResp, &agentResp); err != nil {
		return nil, nil, fmt.Errorf("解析 Agent 响应失败: %w", err)
	}

	if !agentResp.Success {
		return nil, nil, fmt.Errorf("连接失败: %s", agentResp.Error)
	}

	// 3. 保存集群信息到数据库
	now := time.Now()
	cluster := &Cluster{
		ID:             uuid.New().String(),
		Name:           req.Name,
		NodeID:         req.NodeID,
		KubeconfigPath: req.KubeconfigPath,
		Context:        req.Context,
		Status:         "online",
		Version:        agentResp.ClusterInfo.Version,
		NodeCount:      agentResp.ClusterInfo.NodeCount,
		NamespaceCount: agentResp.ClusterInfo.NamespaceCount,
		LastSeenAt:     now,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	if err := s.store.CreateCluster(cluster); err != nil {
		return nil, nil, fmt.Errorf("保存集群信息失败: %w", err)
	}

	// 4. 返回集群信息
	clusterInfo := &ClusterInfo{
		Version:        agentResp.ClusterInfo.Version,
		NodeCount:      agentResp.ClusterInfo.NodeCount,
		NamespaceCount: agentResp.ClusterInfo.NamespaceCount,
	}

	return cluster, clusterInfo, nil
}

// GetCluster 获取集群信息
func (s *Service) GetCluster(id string) (*Cluster, error) {
	return s.store.GetCluster(id)
}

// ListClusters 获取集群列表
func (s *Service) ListClusters() ([]*Cluster, error) {
	return s.store.ListClusters()
}

// ListClustersWithNodeInfo 获取集群列表（包含节点信息）
func (s *Service) ListClustersWithNodeInfo() ([]*ClusterWithNode, error) {
	return s.store.ListClustersWithNodeInfo()
}

// DeleteCluster 删除集群
func (s *Service) DeleteCluster(id string) error {
	return s.store.DeleteCluster(id)
}

// GetPods 获取 Pod 列表
func (s *Service) GetPods(ctx context.Context, clusterID, namespace string) ([]protocol.K8sPod, error) {
	// 1. 获取集群信息
	cluster, err := s.store.GetCluster(clusterID)
	if err != nil {
		return nil, err
	}

	// 2. 验证节点在线
	if !s.hub.IsNodeOnline(cluster.NodeID) {
		return nil, fmt.Errorf("Agent 节点离线")
	}

	// 3. 发送查询请求到 Agent
	requestID := uuid.New().String()
	agentReq := protocol.K8sGetPodsRequest{
		Type:      protocol.MessageTypeK8sGetPods,
		RequestID: requestID,
		ClusterID: clusterID,
		Namespace: namespace,
	}

	rawResp, err := s.hub.SendToNodeWithTimeout(cluster.NodeID, agentReq, 15*time.Second)
	if err != nil {
		return nil, fmt.Errorf("Agent 响应超时: %w", err)
	}

	var agentResp protocol.K8sGetPodsResult
	if err := json.Unmarshal(rawResp, &agentResp); err != nil {
		return nil, fmt.Errorf("解析 Agent 响应失败: %w", err)
	}

	if !agentResp.Success {
		return nil, fmt.Errorf("查询失败: %s", agentResp.Error)
	}

	return agentResp.Pods, nil
}

// GetPodLogs 获取 Pod 日志
func (s *Service) GetPodLogs(ctx context.Context, clusterID, namespace, podName, container string, follow bool, tailLines int) (string, error) {
	// 1. 获取集群信息
	cluster, err := s.store.GetCluster(clusterID)
	if err != nil {
		return "", err
	}

	// 2. 验证节点在线
	if !s.hub.IsNodeOnline(cluster.NodeID) {
		return "", fmt.Errorf("Agent 节点离线")
	}

	// 3. 发送日志请求到 Agent
	requestID := uuid.New().String()
	agentReq := protocol.K8sGetPodLogsRequest{
		Type:      protocol.MessageTypeK8sGetPodLogs,
		RequestID: requestID,
		ClusterID: clusterID,
		Namespace: namespace,
		PodName:   podName,
		Container: container,
		Follow:    follow,
		TailLines: tailLines,
	}

	rawResp, err := s.hub.SendToNodeWithTimeout(cluster.NodeID, agentReq, 10*time.Second)
	if err != nil {
		return "", fmt.Errorf("Agent 响应超时: %w", err)
	}

	var agentResp protocol.K8sGetPodLogsResult
	if err := json.Unmarshal(rawResp, &agentResp); err != nil {
		return "", fmt.Errorf("解析 Agent 响应失败: %w", err)
	}

	if !agentResp.Success {
		return "", fmt.Errorf("获取日志失败: %s", agentResp.Error)
	}

	return agentResp.Logs, nil
}
