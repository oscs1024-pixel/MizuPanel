package protocol

const (
	MessageTypeHello              = "hello"
	MessageTypeHelloAck           = "hello_ack"
	MessageTypeMetrics            = "metrics"
	MessageTypePing               = "ping"
	MessageTypePong               = "pong"
	MessageTypeFileListRequest    = "file_list_request"
	MessageTypeFileListResponse   = "file_list_response"
	MessageTypeFileReadRequest    = "file_read_request"
	MessageTypeFileReadResponse   = "file_read_response"
	MessageTypeFileWriteRequest   = "file_write_request"
	MessageTypeFileWriteResponse  = "file_write_response"
	MessageTypeFileUploadRequest  = "file_upload_request"
	MessageTypeFileUploadResponse = "file_upload_response"
	MessageTypeFileDeleteRequest  = "file_delete_request"
	MessageTypeFileDeleteResponse = "file_delete_response"
	MessageTypeRebootRequest      = "reboot_request"
	MessageTypeRebootResponse     = "reboot_response"
	MessageTypeTerminalStart      = "terminal_start"
	MessageTypeTerminalStarted    = "terminal_started"
	MessageTypeTerminalData       = "terminal_data"
	MessageTypeTerminalResize     = "terminal_resize"
	MessageTypeTerminalClose      = "terminal_close"
	MessageTypeTerminalExit       = "terminal_exit"
	MessageTypeTerminalError      = "terminal_error"

	MessageTypeContainerExecStart   = "container_exec_start"
	MessageTypeContainerExecStarted = "container_exec_started"
	MessageTypeContainerExecData    = "container_exec_data"
	MessageTypeContainerExecResize  = "container_exec_resize"
	MessageTypeContainerExecClose   = "container_exec_close"
	MessageTypeContainerExecExit    = "container_exec_exit"
	MessageTypeContainerExecError   = "container_exec_error"
)

type HelloMessage struct {
	Type         string `json:"type"`
	NodeID       string `json:"node_id"`
	AgentVersion string `json:"agent_version"`
	Hostname     string `json:"hostname"`
	Name         string `json:"name"`
	IP           string `json:"ip"`
	OS           string `json:"os"`
	Arch         string `json:"arch"`
	Kernel       string `json:"kernel"`
	Terminal     bool   `json:"terminal"`
	AgentMode    string `json:"agent_mode,omitempty"`
	AgentUser    string `json:"agent_user,omitempty"`
}

type HelloAckMessage struct {
	Type      string `json:"type"`
	NodeID    string `json:"node_id"`
	NodeToken string `json:"node_token,omitempty"`
	Interval  int    `json:"interval"`
}

type FileListRequest struct {
	Type      string `json:"type"`
	RequestID string `json:"request_id"`
	NodeID    string `json:"node_id,omitempty"`
	Path      string `json:"path"`
}

type FileListResponse struct {
	Type      string      `json:"type"`
	RequestID string      `json:"request_id,omitempty"`
	Path      string      `json:"path,omitempty"`
	Entries   []FileEntry `json:"entries,omitempty"`
	Truncated bool        `json:"truncated,omitempty"`
	Error     string      `json:"error,omitempty"`
	Code      string      `json:"code,omitempty"`
}

type FileEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Type       string `json:"type"`
	Size       int64  `json:"size,omitempty"`
	Mode       string `json:"mode,omitempty"`
	ModifiedAt int64  `json:"modified_at,omitempty"`
	LinkTarget string `json:"link_target,omitempty"`
}

type FileReadRequest struct {
	Type      string `json:"type"`
	RequestID string `json:"request_id"`
	NodeID    string `json:"node_id,omitempty"`
	Path      string `json:"path"`
}

type FileReadResponse struct {
	Type       string `json:"type"`
	RequestID  string `json:"request_id,omitempty"`
	Path       string `json:"path,omitempty"`
	Content    string `json:"content,omitempty"`
	Editable   bool   `json:"editable"`
	Size       int64  `json:"size,omitempty"`
	Mode       string `json:"mode,omitempty"`
	ModifiedAt int64  `json:"modified_at,omitempty"`
	Error      string `json:"error,omitempty"`
	Code       string `json:"code,omitempty"`
}

type FileWriteRequest struct {
	Type      string `json:"type"`
	RequestID string `json:"request_id"`
	NodeID    string `json:"node_id,omitempty"`
	Path      string `json:"path"`
	Content   string `json:"content"`
}

type FileWriteResponse struct {
	Type      string `json:"type"`
	RequestID string `json:"request_id,omitempty"`
	Path      string `json:"path,omitempty"`
	Saved     bool   `json:"saved"`
	Error     string `json:"error,omitempty"`
	Code      string `json:"code,omitempty"`
}

type FileUploadRequest struct {
	Type          string `json:"type"`
	RequestID     string `json:"request_id"`
	NodeID        string `json:"node_id,omitempty"`
	Path          string `json:"path"`
	ContentBase64 string `json:"content_base64"`
}

type FileUploadResponse struct {
	Type      string `json:"type"`
	RequestID string `json:"request_id,omitempty"`
	Path      string `json:"path,omitempty"`
	Uploaded  bool   `json:"uploaded"`
	Size      int64  `json:"size,omitempty"`
	Error     string `json:"error,omitempty"`
	Code      string `json:"code,omitempty"`
}

type FileDeleteRequest struct {
	Type      string `json:"type"`
	RequestID string `json:"request_id"`
	NodeID    string `json:"node_id,omitempty"`
	Path      string `json:"path"`
}

