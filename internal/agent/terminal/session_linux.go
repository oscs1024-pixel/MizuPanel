//go:build linux

package terminal

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"github.com/creack/pty"
)

type session struct {
	id      string
	manager *Manager
	cmd     *exec.Cmd
	pty     *os.File
	once    sync.Once
}

func startSession(sessionID string, rows uint16, cols uint16, manager *Manager) (*session, error) {
	shell := chooseShell(os.Getenv, []string{"/bin/bash", "/bin/sh"})
	cmd := exec.Command(shell)
	cmd.Args[0] = loginShellArgv0(shell)
	cmd.Env = terminalEnv(os.Environ(), shell)
	file, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: rows, Cols: cols})
	if err != nil {
		return nil, err
	}
	sess := &session{id: sessionID, manager: manager, cmd: cmd, pty: file}
	go sess.readLoop()
	go sess.waitLoop()
	return sess, nil
}

func chooseShell(getenv func(string) string, fallbacks []string) string {
	candidates := make([]string, 0, 1+len(fallbacks))
	if shell := getenv("SHELL"); shell != "" {
		candidates = append(candidates, shell)
	}
	candidates = append(candidates, fallbacks...)
	for _, candidate := range candidates {
		if unusableShell(candidate) {
			continue
		}
		info, err := os.Stat(candidate)
		if err == nil && !info.IsDir() && info.Mode()&0111 != 0 {
			return candidate
		}
	}
	return "/bin/sh"
}

func unusableShell(shell string) bool {
	switch filepath.Base(shell) {
	case "nologin", "false":
		return true
	default:
		return false
	}
}

func loginShellArgv0(shell string) string {
	base := filepath.Base(shell)
	if base == "." || base == string(filepath.Separator) || base == "" {
		return shell
	}
	return "-" + base
}

func terminalEnv(base []string, shell string) []string {
	env := make([]string, 0, len(base)+2)
	for _, entry := range base {
		if hasEnvKey(entry, "TERM") || hasEnvKey(entry, "SHELL") {
			continue
		}
		env = append(env, entry)
	}
	return append(env, "TERM=xterm-256color", "SHELL="+shell)
}

func hasEnvKey(entry string, key string) bool {
	return len(entry) > len(key) && entry[:len(key)] == key && entry[len(key)] == '='
}

func (s *session) write(data []byte) error {
	_, err := s.pty.Write(data)
	return err
}

func (s *session) resize(rows uint16, cols uint16) error {
	return pty.Setsize(s.pty, &pty.Winsize{Rows: rows, Cols: cols})
}

func (s *session) close() {
	s.once.Do(func() {
		_ = s.pty.Close()
		if s.cmd.Process != nil {
			_ = s.cmd.Process.Kill()
		}
	})
}

func (s *session) readLoop() {
	buffer := make([]byte, 8192)
	for {
		count, err := s.pty.Read(buffer)
		if count > 0 {
			s.manager.emitData(s.id, buffer[:count])
		}
		if err != nil {
			return
		}
	}
}

func (s *session) waitLoop() {
	err := s.cmd.Wait()
	exitCode := 0
	if err != nil {
		exitCode = 1
		var exitError *exec.ExitError
		if errors.As(err, &exitError) {
			exitCode = exitError.ExitCode()
		}
	}
	s.manager.emitExit(s.id, exitCode)
}
