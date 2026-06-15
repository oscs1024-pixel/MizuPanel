package kubectl

// ClusterInfo 集群信息
type ClusterInfo struct {
	Version        string `json:"version"`
	NodeCount      int    `json:"node_count"`
	NamespaceCount int    `json:"namespace_count"`
}

// Pod Pod 信息
type Pod struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Status    string `json:"status"`
	Ready     string `json:"ready"`
	Restarts  int    `json:"restarts"`
	Age       string `json:"age"`
	Node      string `json:"node"`
	IP        string `json:"ip,omitempty"`
}
