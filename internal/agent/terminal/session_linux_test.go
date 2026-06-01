//go:build linux

package terminal

import (
	"os"
	"path/filepath"
	"testing"
)

func TestChooseShellUsesValidShellEnvThenFallbacks(t *testing.T) {
	dir := t.TempDir()
	custom := filepath.Join(dir, "customsh")
	bash := filepath.Join(dir, "bash")
	sh := filepath.Join(dir, "sh")
	for _, path := range []string{custom, bash, sh} {
		if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatalf("write shell: %v", err)
		}
	}

	if got := chooseShell(func(string) string { return custom }, []string{bash, sh}); got != custom {
		t.Fatalf("chooseShell env = %q, want %q", got, custom)
	}
	if got := chooseShell(func(string) string { return filepath.Join(dir, "missing") }, []string{bash, sh}); got != bash {
		t.Fatalf("chooseShell fallback = %q, want %q", got, bash)
	}
	if got := chooseShell(func(string) string { return "/usr/sbin/nologin" }, []string{bash, sh}); got != bash {
		t.Fatalf("chooseShell nologin fallback = %q, want %q", got, bash)
	}
	if got := chooseShell(func(string) string { return "/bin/false" }, []string{bash, sh}); got != bash {
		t.Fatalf("chooseShell false fallback = %q, want %q", got, bash)
	}
	if err := os.Remove(bash); err != nil {
		t.Fatalf("remove bash: %v", err)
	}
	if got := chooseShell(func(string) string { return "" }, []string{bash, sh}); got != sh {
		t.Fatalf("chooseShell sh fallback = %q, want %q", got, sh)
	}
}

func TestLoginShellArgv0(t *testing.T) {
	if got := loginShellArgv0("/usr/bin/bash"); got != "-bash" {
		t.Fatalf("loginShellArgv0 = %q, want -bash", got)
	}
}

func TestTerminalEnvOverridesShell(t *testing.T) {
	env := terminalEnv([]string{"PATH=/usr/bin", "SHELL=/usr/sbin/nologin", "TERM=dumb"}, "/bin/bash")

	got := map[string][]string{}
	for _, entry := range env {
		for _, key := range []string{"PATH", "SHELL", "TERM"} {
			prefix := key + "="
			if len(entry) >= len(prefix) && entry[:len(prefix)] == prefix {
				got[key] = append(got[key], entry[len(prefix):])
			}
		}
	}
	want := map[string]string{
		"PATH":  "/usr/bin",
		"SHELL": "/bin/bash",
		"TERM":  "xterm-256color",
	}
	for key, value := range want {
		values := got[key]
		if len(values) != 1 || values[0] != value {
			t.Fatalf("terminalEnv %s = %#v, want only %q in %#v", key, values, value, env)
		}
	}
}
