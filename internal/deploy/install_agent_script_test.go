package deploy

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestInstallAgentScriptGeneratesConfigAndInstallsService(t *testing.T) {
	repoRoot := filepath.Clean(filepath.Join("..", ".."))
	script := filepath.Join(repoRoot, "scripts", "install-agent.sh")
	binary := filepath.Join(t.TempDir(), "mizupanel-agent")
	if err := os.WriteFile(binary, []byte("#!/bin/sh\n"), 0755); err != nil {
		t.Fatalf("write binary: %v", err)
	}
	dest := t.TempDir()
	fakeBin := t.TempDir()
	if err := os.WriteFile(filepath.Join(fakeBin, "systemctl"), []byte("#!/bin/sh\necho systemctl should not run in dest-root mode >&2\nexit 1\n"), 0755); err != nil {
		t.Fatalf("write fake systemctl: %v", err)
	}

	output, err := runCommand(t, script, map[string]string{"PATH": fakeBin + string(os.PathListSeparator) + os.Getenv("PATH")},
		"--dest-root", dest,
		"--binary", binary,
		"--server-url", "ws://panel.example.com:8080/api/agent/ws",
		"--token", "secret-token",
		"--node-id", "oracle-sg-01",
		"--name", "Oracle SG",
		"--interval", "5s",
	)
	if err != nil {
		t.Fatalf("install script failed: %v\n%s", err, output)
	}

	config, err := os.ReadFile(filepath.Join(dest, "etc", "mizupanel", "agent.yaml"))
	if err != nil {
		t.Fatalf("read generated config: %v", err)
	}
	wantConfig := []string{
		`server_url: "ws://panel.example.com:8080/api/agent/ws"`,
		`token: "secret-token"`,
		`node_id: "oracle-sg-01"`,
		`name: "Oracle SG"`,
		`interval: "5s"`,
	}
	for _, want := range wantConfig {
		if !strings.Contains(string(config), want) {
			t.Fatalf("generated config missing %q:\n%s", want, config)
		}
	}
	info, err := os.Stat(filepath.Join(dest, "etc", "mizupanel", "agent.yaml"))
	if err != nil {
		t.Fatalf("stat generated config: %v", err)
	}
	if info.Mode().Perm()&0007 != 0 {
		t.Fatalf("agent config is readable by other users: %s", info.Mode().Perm())
	}
	if _, err := os.Stat(filepath.Join(dest, "opt", "mizupanel", "bin", "mizupanel-agent")); err != nil {
		t.Fatalf("agent binary was not installed: %v", err)
	}
	service, err := os.ReadFile(filepath.Join(dest, "etc", "systemd", "system", "mizupanel-agent.service"))
	if err != nil {
		t.Fatalf("read installed service: %v", err)
	}
	template, err := os.ReadFile(filepath.Join(repoRoot, "systemd", "mizupanel-agent.service"))
	if err != nil {
		t.Fatalf("read service template: %v", err)
	}
	if string(service) != string(template) {
		t.Fatalf("installed service differs from template:\n%s", service)
	}
	if strings.Contains(string(service), "User=root") {
		t.Fatalf("service must not run as root:\n%s", service)
	}
	if !strings.Contains(string(service), "User=mizupanel-agent") {
		t.Fatalf("service must run as mizupanel-agent:\n%s", service)
	}
	if !strings.Contains(string(service), "ExecStart=/opt/mizupanel/bin/mizupanel-agent -config /etc/mizupanel/agent.yaml") {
		t.Fatalf("service has unexpected ExecStart:\n%s", service)
	}
}

func runCommand(t *testing.T, path string, env map[string]string, args ...string) (string, error) {
	t.Helper()
	cmd := exec.Command(path, args...)
	cmd.Env = os.Environ()
	for key, value := range env {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	output, err := cmd.CombinedOutput()
	return string(output), err
}
