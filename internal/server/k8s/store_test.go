package k8s

import (
	"database/sql"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
)

func TestStorePersistsKubeconfigContentButPublicClusterOmitsIt(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()

	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	store := NewStore(database)
	now := time.Now().UTC()
	if _, err := database.Exec(`INSERT INTO nodes (id, name, hostname, ip, os, arch, kernel, agent_version, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"node-1", "test-node", "test-node", "127.0.0.1", "linux", "amd64", "", "", "online", now.Format(time.RFC3339), now.Format(time.RFC3339)); err != nil {
		t.Fatalf("create node: %v", err)
	}
	cluster := &Cluster{
		ID:                "cluster-1",
		Name:              "test-cluster",
		NodeID:            "node-1",
		KubeconfigPath:    "",
		KubeconfigContent: "apiVersion: v1\nkind: Config\n",
		Context:           "ctx-a",
		Status:            "online",
		Version:           "v1.30.0",
		NodeCount:         2,
		NamespaceCount:    4,
		LastSeenAt:        now,
		CreatedAt:         now,
		UpdatedAt:         now,
	}

	if err := store.CreateCluster(cluster); err != nil {
		t.Fatalf("create cluster: %v", err)
	}

	loaded, err := store.GetCluster("cluster-1")
	if err != nil {
		t.Fatalf("get cluster: %v", err)
	}
	if loaded.KubeconfigContent != cluster.KubeconfigContent {
		t.Fatalf("expected kubeconfig content to persist, got %q", loaded.KubeconfigContent)
	}

	public := loaded.Public()
	if public.KubeconfigContent != "" {
		t.Fatalf("public cluster leaked kubeconfig content")
	}
	if public.Name != "test-cluster" || public.Context != "ctx-a" {
		t.Fatalf("public cluster lost metadata: %#v", public)
	}
}