type FileDeleteResponse struct {
	Type      string `json:"type"`
	RequestID string `json:"request_id,omitempty"`
	Path      string `json:"path,omitempty"`
	Deleted   bool   `json:"deleted"`
	Error     string `json:"error,omitempty"`
	Code      string `json:"code,omitempty"`
}

type RebootRequest struct {
	Type      string `json:"type"`
	RequestID string `json:"request_id"`
	NodeID    string `json:"node_id,omitempty"`
}

type RebootResponse struct {
	Type      string `json:"type"`
	RequestID string `json:"request_id,omitempty"`
	Accepted  bool   `json:"accepted"`
	Error     string `json:"error,omitempty"`
	Code      string `json:"code,omitempty"`
}

type TerminalMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id"`
	NodeID    string `json:"node_id,omitempty"`
	Data      string `json:"data,omitempty"`
	Cols      uint16 `json:"cols,omitempty"`
	Rows      uint16 `json:"rows,omitempty"`
	ExitCode  int    `json:"exit_code,omitempty"`
	Error     string `json:"error,omitempty"`
}

type ContainerExecMessage struct {
	Type        string `json:"type"`
	SessionID   string `json:"session_id"`
	NodeID      string `json:"node_id,omitempty"`
	ContainerID string `json:"container_id,omitempty"`
	Command     string `json:"command,omitempty"`
	Data        string `json:"data,omitempty"`
	Cols        uint16 `json:"cols,omitempty"`
	Rows        uint16 `json:"rows,omitempty"`
	ExitCode    int    `json:"exit_code,omitempty"`
	Error       string `json:"error,omitempty"`
}

type MetricsMessage struct {
	Type            string           `json:"type"`
	NodeID          string           `json:"node_id"`
	Timestamp       int64            `json:"timestamp"`
	System          SystemInfo       `json:"system"`
	CPU             CPUInfo          `json:"cpu"`
	Memory          MemoryInfo       `json:"memory"`
	Disk            DiskInfo         `json:"disk"`
	Network         NetworkInfo      `json:"network"`
	Load            LoadInfo         `json:"load"`
	ProcessSnapshot *ProcessSnapshot `json:"process_snapshot,omitempty"`
	DockerSnapshot  *DockerSnapshot  `json:"docker_snapshot,omitempty"`
}

// ProcessSnapshot is the latest bounded process list sampled by an agent.
type ProcessSnapshot struct {
	CollectedAt int64         `json:"collected_at"`
	Processes   []ProcessInfo `json:"processes"`
	Error       string        `json:"error,omitempty"`
}

type ProcessInfo struct {
	PID         int32   `json:"pid"`
	PPID        int32   `json:"ppid"`
	Name        string  `json:"name"`
	Command     string  `json:"command"`
	User        string  `json:"user"`
	Status      string  `json:"status"`
	CPUUsage    float64 `json:"cpu_usage"`
	MemoryRSS   uint64  `json:"memory_rss"`
	MemoryUsage float64 `json:"memory_usage"`
	CreatedAt   int64   `json:"created_at,omitempty"`
}

// DockerSnapshot is the latest bounded Docker Engine view sampled by an agent.
type DockerSnapshot struct {
	CollectedAt int64           `json:"collected_at"`
	Available   bool            `json:"available"`
	Version     string          `json:"version,omitempty"`
	Error       string          `json:"error,omitempty"`
	Containers  []ContainerInfo `json:"containers"`
}

type ContainerInfo struct {
	ID            string  `json:"id"`
	FullID        string  `json:"full_id,omitempty"`
	Name          string  `json:"name"`
	Image         string  `json:"image"`
	State         string  `json:"state"`
	Status        string  `json:"status"`
	CreatedAt     int64   `json:"created_at,omitempty"`
	StartedAt     int64   `json:"started_at,omitempty"`
	RestartCount  int     `json:"restart_count,omitempty"`
	CPUUsage      float64 `json:"cpu_usage,omitempty"`
	MemoryUsage   uint64  `json:"memory_usage,omitempty"`
	MemoryLimit   uint64  `json:"memory_limit,omitempty"`
	MemoryPercent float64 `json:"memory_percent,omitempty"`
	NetworkRX     uint64  `json:"network_rx,omitempty"`
	NetworkTX     uint64  `json:"network_tx,omitempty"`
}

type SystemInfo struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Kernel   string `json:"kernel"`
	Uptime   int64  `json:"uptime"`
}

type CPUInfo struct {
	Cores int     `json:"cores"`
	Usage float64 `json:"usage"`
}

type MemoryInfo struct {
	Total int64   `json:"total"`
	Used  int64   `json:"used"`
	Usage float64 `json:"usage"`
}

type DiskInfo struct {
	Total      int64   `json:"total"`
	Used       int64   `json:"used"`
	Usage      float64 `json:"usage"`
	ReadSpeed  int64   `json:"read_speed"`
	WriteSpeed int64   `json:"write_speed"`
}

type NetworkInfo struct {
	RXSpeed int64 `json:"rx_speed"`
	TXSpeed int64 `json:"tx_speed"`
	RXTotal int64 `json:"rx_total"`
	TXTotal int64 `json:"tx_total"`
}

type LoadInfo struct {
	Load1  float64 `json:"load1"`
	Load5  float64 `json:"load5"`
	Load15 float64 `json:"load15"`
}
