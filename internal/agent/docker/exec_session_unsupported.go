//go:build !linux

package docker

import "github.com/mizupanel/mizupanel/internal/protocol"

type execSession struct {
	containerID string
}

func startExecSession(sessionID string, containerID string, command string, rows uint16, cols uint16, manager *ExecManager) (*execSession, error) {
	return nil, ErrExecUnsupported
}

func (s *execSession) write(data []byte) error {
	return ErrExecUnsupported
}

func (s *execSession) resize(rows uint16, cols uint16) error {
	return ErrExecUnsupported
}

func (s *execSession) close() {}

var _ = protocol.ContainerExecMessage{}
