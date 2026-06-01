package store

import (
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

func TestProcessSnapshotStoreUpsertsAndReadsLatestSnapshot(t *testing.T) {
	db := openTestDB(t)
	nodes := NewNodeStore(db)
	processes := NewProcessSnapshotStore(db)
	now := time.Date(2026, 5, 26, 10, 0, 0, 0, time.UTC)
	if err := nodes.Upsert(t.Context(), Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}

	first := protocol.ProcessSnapshot{
		CollectedAt: 1710000000,
		Processes:   []protocol.ProcessInfo{{PID: 1, Name: "init", CPUUsage: 1}},
	}
	second := protocol.ProcessSnapshot{
		CollectedAt: 1710000100,
		Processes:   []protocol.ProcessInfo{{PID: 42, PPID: 1, Name: "nginx", Command: "nginx -g daemon off", User: "www-data", Status: "sleeping", CPUUsage: 12.5, MemoryRSS: 2048, MemoryUsage: 3.4, CreatedAt: 1709999999}},
		Error:       "partial permission denied",
	}
	if err := processes.Upsert(t.Context(), "node-1", first); err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	if err := processes.Upsert(t.Context(), "node-1", second); err != nil {
		t.Fatalf("second upsert: %v", err)
	}

	got, ok, err := processes.Get(t.Context(), "node-1")
	if err != nil {
		t.Fatalf("get snapshot: %v", err)
	}
	if !ok {
		t.Fatal("snapshot not found")
	}
	if got.CollectedAt != second.CollectedAt || got.Error != second.Error || len(got.Processes) != 1 {
		t.Fatalf("snapshot = %#v, want latest second snapshot", got)
	}
	if got.Processes[0].PID != 42 || got.Processes[0].Command != "nginx -g daemon off" {
		t.Fatalf("processes = %#v", got.Processes)
	}
}

func TestDockerSnapshotStoreUpsertsAndReadsLatestSnapshot(t *testing.T) {
	db := openTestDB(t)
	nodes := NewNodeStore(db)
	docker := NewDockerSnapshotStore(db)
	now := time.Date(2026, 5, 26, 10, 0, 0, 0, time.UTC)
	if err := nodes.Upsert(t.Context(), Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}

	first := protocol.DockerSnapshot{CollectedAt: 1710000000, Available: false, Error: "socket missing"}
	second := protocol.DockerSnapshot{
		CollectedAt: 1710000200,
		Available:   true,
		Version:     "24.0.0",
		Containers:  []protocol.ContainerInfo{{ID: "abcdef123456", Name: "web", Image: "nginx:latest", State: "running", Status: "Up 1 minute", CreatedAt: 1710000000, StartedAt: 1710000100, RestartCount: 2, CPUUsage: 4.5, MemoryUsage: 1048576, MemoryLimit: 67108864, MemoryPercent: 1.5, NetworkRX: 100, NetworkTX: 200}},
	}
	if err := docker.Upsert(t.Context(), "node-1", first); err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	if err := docker.Upsert(t.Context(), "node-1", second); err != nil {
		t.Fatalf("second upsert: %v", err)
	}

	got, ok, err := docker.Get(t.Context(), "node-1")
	if err != nil {
		t.Fatalf("get snapshot: %v", err)
	}
	if !ok {
		t.Fatal("snapshot not found")
	}
	if !got.Available || got.Version != "24.0.0" || len(got.Containers) != 1 {
		t.Fatalf("snapshot = %#v", got)
	}
	if got.Containers[0].Name != "web" || got.Containers[0].NetworkTX != 200 {
		t.Fatalf("containers = %#v", got.Containers)
	}
}

func TestSnapshotStoresCascadeWhenNodeDeleted(t *testing.T) {
	db := openTestDB(t)
	nodes := NewNodeStore(db)
	processes := NewProcessSnapshotStore(db)
	docker := NewDockerSnapshotStore(db)
	if err := nodes.Upsert(t.Context(), Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: time.Now().UTC()}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	if err := processes.Upsert(t.Context(), "node-1", protocol.ProcessSnapshot{CollectedAt: 1, Processes: []protocol.ProcessInfo{{PID: 1}}}); err != nil {
		t.Fatalf("upsert process snapshot: %v", err)
	}
	if err := docker.Upsert(t.Context(), "node-1", protocol.DockerSnapshot{CollectedAt: 1, Containers: []protocol.ContainerInfo{{ID: "abc"}}}); err != nil {
		t.Fatalf("upsert docker snapshot: %v", err)
	}

	if _, err := db.Exec(`DELETE FROM nodes WHERE id = ?`, "node-1"); err != nil {
		t.Fatalf("delete node: %v", err)
	}
	if _, ok, err := processes.Get(t.Context(), "node-1"); err != nil || ok {
		t.Fatalf("process snapshot after node delete ok=%v err=%v", ok, err)
	}
	if _, ok, err := docker.Get(t.Context(), "node-1"); err != nil || ok {
		t.Fatalf("docker snapshot after node delete ok=%v err=%v", ok, err)
	}
}

func TestSnapshotStoresReturnNotFoundForMissingRows(t *testing.T) {
	db := openTestDB(t)
	if _, ok, err := NewProcessSnapshotStore(db).Get(t.Context(), "missing"); err != nil || ok {
		t.Fatalf("process Get ok=%v err=%v, want false nil", ok, err)
	}
	if _, ok, err := NewDockerSnapshotStore(db).Get(t.Context(), "missing"); err != nil || ok {
		t.Fatalf("docker Get ok=%v err=%v, want false nil", ok, err)
	}
}

func TestSnapshotStoresSurfaceForeignKeyFailures(t *testing.T) {
	db := openTestDB(t)
	err := NewProcessSnapshotStore(db).Upsert(t.Context(), "missing", protocol.ProcessSnapshot{CollectedAt: 1})
	if err == nil || errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("process upsert err=%v, want foreign key failure", err)
	}
}
