package sshops

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
)

type ProgressStatus string

const (
	ProgressPending ProgressStatus = "pending"
	ProgressRunning ProgressStatus = "running"
	ProgressSuccess ProgressStatus = "success"
	ProgressFailed  ProgressStatus = "failed"
)

type ProgressEvent struct {
	Step    string         `json:"step"`
	Label   string         `json:"label"`
	Status  ProgressStatus `json:"status"`
	Message string         `json:"message"`
	Done    bool           `json:"done,omitempty"`
}

type EmitFunc func(ProgressEvent)

type Job struct {
	ID          string
	Status      ProgressStatus
	events      []ProgressEvent
	secrets     []string
	done        chan struct{}
	subscribers []chan ProgressEvent
	mu          sync.Mutex
}

type Manager struct {
	mu   sync.Mutex
	jobs map[string]*Job
}

func NewManager() *Manager {
	return &Manager{jobs: make(map[string]*Job)}
}

func (m *Manager) Start(ctx context.Context, secrets []string, operation func(context.Context, EmitFunc) error) string {
	jobID := randomJobID()
	job := &Job{ID: jobID, Status: ProgressRunning, secrets: secrets, done: make(chan struct{})}
	m.mu.Lock()
	m.jobs[jobID] = job
	m.mu.Unlock()
	job.add(ProgressEvent{Step: "start", Label: "开始", Status: ProgressRunning, Message: "任务已开始"})
	go func() {
		defer close(job.done)
		defer job.clearSecrets()
		emit := func(event ProgressEvent) { job.add(event) }
		if err := operation(ctx, emit); err != nil {
			job.setStatus(ProgressFailed)
			job.add(ProgressEvent{Step: "failed", Label: "失败", Status: ProgressFailed, Message: err.Error(), Done: true})
			return
		}
		job.setStatus(ProgressSuccess)
		job.add(ProgressEvent{Step: "done", Label: "完成", Status: ProgressSuccess, Message: "任务已完成", Done: true})
	}()
	return jobID
}

func (m *Manager) Job(jobID string) *Job {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.jobs[jobID]
}

func (m *Manager) Wait(jobID string) *Job {
	job := m.Job(jobID)
	if job == nil {
		return nil
	}
	<-job.done
	return job
}

func (m *Manager) Events(jobID string) []ProgressEvent {
	job := m.Job(jobID)
	if job == nil {
		return nil
	}
	job.mu.Lock()
	defer job.mu.Unlock()
	events := make([]ProgressEvent, len(job.events))
	copy(events, job.events)
	return events
}

func (m *Manager) Subscribe(jobID string) ([]ProgressEvent, <-chan ProgressEvent, bool) {
	job := m.Job(jobID)
	if job == nil {
		return nil, nil, false
	}
	job.mu.Lock()
	defer job.mu.Unlock()
	history := make([]ProgressEvent, len(job.events))
	copy(history, job.events)
	updates := make(chan ProgressEvent, 16)
	if job.Status == ProgressRunning || job.Status == ProgressPending {
		job.subscribers = append(job.subscribers, updates)
	} else {
		close(updates)
	}
	return history, updates, true
}

func (j *Job) add(event ProgressEvent) {
	j.mu.Lock()
	defer j.mu.Unlock()
	event.Message = SanitizeProgressMessage(event.Message, j.secrets)
	j.events = append(j.events, event)
	for _, subscriber := range j.subscribers {
		select {
		case subscriber <- event:
		default:
		}
	}
	if event.Done {
		for _, subscriber := range j.subscribers {
			close(subscriber)
		}
		j.subscribers = nil
	}
}

func (j *Job) setStatus(status ProgressStatus) {
	j.mu.Lock()
	j.Status = status
	j.mu.Unlock()
}

func (j *Job) clearSecrets() {
	j.mu.Lock()
	j.secrets = nil
	j.mu.Unlock()
}

func randomJobID() string {
	var bytes [12]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "ssh-job"
	}
	return "ssh-" + hex.EncodeToString(bytes[:])
}
