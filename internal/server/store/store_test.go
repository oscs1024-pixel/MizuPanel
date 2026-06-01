package store

import (
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"

	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	if err := serverdb.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func TestNodeUpsertCreatesAndUpdatesNode(t *testing.T) {
	db := openTestDB(t)
	repo := NewNodeStore(db)
	now := time.Date(2026, 5, 23, 10, 0, 0, 0, time.UTC)

	node := Node{
		ID:           "node-1",
		Name:         "first",
		Hostname:     "host-a",
		IP:           "10.0.0.1",
		OS:           "linux",
		Arch:         "amd64",
		Kernel:       "6.6",
		AgentVersion: "0.1.0",
		Status:       "online",
		LastSeenAt:   now,
	}
	if err := repo.Upsert(t.Context(), node); err != nil {
		t.Fatalf("first upsert: %v", err)
	}

	node.Name = "updated"
	node.LastSeenAt = now.Add(time.Minute)
	if err := repo.Upsert(t.Context(), node); err != nil {
		t.Fatalf("second upsert: %v", err)
	}

	got, err := repo.Get(t.Context(), "node-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Name != "updated" {
		t.Fatalf("Name = %q, want updated", got.Name)
	}
	if !got.LastSeenAt.Equal(now.Add(time.Minute)) {
		t.Fatalf("LastSeenAt = %s", got.LastSeenAt)
	}
}

func TestNodeDeleteRemovesNodeMetricsTokenAndSnapshots(t *testing.T) {
	db := openTestDB(t)
	nodes := NewNodeStore(db)
	metrics := NewMetricStore(db)
	tokens := NewAgentTokenStore(db)
	now := time.Date(2026, 5, 31, 10, 0, 0, 0, time.UTC)
	for _, node := range []Node{
		{ID: "node-delete", Name: "delete", Status: "offline", LastSeenAt: now},
		{ID: "node-keep", Name: "keep", Status: "online", LastSeenAt: now},
	} {
		if err := nodes.Upsert(t.Context(), node); err != nil {
			t.Fatalf("upsert %s: %v", node.ID, err)
		}
	}
	for _, metric := range []Metric{
		{NodeID: "node-delete", CPUUsage: 10, CreatedAt: now},
		{NodeID: "node-keep", CPUUsage: 20, CreatedAt: now},
	} {
		if err := metrics.Insert(t.Context(), metric); err != nil {
			t.Fatalf("insert metric: %v", err)
		}
	}
	if err := tokens.SaveNodeToken(t.Context(), "node-delete", "delete-token", now); err != nil {
		t.Fatalf("save delete token: %v", err)
	}
	if err := tokens.SaveNodeToken(t.Context(), "node-keep", "keep-token", now); err != nil {
		t.Fatalf("save keep token: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO node_process_snapshots (node_id, collected_at, processes_json, error, updated_at) VALUES (?, ?, ?, ?, ?)`, "node-delete", 1, "[]", "", formatTime(now)); err != nil {
		t.Fatalf("insert process snapshot: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO node_docker_snapshots (node_id, collected_at, available, version, containers_json, error, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, "node-delete", 1, 1, "24.0", "[]", "", formatTime(now)); err != nil {
		t.Fatalf("insert docker snapshot: %v", err)
	}

	if err := nodes.Delete(t.Context(), "node-delete"); err != nil {
		t.Fatalf("delete node: %v", err)
	}
	deleted, err := nodes.IsDeleted(t.Context(), "node-delete")
	if err != nil {
		t.Fatalf("check deleted node tombstone: %v", err)
	}
	if !deleted {
		t.Fatal("deleted node tombstone missing")
	}
	if err := nodes.Allow(t.Context(), "node-delete"); err != nil {
		t.Fatalf("allow deleted node: %v", err)
	}
	deleted, err = nodes.IsDeleted(t.Context(), "node-delete")
	if err != nil {
		t.Fatalf("recheck deleted node tombstone: %v", err)
	}
	if deleted {
		t.Fatal("deleted node tombstone still present after allow")
	}
	if _, err := nodes.Get(t.Context(), "node-delete"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("deleted node err = %v, want sql.ErrNoRows", err)
	}
	if _, err := nodes.Get(t.Context(), "node-keep"); err != nil {
		t.Fatalf("kept node missing: %v", err)
	}
	var count int
	for table, want := range map[string]int{
		"node_metrics":           0,
		"node_tokens":            0,
		"node_process_snapshots": 0,
		"node_docker_snapshots":  0,
	} {
		if err := db.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE node_id = ?`, "node-delete").Scan(&count); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if count != want {
			t.Fatalf("%s deleted row count = %d, want %d", table, count, want)
		}
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM node_metrics WHERE node_id = ?`, "node-keep").Scan(&count); err != nil {
		t.Fatalf("count kept metrics: %v", err)
	}
	if count != 1 {
		t.Fatalf("kept metrics count = %d, want 1", count)
	}
	if _, ok, err := tokens.NodeIDForToken(t.Context(), "keep-token"); err != nil || !ok {
		t.Fatalf("kept token lookup ok = %v, err = %v; want true, nil", ok, err)
	}
}

func TestNodeDeleteIfDeletedOnlyDeletesWhenTombstoneExists(t *testing.T) {
	db := openTestDB(t)
	nodes := NewNodeStore(db)
	now := time.Date(2026, 5, 31, 10, 0, 0, 0, time.UTC)
	if err := nodes.Upsert(t.Context(), Node{ID: "node-1", Name: "one", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	if err := nodes.DeleteIfDeleted(t.Context(), "node-1"); err != nil {
		t.Fatalf("delete if deleted without tombstone: %v", err)
	}
	if _, err := nodes.Get(t.Context(), "node-1"); err != nil {
		t.Fatalf("node deleted without tombstone: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO deleted_nodes (id, deleted_at) VALUES (?, ?)`, "node-1", formatTime(now)); err != nil {
		t.Fatalf("insert tombstone: %v", err)
	}
	if err := nodes.DeleteIfDeleted(t.Context(), "node-1"); err != nil {
		t.Fatalf("delete if deleted with tombstone: %v", err)
	}
	if _, err := nodes.Get(t.Context(), "node-1"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("deleted tombstoned node err = %v, want sql.ErrNoRows", err)
	}
}

func TestNodeUpdateSystemInfoMissingNodeReturnsNoRows(t *testing.T) {
	db := openTestDB(t)
	nodes := NewNodeStore(db)

	err := nodes.UpdateSystemInfo(t.Context(), "missing", "host", "linux", "amd64", "6.6", time.Now().UTC())
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("update missing err = %v, want sql.ErrNoRows", err)
	}
}

func TestNodeDeleteMissingNodeReturnsNoRows(t *testing.T) {
	db := openTestDB(t)
	nodes := NewNodeStore(db)

	if err := nodes.Delete(t.Context(), "missing"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("delete missing err = %v, want sql.ErrNoRows", err)
	}
}

func TestNodeResetOnlineStatusesMarksPersistedOnlineNodesOffline(t *testing.T) {
	db := openTestDB(t)
	repo := NewNodeStore(db)
	now := time.Date(2026, 5, 23, 10, 0, 0, 0, time.UTC)
	for _, node := range []Node{
		{ID: "node-online", Name: "online", Status: "online", LastSeenAt: now},
		{ID: "node-offline", Name: "offline", Status: "offline", LastSeenAt: now},
	} {
		if err := repo.Upsert(t.Context(), node); err != nil {
			t.Fatalf("upsert %s: %v", node.ID, err)
		}
	}

	resetAt := now.Add(time.Minute)
	if err := repo.ResetOnlineStatuses(t.Context(), resetAt); err != nil {
		t.Fatalf("reset online statuses: %v", err)
	}

	for _, id := range []string{"node-online", "node-offline"} {
		node, err := repo.Get(t.Context(), id)
		if err != nil {
			t.Fatalf("get %s: %v", id, err)
		}
		if node.Status != "offline" {
			t.Fatalf("%s status = %q, want offline", id, node.Status)
		}
	}
}

func TestAgentTokenStorePersistsNodeToken(t *testing.T) {
	db := openTestDB(t)
	tokens := NewAgentTokenStore(db)

	createdAt := time.Date(2026, 5, 25, 10, 0, 0, 0, time.UTC)
	if err := tokens.SaveNodeToken(t.Context(), "node-1", "node-token", createdAt); err != nil {
		t.Fatalf("save node token: %v", err)
	}

	var storedToken string
	if err := db.QueryRow(`SELECT token FROM node_tokens WHERE node_id = ?`, "node-1").Scan(&storedToken); err != nil {
		t.Fatalf("read stored token: %v", err)
	}
	if storedToken == "node-token" {
		t.Fatal("node token was stored in plaintext")
	}
	gotNodeID, ok, err := NewAgentTokenStore(db).NodeIDForToken(t.Context(), "node-token")
	if err != nil {
		t.Fatalf("lookup node token: %v", err)
	}
	if !ok || gotNodeID != "node-1" {
		t.Fatalf("NodeIDForToken = %q, %v; want node-1, true", gotNodeID, ok)
	}
}

func TestAgentTokenStoreRejectsStoredHashAsBearerToken(t *testing.T) {
	db := openTestDB(t)
	tokens := NewAgentTokenStore(db)
	createdAt := time.Date(2026, 5, 25, 10, 0, 0, 0, time.UTC)
	if err := tokens.SaveNodeToken(t.Context(), "node-1", "node-token", createdAt); err != nil {
		t.Fatalf("save node token: %v", err)
	}

	var storedToken string
	if err := db.QueryRow(`SELECT token FROM node_tokens WHERE node_id = ?`, "node-1").Scan(&storedToken); err != nil {
		t.Fatalf("read stored token: %v", err)
	}
	if _, ok, err := tokens.NodeIDForToken(t.Context(), storedToken); err != nil || ok {
		t.Fatalf("stored hash lookup ok = %v, err = %v; want false, nil", ok, err)
	}
}

func TestAgentTokenStoreMigratesLegacyPlaintextNodeToken(t *testing.T) {
	db := openTestDB(t)
	tokens := NewAgentTokenStore(db)
	createdAt := time.Date(2026, 5, 25, 10, 0, 0, 0, time.UTC)
	if _, err := db.Exec(`INSERT INTO node_tokens (node_id, token, created_at) VALUES (?, ?, ?)`, "node-1", "legacy-token", formatTime(createdAt)); err != nil {
		t.Fatalf("insert legacy token: %v", err)
	}

	gotNodeID, ok, err := tokens.NodeIDForToken(t.Context(), "legacy-token")
	if err != nil {
		t.Fatalf("lookup legacy token: %v", err)
	}
	if !ok || gotNodeID != "node-1" {
		t.Fatalf("NodeIDForToken = %q, %v; want node-1, true", gotNodeID, ok)
	}

	var storedToken string
	if err := db.QueryRow(`SELECT token FROM node_tokens WHERE node_id = ?`, "node-1").Scan(&storedToken); err != nil {
		t.Fatalf("read migrated token: %v", err)
	}
	if storedToken == "legacy-token" || !strings.HasPrefix(storedToken, "sha256:") {
		t.Fatalf("legacy token migrated to %q, want prefixed hash", storedToken)
	}
}

func TestAgentTokenStoreRotatesDuplicateNodeToken(t *testing.T) {
	db := openTestDB(t)
	tokens := NewAgentTokenStore(db)

	createdAt := time.Date(2026, 5, 25, 10, 0, 0, 0, time.UTC)
	if err := tokens.SaveNodeToken(t.Context(), "node-1", "first-token", createdAt); err != nil {
		t.Fatalf("save first token: %v", err)
	}
	if err := tokens.SaveNodeToken(t.Context(), "node-1", "second-token", createdAt.Add(time.Minute)); err != nil {
		t.Fatalf("save rotated token: %v", err)
	}

	got, ok, err := tokens.NodeIDForToken(t.Context(), "second-token")
	if err != nil {
		t.Fatalf("lookup rotated token: %v", err)
	}
	if !ok || got != "node-1" {
		t.Fatalf("NodeIDForToken = %q, %v; want node-1, true", got, ok)
	}
	if _, ok, err := tokens.NodeIDForToken(t.Context(), "first-token"); err != nil || ok {
		t.Fatalf("old token lookup ok = %v, err = %v; want false, nil", ok, err)
	}
}

func TestMetricInsertAndRangeQuery(t *testing.T) {
	db := openTestDB(t)
	nodes := NewNodeStore(db)
	metrics := NewMetricStore(db)
	base := time.Date(2026, 5, 23, 10, 0, 0, 0, time.UTC)
	for _, node := range []Node{{ID: "node-1", Name: "one", Status: "online", LastSeenAt: base}, {ID: "node-2", Name: "two", Status: "online", LastSeenAt: base}} {
		if err := nodes.Upsert(t.Context(), node); err != nil {
			t.Fatalf("upsert %s: %v", node.ID, err)
		}
	}

	oldMetric := Metric{NodeID: "node-1", CPUUsage: 10, CreatedAt: base.Add(-2 * time.Hour)}
	newMetric := Metric{NodeID: "node-1", CPUUsage: 20, CreatedAt: base.Add(-30 * time.Minute)}
	otherNode := Metric{NodeID: "node-2", CPUUsage: 99, CreatedAt: base.Add(-20 * time.Minute)}
	for _, metric := range []Metric{oldMetric, newMetric, otherNode} {
		if err := metrics.Insert(t.Context(), metric); err != nil {
			t.Fatalf("insert metric: %v", err)
		}
	}

	got, err := metrics.ListRange(t.Context(), "node-1", base.Add(-time.Hour), base)
	if err != nil {
		t.Fatalf("list range: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len(got) = %d, want 1", len(got))
	}
	if got[0].CPUUsage != 20 {
		t.Fatalf("CPUUsage = %v, want 20", got[0].CPUUsage)
	}
}

func TestMetricInsertMissingNodeReturnsNoRows(t *testing.T) {
	db := openTestDB(t)
	metrics := NewMetricStore(db)

	err := metrics.Insert(t.Context(), Metric{NodeID: "missing", CPUUsage: 10, CreatedAt: time.Now().UTC()})
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("insert missing node metric err = %v, want sql.ErrNoRows", err)
	}
}

func TestMetricCleanupDeletesOnlyExpiredRows(t *testing.T) {
	db := openTestDB(t)
	nodes := NewNodeStore(db)
	metrics := NewMetricStore(db)
	now := time.Date(2026, 5, 23, 10, 0, 0, 0, time.UTC)
	if err := nodes.Upsert(t.Context(), Node{ID: "node-1", Name: "one", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}

	rows := []Metric{
		{NodeID: "node-1", CPUUsage: 10, CreatedAt: now.Add(-7 * time.Hour)},
		{NodeID: "node-1", CPUUsage: 20, CreatedAt: now.Add(-5 * time.Hour)},
	}
	for _, row := range rows {
		if err := metrics.Insert(t.Context(), row); err != nil {
			t.Fatalf("insert metric: %v", err)
		}
	}

	deleted, err := metrics.DeleteOlderThan(t.Context(), now.Add(-6*time.Hour))
	if err != nil {
		t.Fatalf("delete older than: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("deleted = %d, want 1", deleted)
	}

	got, err := metrics.ListRange(t.Context(), "node-1", now.Add(-8*time.Hour), now)
	if err != nil {
		t.Fatalf("list range: %v", err)
	}
	if len(got) != 1 || got[0].CPUUsage != 20 {
		t.Fatalf("remaining metrics = %#v", got)
	}
}
