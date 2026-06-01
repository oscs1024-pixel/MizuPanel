//go:build !linux

package terminal

type session struct{}

func startSession(sessionID string, rows uint16, cols uint16, manager *Manager) (*session, error) {
	return nil, ErrUnsupported
}

func (s *session) write(data []byte) error {
	return ErrUnsupported
}

func (s *session) resize(rows uint16, cols uint16) error {
	return ErrUnsupported
}

func (s *session) close() {}
