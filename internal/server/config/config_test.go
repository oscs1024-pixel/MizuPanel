package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load("")
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if cfg.Listen != ":8080" {
		t.Fatalf("Listen = %q, want :8080", cfg.Listen)
	}
	if cfg.DatabasePath != "./data/mizupanel.db" {
		t.Fatalf("DatabasePath = %q", cfg.DatabasePath)
	}
	if cfg.MetricsRetention != 6*time.Hour {
		t.Fatalf("MetricsRetention = %s, want 6h", cfg.MetricsRetention)
	}
	if cfg.CleanupInterval != 10*time.Minute {
		t.Fatalf("CleanupInterval = %s, want 10m", cfg.CleanupInterval)
	}
	if cfg.AgentToken != "" {
		t.Fatalf("AgentToken = %q, want empty default", cfg.AgentToken)
	}
}

func TestLoadOverridesFromFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.yaml")
	content := []byte("listen: ':9090'\ndatabase_path: /tmp/mizu.db\nmetrics_retention: 24h\ncleanup_interval: 30m\nagent_token: secret\nadmin_password: admin-secret\n")
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if cfg.Listen != ":9090" {
		t.Fatalf("Listen = %q", cfg.Listen)
	}
	if cfg.DatabasePath != "/tmp/mizu.db" {
		t.Fatalf("DatabasePath = %q", cfg.DatabasePath)
	}
	if cfg.MetricsRetention != 24*time.Hour {
		t.Fatalf("MetricsRetention = %s", cfg.MetricsRetention)
	}
	if cfg.CleanupInterval != 30*time.Minute {
		t.Fatalf("CleanupInterval = %s", cfg.CleanupInterval)
	}
	if cfg.AgentToken != "secret" {
		t.Fatalf("AgentToken = %q", cfg.AgentToken)
	}
	if cfg.AdminPassword != "admin-secret" {
		t.Fatalf("AdminPassword = %q", cfg.AdminPassword)
	}
}

func TestLoadRejectsInvalidDuration(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.yaml")
	content := []byte("metrics_retention: nope\n")
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	if _, err := Load(path); err == nil {
		t.Fatal("Load returned nil error, want invalid duration error")
	}
}
