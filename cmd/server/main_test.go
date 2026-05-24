package main

import (
	"testing"

	"github.com/mizupanel/mizupanel/internal/server/config"
)

func TestRequireServerSecretsRejectsEmptySecrets(t *testing.T) {
	if err := requireServerSecrets(config.Config{}); err == nil {
		t.Fatal("requireServerSecrets returned nil, want error")
	}
}

func TestRequireServerSecretsAcceptsConfiguredSecrets(t *testing.T) {
	if err := requireServerSecrets(config.Config{AdminPassword: "admin-secret"}); err != nil {
		t.Fatalf("requireServerSecrets returned error: %v", err)
	}
}
