package k8s

import (
	"database/sql"
	"fmt"
	"time"
)

// Store K8s 集群存储层
type Store struct {
	db *sql.DB
}

// NewStore 创建存储层实例
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// CreateCluster 创建集群记录
func (s *Store) CreateCluster(cluster *Cluster) error {
	query := `INSERT INTO k8s_clusters (id, name, node_id, kubeconfig_path, kubeconfig_content, context, status, version, node_count, namespace_count, last_seen_at, created_at, updated_at)
	          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	_, err := s.db.Exec(query,
		cluster.ID,
		cluster.Name,
		cluster.NodeID,
		cluster.KubeconfigPath,
		cluster.KubeconfigContent,
		cluster.Context,
		cluster.Status,
		cluster.Version,
		cluster.NodeCount,
		cluster.NamespaceCount,
		timeToString(cluster.LastSeenAt),
		timeToString(cluster.CreatedAt),
		timeToString(cluster.UpdatedAt),
	)
	return err
}

// GetCluster 获取集群记录
func (s *Store) GetCluster(id string) (*Cluster, error) {
	query := `SELECT id, name, node_id, kubeconfig_path, kubeconfig_content, context, status, version, node_count, namespace_count, last_seen_at, created_at, updated_at
	          FROM k8s_clusters WHERE id = ?`
	row := s.db.QueryRow(query, id)

	var cluster Cluster
	var lastSeenAt, createdAt, updatedAt sql.NullString
	err := row.Scan(
		&cluster.ID,
		&cluster.Name,
		&cluster.NodeID,
		&cluster.KubeconfigPath,
		&cluster.KubeconfigContent,
		&cluster.Context,
		&cluster.Status,
		&cluster.Version,
		&cluster.NodeCount,
		&cluster.NamespaceCount,
		&lastSeenAt,
		&createdAt,
		&updatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("集群不存在")
		}
		return nil, err
	}

	cluster.LastSeenAt = stringToTime(lastSeenAt.String)
	cluster.CreatedAt = stringToTime(createdAt.String)
	cluster.UpdatedAt = stringToTime(updatedAt.String)

	return &cluster, nil
}

// ListClusters 获取集群列表
func (s *Store) ListClusters() ([]*Cluster, error) {
	query := `SELECT id, name, node_id, kubeconfig_path, kubeconfig_content, context, status, version, node_count, namespace_count, last_seen_at, created_at, updated_at
	          FROM k8s_clusters ORDER BY created_at DESC`
	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var clusters []*Cluster
	for rows.Next() {
		var cluster Cluster
		var lastSeenAt, createdAt, updatedAt sql.NullString
		err := rows.Scan(
			&cluster.ID,
			&cluster.Name,
			&cluster.NodeID,
			&cluster.KubeconfigPath,
			&cluster.KubeconfigContent,
			&cluster.Context,
			&cluster.Status,
			&cluster.Version,
			&cluster.NodeCount,
			&cluster.NamespaceCount,
			&lastSeenAt,
			&createdAt,
			&updatedAt,
		)
		if err != nil {
			return nil, err
		}

		cluster.LastSeenAt = stringToTime(lastSeenAt.String)
		cluster.CreatedAt = stringToTime(createdAt.String)
		cluster.UpdatedAt = stringToTime(updatedAt.String)

		clusters = append(clusters, &cluster)
	}

	return clusters, nil
}

// ListClustersWithNodeInfo 获取集群列表（包含节点信息）
func (s *Store) ListClustersWithNodeInfo() ([]*PublicClusterWithNode, error) {
	query := `SELECT c.id, c.name, c.node_id, c.kubeconfig_path, c.context, c.status, c.version, c.node_count, c.namespace_count, c.last_seen_at, c.created_at, c.updated_at,
	                 COALESCE(n.name, '') as node_name, COALESCE(n.ip, '') as node_ip, COALESCE(n.status, 'offline') as node_status
	          FROM k8s_clusters c
	          LEFT JOIN nodes n ON c.node_id = n.id
	          ORDER BY c.created_at DESC`
	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var clusters []*PublicClusterWithNode
	for rows.Next() {
		var cluster PublicClusterWithNode
		var lastSeenAt, createdAt, updatedAt sql.NullString
		err := rows.Scan(
			&cluster.ID,
			&cluster.Name,
			&cluster.NodeID,
			&cluster.KubeconfigPath,
			&cluster.Context,
			&cluster.Status,
			&cluster.Version,
			&cluster.NodeCount,
			&cluster.NamespaceCount,
			&lastSeenAt,
			&createdAt,
			&updatedAt,
			&cluster.NodeName,
			&cluster.NodeIP,
			&cluster.NodeStatus,
		)
		if err != nil {
			return nil, err
		}

		cluster.LastSeenAt = stringToTime(lastSeenAt.String)
		cluster.CreatedAt = stringToTime(createdAt.String)
		cluster.UpdatedAt = stringToTime(updatedAt.String)

		clusters = append(clusters, &cluster)
	}

	return clusters, nil
}

// UpdateClusterStatus 更新集群状态
func (s *Store) UpdateClusterStatus(id, status string) error {
	query := `UPDATE k8s_clusters SET status = ?, last_seen_at = ?, updated_at = ? WHERE id = ?`
	now := time.Now()
	_, err := s.db.Exec(query, status, timeToString(now), timeToString(now), id)
	return err
}

// DeleteCluster 删除集群记录
func (s *Store) DeleteCluster(id string) error {
	query := `DELETE FROM k8s_clusters WHERE id = ?`
	_, err := s.db.Exec(query, id)
	return err
}

// timeToString 时间转字符串
func timeToString(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}

// stringToTime 字符串转时间
func stringToTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, _ := time.Parse(time.RFC3339, s)
	return t
}
