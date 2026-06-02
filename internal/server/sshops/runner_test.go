package sshops

import (
	"errors"
	"strings"
	"testing"
)

func TestInstallCommandUsesHostedScriptAndRootOnlyFlags(t *testing.T) {
	request := InstallRequest{
		BaseURL:        "http://panel.example:8080",
		ServerURL:      "ws://panel.example:8080/api/agent/ws",
		Token:          "install-token",
		NodeID:         "node-1",
		Name:           "Node 1",
		Mode:           "ops",
		EnableDocker:   true,
		EnableTerminal: true,
	}

	command := InstallCommand(request)

	for _, expected := range []string{
		`script="$(mktemp /tmp/mizupanel-install-agent.XXXXXX)"`,
		`trap 'rm -f "$script"' EXIT`,
		"curl -fsSL 'http://panel.example:8080/scripts/install-agent.sh' -o \"$script\"",
		`chmod 700 "$script"`,
		`"$script"`,
		"--binary-base-url 'http://panel.example:8080/downloads'",
		"--server-url 'ws://panel.example:8080/api/agent/ws'",
		"--token 'install-token'",
		"--node-id 'node-1'",
		"--name 'Node 1'",
		"--mode 'ops'",
		"--enable-docker",
		"--enable-terminal",
	} {
		if !strings.Contains(command, expected) {
			t.Fatalf("command missing %q:\n%s", expected, command)
		}
	}
	if strings.Contains(command, "/tmp/mizupanel-install-agent.sh") {
		t.Fatalf("install command should not use a predictable /tmp script path:\n%s", command)
	}
	if strings.Contains(command, "sudo") {
		t.Fatalf("install command should be root-only and not use sudo:\n%s", command)
	}
}

func TestInstallCommandUsesRemoteHostnameDefaultsWhenNodeIdentityIsEmpty(t *testing.T) {
	command := InstallCommand(InstallRequest{
		BaseURL:   "http://panel.example:8080",
		ServerURL: "ws://panel.example:8080/api/agent/ws",
		Token:     "install-token",
	})

	if !strings.Contains(command, `NODE_ID="${NODE_ID:-$(hostname)}"`) {
		t.Fatalf("install command should default empty node_id to remote hostname:\n%s", command)
	}
	if !strings.Contains(command, `NODE_NAME="${NODE_NAME:-$NODE_ID}"`) {
		t.Fatalf("install command should default empty name to node id:\n%s", command)
	}
	if !strings.Contains(command, `--node-id "$NODE_ID"`) || !strings.Contains(command, `--name "$NODE_NAME"`) {
		t.Fatalf("install command should pass resolved node identity variables:\n%s", command)
	}
}

func TestUninstallCommandUsesHostedScript(t *testing.T) {
	command := UninstallCommand(UninstallRequest{BaseURL: "https://panel.example"})

	for _, expected := range []string{
		`script="$(mktemp /tmp/mizupanel-uninstall-agent.XXXXXX)"`,
		`trap 'rm -f "$script"' EXIT`,
		"curl -fsSL 'https://panel.example/scripts/uninstall-agent.sh' -o \"$script\"",
		`chmod 700 "$script"`,
		`"$script"`,
	} {
		if !strings.Contains(command, expected) {
			t.Fatalf("command missing %q:\n%s", expected, command)
		}
	}
	if strings.Contains(command, "/tmp/mizupanel-uninstall-agent.sh") {
		t.Fatalf("uninstall command should not use a predictable /tmp script path:\n%s", command)
	}
}

func TestRemoteCommandErrorIncludesRemoteOutput(t *testing.T) {
	err := remoteCommandError([]byte("curl: (7) Failed to connect to panel.example port 8080\n"), errors.New("Process exited with status 7"))

	message := err.Error()
	if !strings.Contains(message, "Process exited with status 7") {
		t.Fatalf("error missing exit status: %q", message)
	}
	if !strings.Contains(message, "curl: (7) Failed to connect to panel.example port 8080") {
		t.Fatalf("error missing remote output: %q", message)
	}
}
