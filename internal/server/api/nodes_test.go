package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"

	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
	"github.com/mizupanel/mizupanel/internal/server/store"
)

func testRouter(t *testing.T) (*http.ServeMux, *store.NodeStore, *store.MetricStore) {
	t.Helper()
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	nodes := store.NewNodeStore(database)
	metrics := store.NewMetricStore(database)
	mux := NewRouter(nodes, metrics)
	return mux, nodes, metrics
}

func TestListNodesReturnsEmptyList(t *testing.T) {
	mux, _, _ := testRouter(t)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/nodes", nil)

	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	var response struct {
		Nodes []NodeResponse `json:"nodes"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Nodes) != 0 {
		t.Fatalf("len(nodes) = %d, want 0", len(response.Nodes))
	}
}

func TestListNodesIncludesLatestMetric(t *testing.T) {
	mux, nodes, metrics := testRouter(t)
	now := time.Date(2026, 5, 23, 12, 0, 0, 0, time.UTC)
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	for _, metric := range []store.Metric{
		{NodeID: "node-1", CPUUsage: 10, MemoryUsage: 20, DiskUsage: 30, CreatedAt: now.Add(-time.Minute)},
		{NodeID: "node-1", CPUUsage: 40, MemoryUsage: 50, DiskUsage: 60, CreatedAt: now},
	} {
		if err := metrics.Insert(t.Context(), metric); err != nil {
			t.Fatalf("insert metric: %v", err)
		}
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/nodes", nil)
	mux.ServeHTTP(recorder, request)

	var response struct {
		Nodes []NodeResponse `json:"nodes"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Nodes) != 1 {
		t.Fatalf("len(nodes) = %d, want 1", len(response.Nodes))
	}
	if response.Nodes[0].LatestMetric == nil || response.Nodes[0].LatestMetric.CPUUsage != 40 {
		t.Fatalf("latest metric = %#v", response.Nodes[0].LatestMetric)
	}
}

func TestMetricsRangeRejectsInvalidRange(t *testing.T) {
	mux, _, _ := testRouter(t)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/metrics?range=24h", nil)

	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
}

func TestMetricsRangeReturnsRows(t *testing.T) {
	mux, nodes, metrics := testRouter(t)
	now := time.Now().UTC()
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	if err := metrics.Insert(t.Context(), store.Metric{NodeID: "node-1", CPUUsage: 33, CreatedAt: now.Add(-30 * time.Minute)}); err != nil {
		t.Fatalf("insert metric: %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/metrics?range=1h", nil)
	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	var response struct {
		Metrics []MetricResponse `json:"metrics"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Metrics) != 1 || response.Metrics[0].CPUUsage != 33 {
		t.Fatalf("metrics = %#v", response.Metrics)
	}
}
