package k8s

import "time"

// Cluster K8s 集群
type Cluster struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	NodeID            string    `json:"node_id"`
	KubeconfigPath    string    `json:"kubeconfig_path,omitempty"`
	KubeconfigContent string    `json:"-"`
	Context           string    `json:"context,omitempty"`
	Status            string    `json:"status"` // online, offline
	Version           string    `json:"version,omitempty"`
	NodeCount         int       `json:"node_count,omitempty"`
	NamespaceCount    int       `json:"namespace_count,omitempty"`
	LastSeenAt        time.Time `json:"last_seen_at,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// PublicCluster is the API-safe K8s cluster representation.
type PublicCluster struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	NodeID            string    `json:"node_id"`
	KubeconfigPath    string    `json:"kubeconfig_path,omitempty"`
	KubeconfigContent string    `json:"-"`
	Context           string    `json:"context,omitempty"`
	Status            string    `json:"status"`
	Version           string    `json:"version,omitempty"`
	NodeCount         int       `json:"node_count,omitempty"`
	NamespaceCount    int       `json:"namespace_count,omitempty"`
	LastSeenAt        time.Time `json:"last_seen_at,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

func (c *Cluster) Public() PublicCluster {
	return PublicCluster{
		ID:             c.ID,
		Name:           c.Name,
		NodeID:         c.NodeID,
		KubeconfigPath: c.KubeconfigPath,
		Context:        c.Context,
		Status:         c.Status,
		Version:        c.Version,
		NodeCount:      c.NodeCount,
		NamespaceCount: c.NamespaceCount,
		LastSeenAt:     c.LastSeenAt,
		CreatedAt:      c.CreatedAt,
		UpdatedAt:      c.UpdatedAt,
	}
}

// PublicClusterWithNode 集群连同节点信息，不包含 kubeconfig 内容
type PublicClusterWithNode struct {
	PublicCluster
	NodeName string `json:"node_name"`
	NodeIP   string `json:"node_ip"`
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
