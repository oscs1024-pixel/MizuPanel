package store

import (
	"database/sql"
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
	metrics := NewMetricStore(db)
	base := time.Date(2026, 5, 23, 10, 0, 0, 0, time.UTC)

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

func TestMetricCleanupDeletesOnlyExpiredRows(t *testing.T) {
	db := openTestDB(t)
	metrics := NewMetricStore(db)
	now := time.Date(2026, 5, 23, 10, 0, 0, 0, time.UTC)

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
