package retention

import (
	"database/sql"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"

	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
	"github.com/mizupanel/mizupanel/internal/server/store"
)

func TestCleanerUsesLatestMetricsRetention(t *testing.T) {
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
	settings := store.NewSettingsStore(database)
	now := time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC)
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "one", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	for _, metric := range []store.Metric{
		{NodeID: "node-1", CPUUsage: 10, CreatedAt: now.Add(-25 * time.Hour)},
		{NodeID: "node-1", CPUUsage: 20, CreatedAt: now.Add(-7 * time.Hour)},
	} {
		if err := metrics.Insert(t.Context(), metric); err != nil {
			t.Fatalf("insert metric: %v", err)
		}
	}
	cleaner := NewDynamicCleaner(metrics, func() (time.Duration, error) {
		return settings.MetricsRetention(t.Context(), 6*time.Hour)
	})
	if err := settings.SetMetricsRetention(t.Context(), "24h"); err != nil {
		t.Fatalf("set retention: %v", err)
	}
	deleted, err := cleaner.RunOnce(t.Context(), now)
	if err != nil {
		t.Fatalf("run 24h cleanup: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("24h deleted = %d, want 1", deleted)
	}

	if err := settings.SetMetricsRetention(t.Context(), "6h"); err != nil {
		t.Fatalf("set retention: %v", err)
	}
	deleted, err = cleaner.RunOnce(t.Context(), now)
	if err != nil {
		t.Fatalf("run 6h cleanup: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("6h deleted = %d, want 1", deleted)
	}
}
