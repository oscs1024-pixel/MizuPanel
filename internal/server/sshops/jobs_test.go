package sshops

import (
	"context"
	"strings"
	"testing"
)

func TestManagerRunsJobAndStoresProgressEvents(t *testing.T) {
	manager := NewManager()

	jobID := manager.Start(context.Background(), []string{"secret-token"}, func(ctx context.Context, emit EmitFunc) error {
		emit(ProgressEvent{Step: "connect_ssh", Label: "连接 SSH", Status: ProgressRunning, Message: "using secret-token"})
		emit(ProgressEvent{Step: "connect_ssh", Label: "连接 SSH", Status: ProgressSuccess, Message: "connected"})
		return nil
	})

	job := manager.Wait(jobID)
	if job == nil {
		t.Fatalf("job not found")
	}
	if job.Status != ProgressSuccess {
		t.Fatalf("job status = %s, want success", job.Status)
	}
	events := manager.Events(jobID)
	if len(events) < 3 {
		t.Fatalf("events = %#v, want start, progress, done", events)
	}
	for _, event := range events {
		if strings.Contains(event.Message, "secret-token") {
			t.Fatalf("event leaked secret: %#v", event)
		}
	}
	last := events[len(events)-1]
	if !last.Done || last.Status != ProgressSuccess {
		t.Fatalf("last event = %#v, want done success", last)
	}
}

func TestManagerSubscribeReceivesLiveEvents(t *testing.T) {
	manager := NewManager()
	ready := make(chan struct{})
	release := make(chan struct{})

	jobID := manager.Start(context.Background(), nil, func(ctx context.Context, emit EmitFunc) error {
		close(ready)
		<-release
		emit(ProgressEvent{Step: "run_install", Label: "执行安装", Status: ProgressSuccess, Message: "installed"})
		return nil
	})
	<-ready
	history, updates, ok := manager.Subscribe(jobID)
	if !ok {
		t.Fatalf("Subscribe returned ok=false")
	}
	if len(history) == 0 {
		t.Fatalf("history should include start event")
	}
	close(release)

	var received ProgressEvent
	for event := range updates {
		if event.Step == "run_install" {
			received = event
			break
		}
	}
	if received.Status != ProgressSuccess {
		t.Fatalf("received = %#v, want run_install success", received)
	}
}

func TestManagerMarksJobFailed(t *testing.T) {
	manager := NewManager()

	jobID := manager.Start(context.Background(), nil, func(ctx context.Context, emit EmitFunc) error {
		return errForTest("ssh authentication failed")
	})

	job := manager.Wait(jobID)
	if job == nil || job.Status != ProgressFailed {
		t.Fatalf("job = %#v, want failed", job)
	}
	events := manager.Events(jobID)
	last := events[len(events)-1]
	if !last.Done || last.Status != ProgressFailed || !strings.Contains(last.Message, "ssh authentication failed") {
		t.Fatalf("last event = %#v, want failed done event", last)
	}
}

func TestManagerClearsSecretsAfterJobCompletes(t *testing.T) {
	manager := NewManager()

	jobID := manager.Start(context.Background(), []string{"secret-token", "root-password"}, func(ctx context.Context, emit EmitFunc) error {
		emit(ProgressEvent{Step: "run_install", Label: "执行安装", Status: ProgressSuccess, Message: "used secret-token"})
		return nil
	})

	job := manager.Wait(jobID)
	if job == nil {
		t.Fatalf("job not found")
	}
	if len(job.secrets) != 0 {
		t.Fatalf("job retained %d secret references after completion", len(job.secrets))
	}
	for _, event := range manager.Events(jobID) {
		if strings.Contains(event.Message, "secret-token") || strings.Contains(event.Message, "root-password") {
			t.Fatalf("event leaked secret after cleanup: %#v", event)
		}
	}
}

type errForTest string

func (e errForTest) Error() string { return string(e) }
