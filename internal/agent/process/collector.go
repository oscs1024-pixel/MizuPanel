package process

import (
	"sort"
	"strings"
	"time"

	"github.com/mizupanel/mizupanel/internal/protocol"
	gopsprocess "github.com/shirou/gopsutil/v4/process"
)

const (
	defaultTopCPULimit         = 50
	defaultTopMemoryLimit      = 50
	defaultCommandLineMaxBytes = 240
)

type Collector struct {
	topCPULimit          int
	topMemoryLimit       int
	commandLineMaxLength int
	listProcesses        func() ([]processReader, error)
}

type processReader interface {
	PID() int32
	PPID() (int32, error)
	Name() (string, error)
	Cmdline() (string, error)
	Username() (string, error)
	Status() ([]string, error)
	CPUPercent() (float64, error)
	MemoryInfo() (uint64, error)
	MemoryPercent() (float32, error)
	CreateTime() (int64, error)
}

func NewCollector() *Collector {
	collector := &Collector{
		topCPULimit:          defaultTopCPULimit,
		topMemoryLimit:       defaultTopMemoryLimit,
		commandLineMaxLength: defaultCommandLineMaxBytes,
	}
	collector.listProcesses = collector.defaultListProcesses
	return collector
}

func (c *Collector) Collect() protocol.ProcessSnapshot {
	if c.topCPULimit <= 0 {
		c.topCPULimit = defaultTopCPULimit
	}
	if c.topMemoryLimit <= 0 {
		c.topMemoryLimit = defaultTopMemoryLimit
	}
	if c.commandLineMaxLength <= 0 {
		c.commandLineMaxLength = defaultCommandLineMaxBytes
	}
	snapshot := protocol.ProcessSnapshot{CollectedAt: time.Now().Unix(), Processes: []protocol.ProcessInfo{}}
	processes, err := c.listProcesses()
	if err != nil {
		snapshot.Error = err.Error()
		return snapshot
	}
	infos := make([]protocol.ProcessInfo, 0, len(processes))
	var errorsSeen []string
	for _, proc := range processes {
		info, errText := c.readProcess(proc)
		if errText != "" && len(errorsSeen) < 3 {
			errorsSeen = append(errorsSeen, errText)
		}
		infos = append(infos, info)
	}
	snapshot.Processes = mergeTopProcesses(infos, c.topCPULimit, c.topMemoryLimit)
	if len(errorsSeen) > 0 {
		snapshot.Error = strings.Join(errorsSeen, "; ")
	}
	return snapshot
}

func (c *Collector) readProcess(proc processReader) (protocol.ProcessInfo, string) {
	info := protocol.ProcessInfo{PID: proc.PID(), Status: "unknown"}
	var failures []string
	if value, err := proc.PPID(); err == nil {
		info.PPID = value
	} else {
		failures = append(failures, "ppid")
	}
	if value, err := proc.Name(); err == nil {
		info.Name = value
	} else {
		failures = append(failures, "name")
	}
	info.Command = ""
	if value, err := proc.Username(); err == nil {
		info.User = value
	} else {
		failures = append(failures, "user")
	}
	if value, err := proc.Status(); err == nil && len(value) > 0 {
		info.Status = normalizeStatus(value[0])
	} else if err != nil {
		failures = append(failures, "status")
	}
	if value, err := proc.CPUPercent(); err == nil {
		info.CPUUsage = value
	} else {
		failures = append(failures, "cpu")
	}
	if value, err := proc.MemoryInfo(); err == nil {
		info.MemoryRSS = value
	} else {
		failures = append(failures, "memory")
	}
	if value, err := proc.MemoryPercent(); err == nil {
		info.MemoryUsage = float64(value)
	}
	if value, err := proc.CreateTime(); err == nil {
		info.CreatedAt = value / 1000
	}
	if len(failures) > 0 {
		return info, "pid " + int32String(info.PID) + " missing " + strings.Join(failures, ",")
	}
	return info, ""
}

func (c *Collector) defaultListProcesses() ([]processReader, error) {
	processes, err := gopsprocess.Processes()
	if err != nil {
		return nil, err
	}
	readers := make([]processReader, 0, len(processes))
	for _, proc := range processes {
		readers = append(readers, gopsutilProcess{proc: proc})
	}
	return readers, nil
}

type gopsutilProcess struct {
	proc *gopsprocess.Process
}

func (p gopsutilProcess) PID() int32                   { return p.proc.Pid }
func (p gopsutilProcess) PPID() (int32, error)         { return p.proc.Ppid() }
func (p gopsutilProcess) Name() (string, error)        { return p.proc.Name() }
func (p gopsutilProcess) Cmdline() (string, error)     { return p.proc.Cmdline() }
func (p gopsutilProcess) Username() (string, error)    { return p.proc.Username() }
func (p gopsutilProcess) Status() ([]string, error)    { return p.proc.Status() }
func (p gopsutilProcess) CPUPercent() (float64, error) { return p.proc.CPUPercent() }
func (p gopsutilProcess) MemoryInfo() (uint64, error) {
	info, err := p.proc.MemoryInfo()
	if err != nil || info == nil {
		return 0, err
	}
	return info.RSS, nil
}
func (p gopsutilProcess) MemoryPercent() (float32, error) { return p.proc.MemoryPercent() }
func (p gopsutilProcess) CreateTime() (int64, error)      { return p.proc.CreateTime() }

func mergeTopProcesses(processes []protocol.ProcessInfo, cpuLimit int, memoryLimit int) []protocol.ProcessInfo {
	byCPU := append([]protocol.ProcessInfo(nil), processes...)
	sort.SliceStable(byCPU, func(i, j int) bool {
		if byCPU[i].CPUUsage == byCPU[j].CPUUsage {
			return byCPU[i].PID < byCPU[j].PID
		}
		return byCPU[i].CPUUsage > byCPU[j].CPUUsage
	})
	byMemory := append([]protocol.ProcessInfo(nil), processes...)
	sort.SliceStable(byMemory, func(i, j int) bool {
		if byMemory[i].MemoryRSS == byMemory[j].MemoryRSS {
			return byMemory[i].PID < byMemory[j].PID
		}
		return byMemory[i].MemoryRSS > byMemory[j].MemoryRSS
	})
	seen := make(map[int32]bool)
	merged := make([]protocol.ProcessInfo, 0, minInt(len(processes), cpuLimit+memoryLimit))
	add := func(list []protocol.ProcessInfo, limit int) {
		for i, proc := range list {
			if i >= limit {
				return
			}
			if seen[proc.PID] {
				continue
			}
			seen[proc.PID] = true
			merged = append(merged, proc)
		}
	}
	add(byCPU, cpuLimit)
	add(byMemory, memoryLimit)
	return merged
}

func truncateCommandLine(value string, limit int) string {
	value = strings.Join(strings.Fields(value), " ")
	if limit <= 0 || len(value) <= limit {
		return value
	}
	if limit <= 3 {
		return value[:limit]
	}
	return value[:limit-3] + "..."
}

func normalizeStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "r", "running", "run":
		return "running"
	case "s", "sleep", "sleeping", "idle":
		return "sleeping"
	case "t", "stopped", "stop":
		return "stopped"
	case "z", "zombie":
		return "zombie"
	case "":
		return "unknown"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func int32String(value int32) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	var buf [12]byte
	i := len(buf)
	for value > 0 {
		i--
		buf[i] = byte('0' + value%10)
		value /= 10
	}
	if negative {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
