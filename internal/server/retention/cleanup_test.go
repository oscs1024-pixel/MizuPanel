package retention

import (
	"database/sql"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"

	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
	"github.com/mizupanel/mizupanel/internal/server/store"
)

func TestCleanerDeletesMetricsOlderThanRetention(t *testing.T) {
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	metrics := store.NewMetricStore(database)
	now := time.Date(2026, 5, 23, 12, 0, 0, 0, time.UTC)
	for _, metric := range []store.Metric{
		{NodeID: "node-1", CPUUsage: 10, CreatedAt: now.Add(-7 * time.Hour)},
		{NodeID: "node-1", CPUUsage: 20, CreatedAt: now.Add(-5 * time.Hour)},
	} {
		if err := metrics.Insert(t.Context(), metric); err != nil {
			t.Fatalf("insert metric: %v", err)
		}
	}

	cleaner := NewCleaner(metrics, 6*time.Hour)
	deleted, err := cleaner.RunOnce(t.Context(), now)
	if err != nil {
		t.Fatalf("RunOnce returned error: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("deleted = %d, want 1", deleted)
	}
}
