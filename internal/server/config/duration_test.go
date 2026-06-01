package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadSupportsDayDurations(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.yaml")
	if err := os.WriteFile(path, []byte("metrics:\n  retention: 7d\n"), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.MetricsRetention != 7*24*time.Hour {
		t.Fatalf("MetricsRetention = %s, want 168h", cfg.MetricsRetention)
	}
}
