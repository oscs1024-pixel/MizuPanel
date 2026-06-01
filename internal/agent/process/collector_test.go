package process

import "testing"

func TestCollectorMergesTopCPUAndMemoryAndOmitsCommandLine(t *testing.T) {
	collector := NewCollector()
	collector.topCPULimit = 1
	collector.topMemoryLimit = 1
	collector.listProcesses = func() ([]processReader, error) {
		return []processReader{
			fakeProcess{pid: 1, name: "cpu", command: "short", cpu: 90, rss: 100, memory: 1},
			fakeProcess{pid: 2, name: "mem", command: "this command line is much too long", cpu: 10, rss: 900, memory: 9},
			fakeProcess{pid: 3, name: "other", command: "other", cpu: 20, rss: 200, memory: 2},
		}, nil
	}

	snapshot := collector.Collect()

	if snapshot.Error != "" {
		t.Fatalf("Error = %q, want empty", snapshot.Error)
	}
	if len(snapshot.Processes) != 2 {
		t.Fatalf("len(processes) = %d, want 2: %#v", len(snapshot.Processes), snapshot.Processes)
	}
	if snapshot.Processes[0].PID != 1 || snapshot.Processes[1].PID != 2 {
		t.Fatalf("process order = %#v, want CPU winner then memory winner", snapshot.Processes)
	}
	for _, process := range snapshot.Processes {
		if process.Command != "" {
			t.Fatalf("Command = %q, want empty", process.Command)
		}
	}
}

func TestCollectorReturnsStructuredErrorWhenListingFails(t *testing.T) {
	collector := NewCollector()
	collector.listProcesses = func() ([]processReader, error) { return nil, errFake("permission denied") }

	snapshot := collector.Collect()

	if snapshot.Error == "" {
		t.Fatal("Error is empty, want collection error")
	}
	if len(snapshot.Processes) != 0 {
		t.Fatalf("processes = %#v, want empty", snapshot.Processes)
	}
}

type fakeProcess struct {
	pid     int32
	ppid    int32
	name    string
	command string
	user    string
	status  []string
	cpu     float64
	rss     uint64
	memory  float32
	created int64
}

func (p fakeProcess) PID() int32                      { return p.pid }
func (p fakeProcess) PPID() (int32, error)            { return p.ppid, nil }
func (p fakeProcess) Name() (string, error)           { return p.name, nil }
func (p fakeProcess) Cmdline() (string, error)        { return p.command, nil }
func (p fakeProcess) Username() (string, error)       { return p.user, nil }
func (p fakeProcess) Status() ([]string, error)       { return p.status, nil }
func (p fakeProcess) CPUPercent() (float64, error)    { return p.cpu, nil }
func (p fakeProcess) MemoryInfo() (uint64, error)     { return p.rss, nil }
func (p fakeProcess) MemoryPercent() (float32, error) { return p.memory, nil }
func (p fakeProcess) CreateTime() (int64, error)      { return p.created, nil }

type errFake string

func (e errFake) Error() string { return string(e) }
