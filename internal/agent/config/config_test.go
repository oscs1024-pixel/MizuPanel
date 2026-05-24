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

	if cfg.ServerURL != "ws://localhost:8080/api/agent/ws" {
		t.Fatalf("ServerURL = %q", cfg.ServerURL)
	}
	if cfg.Interval != 5*time.Second {
		t.Fatalf("Interval = %s, want 5s", cfg.Interval)
	}
	if cfg.Token != "change-me" {
		t.Fatalf("Token = %q, want change-me", cfg.Token)
	}
	if cfg.NodeID == "" {
		t.Fatal("NodeID is empty")
	}
	if cfg.Name == "" {
		t.Fatal("Name is empty")
	}
}

func TestLoadOverridesFromFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.yaml")
	content := []byte("server_url: ws://example.test/api/agent/ws\ntoken: secret\nnode_id: oracle-node-1\nname: Oracle\ninterval: 3s\n")
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.ServerURL != "ws://example.test/api/agent/ws" || cfg.Token != "secret" || cfg.NodeID != "oracle-node-1" || cfg.Name != "Oracle" {
		t.Fatalf("unexpected config: %#v", cfg)
	}
	if cfg.Interval != 3*time.Second {
		t.Fatalf("Interval = %s, want 3s", cfg.Interval)
	}
}

func TestSaveTokenUpdatesExistingConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.yaml")
	content := []byte("server_url: ws://example.test/api/agent/ws\ntoken: install-token\nnode_id: oracle-node-1\nname: Oracle\ninterval: 3s\n")
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	if err := SaveToken(path, "node-token"); err != nil {
		t.Fatalf("SaveToken returned error: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.Token != "node-token" || cfg.ServerURL != "ws://example.test/api/agent/ws" || cfg.NodeID != "oracle-node-1" || cfg.Interval != 3*time.Second {
		t.Fatalf("unexpected config after token save: %#v", cfg)
	}
}

func TestLoadRejectsInvalidInterval(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.yaml")
	if err := os.WriteFile(path, []byte("interval: nope\n"), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	if _, err := Load(path); err == nil {
		t.Fatal("Load returned nil error, want invalid interval error")
	}
}
