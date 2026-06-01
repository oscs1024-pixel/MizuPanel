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
	if cfg.Storage.Driver != "sqlite" {
		t.Fatalf("Storage.Driver = %q, want sqlite", cfg.Storage.Driver)
	}
	if cfg.Storage.SQLite.Path != "./data/mizupanel.db" {
		t.Fatalf("Storage.SQLite.Path = %q", cfg.Storage.SQLite.Path)
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
	if cfg.EnableTerminal {
		t.Fatal("EnableTerminal = true, want false default")
	}
}

func TestLoadOverridesFromFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.yaml")
	content := []byte(`server:
  listen: ':9090'
  public_url: https://panel.example/
  enable_terminal: true
storage:
  database_path: /tmp/mizu.db
metrics:
  retention: 24h
  cleanup_interval: 30m
security:
  agent_token: secret
`)
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
	if cfg.PublicURL != "https://panel.example" {
		t.Fatalf("PublicURL = %q", cfg.PublicURL)
	}
	if !cfg.EnableTerminal {
		t.Fatal("EnableTerminal = false, want true")
	}
}

func TestLoadSupportsStorageDriverConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.yaml")
	content := []byte(`storage:
  driver: mysql
  mysql:
    host: db.internal
    port: 3307
    username: mizupanel
    password: secret
    database: mizupanel_prod
`)
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.Storage.Driver != "mysql" {
		t.Fatalf("Storage.Driver = %q", cfg.Storage.Driver)
	}
	if cfg.Storage.MySQL.Host != "db.internal" || cfg.Storage.MySQL.Port != 3307 || cfg.Storage.MySQL.Username != "mizupanel" || cfg.Storage.MySQL.Password != "secret" || cfg.Storage.MySQL.Database != "mizupanel_prod" {
		t.Fatalf("Storage.MySQL = %+v", cfg.Storage.MySQL)
	}
}

func TestLoadExpandsEnvironmentVariables(t *testing.T) {
	t.Setenv("MIZUPANEL_MYSQL_PASSWORD", `secret"\value`)
	dir := t.TempDir()
	path := filepath.Join(dir, "server.yaml")
	content := []byte(`storage:
  driver: mysql
  mysql:
    host: mysql
    username: mizupanel
    password: ${MIZUPANEL_MYSQL_PASSWORD}
    database: mizupanel
`)
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.Storage.MySQL.Password != `secret"\value` {
		t.Fatalf("mysql password = %q", cfg.Storage.MySQL.Password)
	}
}

func TestLoadRejectsInvalidStorageDriver(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.yaml")
	content := []byte("storage:\n  driver: postgres\n")
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	if _, err := Load(path); err == nil {
		t.Fatal("Load returned nil error, want invalid storage driver error")
	}
}

func TestLoadRejectsIncompleteMySQLStorageConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.yaml")
	content := []byte("storage:\n  driver: mysql\n  mysql:\n    host: db.internal\n")
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	if _, err := Load(path); err == nil {
		t.Fatal("Load returned nil error, want incomplete mysql config error")
	}
}

func TestLoadRejectsMetricsRetentionOutsideRuntimeBounds(t *testing.T) {
	for _, retention := range []string{"30m", "8d"} {
		dir := t.TempDir()
		path := filepath.Join(dir, "server.yaml")
		content := []byte("metrics:\n  retention: " + retention + "\n")
		if err := os.WriteFile(path, content, 0600); err != nil {
			t.Fatalf("write config: %v", err)
		}
		if _, err := Load(path); err == nil {
			t.Fatalf("Load(%s) returned nil error, want bounds error", retention)
		}
	}
}

func TestLoadRejectsInvalidDuration(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.yaml")
	content := []byte("metrics:\n  retention: nope\n")
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	if _, err := Load(path); err == nil {
		t.Fatal("Load returned nil error, want invalid duration error")
	}
}

func TestLoadSupportsLegacyFlatConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.yaml")
	content := []byte("listen: ':9090'\ndatabase_path: /tmp/mizu.db\nmetrics_retention: 24h\ncleanup_interval: 30m\nagent_token: secret\npublic_url: https://panel.example/\nenable_terminal: true\n")
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.Listen != ":9090" || cfg.DatabasePath != "/tmp/mizu.db" || cfg.MetricsRetention != 24*time.Hour || cfg.CleanupInterval != 30*time.Minute || cfg.AgentToken != "secret" || cfg.PublicURL != "https://panel.example" || !cfg.EnableTerminal {
		t.Fatalf("loaded legacy config = %+v", cfg)
	}
}
