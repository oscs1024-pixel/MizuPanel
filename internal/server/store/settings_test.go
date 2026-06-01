package store

import (
	"testing"
	"time"
)

func TestSettingsStorePersistsMetricsRetention(t *testing.T) {
	db := openTestDB(t)
	settings := NewSettingsStore(db)

	if got, err := settings.MetricsRetention(t.Context(), 6*time.Hour); err != nil || got != 6*time.Hour {
		t.Fatalf("default retention = %s, %v; want 6h, nil", got, err)
	}
	if err := settings.SetMetricsRetention(t.Context(), "3d"); err != nil {
		t.Fatalf("set retention: %v", err)
	}
	got, err := settings.MetricsRetention(t.Context(), 6*time.Hour)
	if err != nil {
		t.Fatalf("get retention: %v", err)
	}
	if got != 72*time.Hour {
		t.Fatalf("retention = %s, want 72h", got)
	}
	value, err := settings.MetricsRetentionValue(t.Context(), 6*time.Hour)
	if err != nil {
		t.Fatalf("get retention value: %v", err)
	}
	if value != "3d" {
		t.Fatalf("retention value = %q, want 3d", value)
	}
}

func TestSettingsStoreRejectsMetricsRetentionOverSevenDays(t *testing.T) {
	db := openTestDB(t)
	settings := NewSettingsStore(db)

	if err := settings.SetMetricsRetention(t.Context(), "8d"); err == nil {
		t.Fatal("set 8d returned nil, want error")
	}
}
