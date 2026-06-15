package logtail

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Manager manages log tail sessions
type Manager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
}

// NewManager creates a new log tail manager
func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

// Start begins tailing a log file
func (m *Manager) Start(ctx context.Context, sessionID, path string, initialLines int, onData func(string), onExit func(error)) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.sessions[sessionID]; exists {
		return fmt.Errorf("session already exists: %s", sessionID)
	}

	session := &Session{
		sessionID: sessionID,
		path:      path,
		onData:    onData,
		onExit:    onExit,
		cancel:    nil,
	}

	ctx, cancel := context.WithCancel(ctx)
	session.cancel = cancel

	m.sessions[sessionID] = session

	go session.run(ctx, initialLines)

	return nil
}

// Stop stops a log tail session
func (m *Manager) Stop(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if session, exists := m.sessions[sessionID]; exists {
		if session.cancel != nil {
			session.cancel()
		}
		delete(m.sessions, sessionID)
	}
}

// Session represents a log tail session
type Session struct {
	sessionID string
	path      string
	onData    func(string)
	onExit    func(error)
	cancel    context.CancelFunc
}

func (s *Session) run(ctx context.Context, initialLines int) {
	defer func() {
		if s.onExit != nil {
			s.onExit(nil)
		}
	}()

	// Open file
	file, err := os.Open(s.path)
	if err != nil {
		if s.onExit != nil {
			s.onExit(fmt.Errorf("open file: %w", err))
		}
		return
	}
	defer file.Close()

	// Read initial lines (like tail -n)
	if initialLines > 0 {
		lines, err := readLastLines(file, initialLines)
		if err != nil {
			if s.onExit != nil {
				s.onExit(fmt.Errorf("read initial lines: %w", err))
			}
			return
		}
		for _, line := range lines {
			if s.onData != nil {
				s.onData(line + "\n")
			}
		}
	}

	// Seek to end
	if _, err := file.Seek(0, os.SEEK_END); err != nil {
		if s.onExit != nil {
			s.onExit(fmt.Errorf("seek to end: %w", err))
		}
		return
	}

	// Watch for changes
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		if s.onExit != nil {
			s.onExit(fmt.Errorf("create watcher: %w", err))
		}
		return
	}
	defer watcher.Close()

	if err := watcher.Add(s.path); err != nil {
		if s.onExit != nil {
			s.onExit(fmt.Errorf("add watch: %w", err))
		}
		return
	}

	reader := bufio.NewReader(file)

	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			if event.Op&fsnotify.Write == fsnotify.Write {
				// Read new lines
				for {
					line, err := reader.ReadString('\n')
					if err != nil {
						break
					}
					if s.onData != nil {
						s.onData(line)
					}
				}
			} else if event.Op&fsnotify.Remove == fsnotify.Remove || event.Op&fsnotify.Rename == fsnotify.Rename {
				// File was removed or renamed (log rotation)
				if s.onExit != nil {
					s.onExit(fmt.Errorf("file removed or rotated"))
				}
				return
			}
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			if s.onExit != nil {
				s.onExit(fmt.Errorf("watcher error: %w", err))
			}
			return
		case <-time.After(30 * time.Second):
			// Periodic check to prevent goroutine leak
			continue
		}
	}
}

// readLastLines reads the last n lines from a file
func readLastLines(file *os.File, n int) ([]string, error) {
	stat, err := file.Stat()
	if err != nil {
		return nil, err
	}

	fileSize := stat.Size()
	if fileSize == 0 {
		return []string{}, nil
	}

	// Read from end in chunks
	const chunkSize = 8192
	var lines []string
	var buffer []byte
	pos := fileSize

	for len(lines) < n && pos > 0 {
		readSize := int64(chunkSize)
		if pos < readSize {
			readSize = pos
		}
		pos -= readSize

		chunk := make([]byte, readSize)
		if _, err := file.ReadAt(chunk, pos); err != nil {
			return nil, err
		}

		// Prepend to buffer
		buffer = append(chunk, buffer...)

		// Split into lines
		scanner := bufio.NewScanner(bufio.NewReader(bufio.NewReader(os.Stdin)))
		scanner.Split(bufio.ScanLines)

		tempLines := []string{}
		for i := 0; i < len(buffer); {
			end := i
			for end < len(buffer) && buffer[end] != '\n' {
				end++
			}
			if end < len(buffer) {
				tempLines = append(tempLines, string(buffer[i:end]))
				i = end + 1
			} else {
				break
			}
		}

		lines = append(tempLines, lines...)

		if pos == 0 {
			break
		}
	}

	// Return last n lines
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}

	return lines, nil
}
