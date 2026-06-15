package docker

import (
	"bufio"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"sync"
)

// LogsManager manages container logs streaming sessions
type LogsManager struct {
	sessions map[string]*LogsSession
	mu       sync.RWMutex
	client   *Collector
}

// NewLogsManager creates a new container logs manager
func NewLogsManager(client *Collector) *LogsManager {
	return &LogsManager{
		sessions: make(map[string]*LogsSession),
		client:   client,
	}
}

// Start begins streaming container logs
func (m *LogsManager) Start(ctx context.Context, sessionID, containerID string, lines int, follow bool, timestamps bool, onData func(string, string), onExit func(error)) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.sessions[sessionID]; exists {
		return fmt.Errorf("session already exists: %s", sessionID)
	}

	session := &LogsSession{
		sessionID:   sessionID,
		containerID: containerID,
		onData:      onData,
		onExit:      onExit,
		cancel:      nil,
	}

	ctx, cancel := context.WithCancel(ctx)
	session.cancel = cancel

	m.sessions[sessionID] = session

	go session.run(ctx, m.client, lines, follow, timestamps)

	return nil
}

// Stop stops a container logs session
func (m *LogsManager) Stop(sessionID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if session, exists := m.sessions[sessionID]; exists {
		if session.cancel != nil {
			session.cancel()
		}
		delete(m.sessions, sessionID)
	}
}

// LogsSession represents a container logs streaming session
type LogsSession struct {
	sessionID   string
	containerID string
	onData      func(data string, stream string) // stream is "stdout" or "stderr"
	onExit      func(error)
	cancel      context.CancelFunc
}

func (s *LogsSession) run(ctx context.Context, client *Collector, lines int, follow bool, timestamps bool) {
	defer func() {
		if s.onExit != nil {
			s.onExit(nil)
		}
	}()

	// Get logs stream from Docker API
	stream, err := client.ContainerLogs(ctx, s.containerID, lines, follow, timestamps)
	if err != nil {
		if s.onExit != nil {
			s.onExit(fmt.Errorf("get container logs: %w", err))
		}
		return
	}
	defer stream.Close()

	// Docker logs API returns either:
	// 1. Multiplexed format (no TTY): [8]byte header + payload
	// 2. Raw format (with TTY): direct text stream
	// We need to detect which format by inspecting the first byte

	reader := bufio.NewReaderSize(stream, 64*1024) // 64KB buffer

	// Peek at first byte to detect format
	firstByte, err := reader.Peek(1)
	if err != nil {
		if err == io.EOF {
			if s.onData != nil {
				s.onData("(容器没有日志输出)\n", "stdout")
			}
			return
		}
		if s.onExit != nil {
			s.onExit(fmt.Errorf("peek first byte: %w", err))
		}
		return
	}

	// Check if this looks like multiplexed format
	// Valid stream types are 0 (stdin), 1 (stdout), 2 (stderr)
	isMultiplexed := firstByte[0] <= 2

	if isMultiplexed {
		s.readMultiplexed(ctx, reader)
	} else {
		s.readRaw(ctx, reader)
	}
}

func (s *LogsSession) readMultiplexed(ctx context.Context, reader *bufio.Reader) {
	header := make([]byte, 8)
	lineCount := 0

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		// Read header
		_, err := io.ReadFull(reader, header)
		if err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				return
			}
			if s.onExit != nil {
				s.onExit(fmt.Errorf("read header: %w", err))
			}
			return
		}

		// Parse header
		streamType := header[0]
		payloadSize := binary.BigEndian.Uint32(header[4:8])

		// Read payload
		payload := make([]byte, payloadSize)
		_, err = io.ReadFull(reader, payload)
		if err != nil {
			if s.onExit != nil {
				s.onExit(fmt.Errorf("read payload: %w", err))
			}
			return
		}

		lineCount++

		// Determine stream name
		var streamName string
		switch streamType {
		case 0:
			streamName = "stdin"
		case 1:
			streamName = "stdout"
		case 2:
			streamName = "stderr"
		default:
			streamName = "unknown"
		}

		// Send data
		if s.onData != nil {
			s.onData(string(payload), streamName)
		}
	}
}

func (s *LogsSession) readRaw(ctx context.Context, reader *bufio.Reader) {
	// For raw format (TTY mode), just read line by line
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				// Send remaining data if any
				if len(line) > 0 && s.onData != nil {
					s.onData(line, "stdout")
				}
				return
			}
			if s.onExit != nil {
				s.onExit(fmt.Errorf("read line: %w", err))
			}
			return
		}

		// Send line
		if s.onData != nil {
			s.onData(line, "stdout")
		}
	}
}
