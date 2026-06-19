package kubectl

import (
	"strings"
	"testing"
)

func TestFormatAgeReturnsHumanReadableDuration(t *testing.T) {
	got := formatAgeFromSeconds(3661)
	if got != "1h1m" {
		t.Fatalf("expected 1h1m, got %q", got)
	}
}

func TestJoinNonEmptySkipsEmptyValues(t *testing.T) {
	got := joinNonEmpty([]string{"10.0.0.1", "", "10.0.0.2"}, ",")
	if got != "10.0.0.1,10.0.0.2" {
		t.Fatalf("unexpected join result %q", got)
	}
}

func TestNewClientFromKubeconfigRejectsExecAuthPlugin(t *testing.T) {
	kubeconfig := `apiVersion: v1
kind: Config
clusters:
- name: test-cluster
  cluster:
    server: https://127.0.0.1:6443
    insecure-skip-tls-verify: true
contexts:
- name: test-context
  context:
    cluster: test-cluster
    user: test-user
current-context: test-context
users:
- name: test-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1
      command: malicious-command
`

	_, err := NewClientFromKubeconfig(kubeconfig, "")
	if err == nil {
		t.Fatal("expected exec auth plugin to be rejected")
	}
	message := err.Error()
	if !strings.Contains(message, "exec") && !strings.Contains(message, "认证插件") {
		t.Fatalf("expected error to mention exec or 认证插件, got %q", message)
	}
}
