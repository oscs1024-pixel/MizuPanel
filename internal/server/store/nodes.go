package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type Node struct {
	ID           string
	Name         string
	Hostname     string
	IP           string
	OS           string
	Arch         string
	Kernel       string
	AgentVersion string
	Status       string
	LastSeenAt   time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type NodeStore struct {
	db *sql.DB
}

func NewNodeStore(db *sql.DB) *NodeStore {
	return &NodeStore{db: db}
}

func (s *NodeStore) Upsert(ctx context.Context, node Node) error {
	now := time.Now().UTC()
	if node.CreatedAt.IsZero() {
		node.CreatedAt = now
	}
	if node.UpdatedAt.IsZero() {
		node.UpdatedAt = now
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO nodes (id, name, hostname, ip, os, arch, kernel, agent_version, status, last_seen_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			hostname = excluded.hostname,
			ip = excluded.ip,
			os = excluded.os,
			arch = excluded.arch,
			kernel = excluded.kernel,
			agent_version = excluded.agent_version,
			status = excluded.status,
			last_seen_at = excluded.last_seen_at,
			updated_at = excluded.updated_at
	`, node.ID, node.Name, node.Hostname, node.IP, node.OS, node.Arch, node.Kernel, node.AgentVersion, node.Status, formatTime(node.LastSeenAt), formatTime(node.CreatedAt), formatTime(node.UpdatedAt))
	return err
}

func (s *NodeStore) Get(ctx context.Context, id string) (Node, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, name, hostname, ip, os, arch, kernel, agent_version, status, last_seen_at, created_at, updated_at
		FROM nodes WHERE id = ?
	`, id)
	return scanNode(row)
}

func (s *NodeStore) SetStatus(ctx context.Context, id string, status string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE nodes SET status = ?, updated_at = ? WHERE id = ?`, status, formatTime(now), id)
	return err
}

func (s *NodeStore) UpdateSystemInfo(ctx context.Context, id string, hostname string, osName string, arch string, kernel string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE nodes SET
			hostname = COALESCE(NULLIF(?, ''), hostname),
			os = COALESCE(NULLIF(?, ''), os),
			arch = COALESCE(NULLIF(?, ''), arch),
			kernel = COALESCE(NULLIF(?, ''), kernel),
			status = 'online',
			last_seen_at = ?,
			updated_at = ?
		WHERE id = ?
	`, hostname, osName, arch, kernel, formatTime(now), formatTime(now), id)
	return err
}

func (s *NodeStore) List(ctx context.Context) ([]Node, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, hostname, ip, os, arch, kernel, agent_version, status, last_seen_at, created_at, updated_at
		FROM nodes ORDER BY name ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var nodes []Node
	for rows.Next() {
		node, err := scanNode(rows)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

type nodeScanner interface {
	Scan(dest ...any) error
}

func scanNode(scanner nodeScanner) (Node, error) {
	var node Node
	var lastSeenAt, createdAt, updatedAt string
	if err := scanner.Scan(&node.ID, &node.Name, &node.Hostname, &node.IP, &node.OS, &node.Arch, &node.Kernel, &node.AgentVersion, &node.Status, &lastSeenAt, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Node{}, err
		}
		return Node{}, err
	}
	var err error
	if node.LastSeenAt, err = parseTime(lastSeenAt); err != nil {
		return Node{}, err
	}
	if node.CreatedAt, err = parseTime(createdAt); err != nil {
		return Node{}, err
	}
	if node.UpdatedAt, err = parseTime(updatedAt); err != nil {
		return Node{}, err
	}
	return node, nil
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func parseTime(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, nil
	}
	return time.Parse(time.RFC3339Nano, value)
}
