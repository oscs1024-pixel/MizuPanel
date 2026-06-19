package k8s

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/mizupanel/mizupanel/internal/protocol"
	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
)

type recordingHub struct {
	online  bool
	lastMsg interface{}
	resp    json.RawMessage
}

func (h *recordingHub) IsNodeOnline(nodeID string) bool { return h.online }
func (h *recordingHub) SendToNodeWithTimeout(nodeID string, message interface{}, timeout time.Duration) (json.RawMessage, error) {
	h.lastMsg = message
	return h.resp, nil
}

func newTestService(t *testing.T, kubeconfigContent, kubeContext string, hub *recordingHub) *Service {
	t.Helper()
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	now := time.Now().UTC()
	if _, err := database.Exec(`INSERT INTO nodes (id, name, hostname, ip, os, arch, kernel, agent_version, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"node-1", "test-node", "test-node", "127.0.0.1", "linux", "amd64", "", "", "online", now.Format(time.RFC3339), now.Format(time.RFC3339)); err != nil {
		t.Fatalf("create node: %v", err)
	}
	cluster := &Cluster{
		ID:                "cluster-1",
		Name:              "test-cluster",
		NodeID:            "node-1",
		KubeconfigContent: kubeconfigContent,
		Context:           kubeContext,
		Status:            "online",
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	store := NewStore(database)
	if err := store.CreateCluster(cluster); err != nil {
		t.Fatalf("create cluster: %v", err)
	}
	return NewService(store, hub)
}

func TestGetPodsRequiresStoredKubeconfigContent(t *testing.T) {
	hub := &recordingHub{online: true, resp: json.RawMessage(`{"success":true,"pods":[]}`)}
	service := newTestService(t, "   ", "ctx-a", hub)

	_, err := service.GetPods(context.Background(), "cluster-1", "default")
	if err == nil || !strings.Contains(err.Error(), "集群缺少 kubeconfig 内容，请重新连接集群") {
		t.Fatalf("expected reconnect guidance error, got %v", err)
	}
	if hub.lastMsg != nil {
		t.Fatalf("expected no agent request when kubeconfig content is missing, got %#v", hub.lastMsg)
	}
}

func TestGetPodLogsRequiresStoredKubeconfigContent(t *testing.T) {
	hub := &recordingHub{online: true, resp: json.RawMessage(`{"success":true,"logs":"ok"}`)}
	service := newTestService(t, "\n\t", "ctx-a", hub)

	_, err := service.GetPodLogs(context.Background(), "cluster-1", "default", "pod-a", "", false, 100)
	if err == nil || !strings.Contains(err.Error(), "集群缺少 kubeconfig 内容，请重新连接集群") {
		t.Fatalf("expected reconnect guidance error, got %v", err)
	}
	if hub.lastMsg != nil {
		t.Fatalf("expected no agent request when kubeconfig content is missing, got %#v", hub.lastMsg)
	}
}

func TestGetPodLogsSendsStoredKubeconfigContentAndContext(t *testing.T) {
	hub := &recordingHub{online: true, resp: json.RawMessage(`{"success":true,"logs":"ok"}`)}
	service := newTestService(t, "apiVersion: v1\nkind: Config\n", "ctx-a", hub)

	_, err := service.GetPodLogs(context.Background(), "cluster-1", "default", "pod-a", "", false, 100)
	if err != nil {
		t.Fatalf("get pod logs: %v", err)
	}
	req, ok := hub.lastMsg.(protocol.K8sGetPodLogsRequest)
	if !ok {
		t.Fatalf("expected K8sGetPodLogsRequest, got %#v", hub.lastMsg)
	}
	if req.KubeconfigContent != "apiVersion: v1\nkind: Config\n" {
		t.Fatalf("expected stored kubeconfig content to be sent")
	}
	if req.Context != "ctx-a" {
		t.Fatalf("expected context ctx-a, got %q", req.Context)
	}
}
