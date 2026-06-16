package k8s

import "time"

// Cluster K8s 集群
type Cluster struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	NodeID         string    `json:"node_id"`
	KubeconfigPath string    `json:"kubeconfig_path"`
	Context        string    `json:"context,omitempty"`
	Status         string    `json:"status"` // online, offline
	Version        string    `json:"version,omitempty"`
	NodeCount      int       `json:"node_count,omitempty"`
	NamespaceCount int       `json:"namespace_count,omitempty"`
	LastSeenAt     time.Time `json:"last_seen_at,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// ClusterWithNode 集群连同节点信息
type ClusterWithNode struct {
	Cluster
	NodeName string `json:"node_name"`
	NodeIP   string `json:"node_ip"`
}

// ClusterInfo 集群详细信息
type ClusterInfo struct {
	Version        string `json:"version"`
	NodeCount      int    `json:"node_count"`
	NamespaceCount int    `json:"namespace_count"`
}
