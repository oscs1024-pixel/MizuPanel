package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mizupanel/mizupanel/internal/protocol"

	_ "github.com/mattn/go-sqlite3"

	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
	"github.com/mizupanel/mizupanel/internal/server/store"
)

func testRouter(t *testing.T) (*http.ServeMux, *store.NodeStore, *store.MetricStore, *store.ProcessSnapshotStore, *store.DockerSnapshotStore) {
	t.Helper()
	database, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := serverdb.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	nodes := store.NewNodeStore(database)
	metrics := store.NewMetricStore(database)
	processes := store.NewProcessSnapshotStore(database)
	docker := store.NewDockerSnapshotStore(database)
	mux := NewRouter(nodes, metrics, processes, docker)
	return mux, nodes, metrics, processes, docker
}

func TestListNodesReturnsEmptyList(t *testing.T) {
	mux, _, _, _, _ := testRouter(t)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/nodes", nil)

	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	var response struct {
		Nodes []NodeResponse `json:"nodes"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Nodes) != 0 {
		t.Fatalf("len(nodes) = %d, want 0", len(response.Nodes))
	}
}

func TestListNodesIncludesLatestMetric(t *testing.T) {
	mux, nodes, metrics, _, _ := testRouter(t)
	now := time.Date(2026, 5, 23, 12, 0, 0, 0, time.UTC)
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	for _, metric := range []store.Metric{
		{NodeID: "node-1", CPUUsage: 10, MemoryUsage: 20, DiskUsage: 30, CreatedAt: now.Add(-time.Minute)},
		{NodeID: "node-1", CPUUsage: 40, MemoryUsage: 50, DiskUsage: 60, Uptime: 86400, DiskReadSpeed: 4096, DiskWriteSpeed: 8192, CreatedAt: now},
	} {
		if err := metrics.Insert(t.Context(), metric); err != nil {
			t.Fatalf("insert metric: %v", err)
		}
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/nodes", nil)
	mux.ServeHTTP(recorder, request)

	var response struct {
		Nodes []NodeResponse `json:"nodes"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Nodes) != 1 {
		t.Fatalf("len(nodes) = %d, want 1", len(response.Nodes))
	}
	if response.Nodes[0].LatestMetric == nil || response.Nodes[0].LatestMetric.CPUUsage != 40 || response.Nodes[0].LatestMetric.Uptime != 86400 || response.Nodes[0].LatestMetric.DiskReadSpeed != 4096 || response.Nodes[0].LatestMetric.DiskWriteSpeed != 8192 {
		t.Fatalf("latest metric = %#v", response.Nodes[0].LatestMetric)
	}
}

func TestDeleteNodeRemovesNodeFromAPI(t *testing.T) {
	_, nodes, metrics, _, _ := testRouter(t)
	ops := &fakeNodeOperations{}
	mux := NewRouter(nodes, metrics, ops)
	now := time.Date(2026, 5, 31, 10, 0, 0, 0, time.UTC)
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "offline", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	if err := metrics.Insert(t.Context(), store.Metric{NodeID: "node-1", CPUUsage: 33, CreatedAt: now}); err != nil {
		t.Fatalf("insert metric: %v", err)
	}

	deleteRecorder := httptest.NewRecorder()
	deleteRequest := httptest.NewRequest(http.MethodDelete, "/api/nodes/node-1", nil)
	deleteRequest.Host = "panel.example"
	deleteRequest.Header.Set("Origin", "http://panel.example")
	mux.ServeHTTP(deleteRecorder, deleteRequest)
	if deleteRecorder.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, body = %s", deleteRecorder.Code, deleteRecorder.Body.String())
	}
	if ops.disconnectedNodeID != "node-1" {
		t.Fatalf("disconnected node = %q, want node-1", ops.disconnectedNodeID)
	}

	getRecorder := httptest.NewRecorder()
	mux.ServeHTTP(getRecorder, httptest.NewRequest(http.MethodGet, "/api/nodes/node-1", nil))
	if getRecorder.Code != http.StatusNotFound {
		t.Fatalf("get deleted status = %d, want 404", getRecorder.Code)
	}

	listRecorder := httptest.NewRecorder()
	mux.ServeHTTP(listRecorder, httptest.NewRequest(http.MethodGet, "/api/nodes", nil))
	var response struct {
		Nodes []NodeResponse `json:"nodes"`
	}
	if err := json.Unmarshal(listRecorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(response.Nodes) != 0 {
		t.Fatalf("nodes = %#v, want empty", response.Nodes)
	}
}

func TestDeleteNodeRejectsUnknownNode(t *testing.T) {
	mux, _, _, _, _ := testRouter(t)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodDelete, "/api/nodes/missing", nil)
	request.Host = "panel.example"
	request.Header.Set("Origin", "http://panel.example")

	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", recorder.Code)
	}
}

func TestDeleteNodeRejectsCrossOrigin(t *testing.T) {
	mux, nodes, _, _, _ := testRouter(t)
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "offline", LastSeenAt: time.Now().UTC()}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodDelete, "/api/nodes/node-1", nil)
	request.Host = "panel.example"
	request.Header.Set("Origin", "http://evil.example")

	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", recorder.Code)
	}
}

func TestNodeRouteRejectsUnsupportedMethod(t *testing.T) {
	mux, nodes, _, _, _ := testRouter(t)
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "offline", LastSeenAt: time.Now().UTC()}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/api/nodes/node-1", nil)

	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", recorder.Code)
	}
}

func TestMetricsRangeRejectsInvalidRange(t *testing.T) {
	mux, nodes, _, _, _ := testRouter(t)
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: time.Now().UTC()}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/metrics?range=2h", nil)

	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
}

func TestMetricsRangeRejectsRangeBeyondRetention(t *testing.T) {
	_, nodes, metrics, _, _ := testRouter(t)
	settings := testSettingsStore(t)
	mux := NewRouter(nodes, metrics, SettingsConfig{Store: settings, DefaultMetricsRetention: 6 * time.Hour})
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: time.Now().UTC()}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/metrics?range=24h", nil)

	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
}

func TestMetricsRangeSupportsLongHistoryWhenRetentionAllows(t *testing.T) {
	_, nodes, metrics, _, _ := testRouter(t)
	settings := testSettingsStore(t)
	if err := settings.SetMetricsRetention(t.Context(), "7d"); err != nil {
		t.Fatalf("set retention: %v", err)
	}
	mux := NewRouter(nodes, metrics, SettingsConfig{Store: settings, DefaultMetricsRetention: 6 * time.Hour})
	now := time.Now().UTC()
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	if err := metrics.Insert(t.Context(), store.Metric{NodeID: "node-1", CPUUsage: 77, CreatedAt: now.Add(-23 * time.Hour)}); err != nil {
		t.Fatalf("insert metric: %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/metrics?range=24h", nil)
	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Metrics []MetricResponse `json:"metrics"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Metrics) != 1 || response.Metrics[0].CPUUsage != 77 {
		t.Fatalf("metrics = %#v", response.Metrics)
	}
}

func TestMetricsRangeRejectsMissingNode(t *testing.T) {
	mux, _, _, _, _ := testRouter(t)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/nodes/missing/metrics?range=1h", nil)

	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", recorder.Code)
	}
}

func TestMetricsRangeReturnsRows(t *testing.T) {
	mux, nodes, metrics, _, _ := testRouter(t)
	now := time.Now().UTC()
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	if err := metrics.Insert(t.Context(), store.Metric{NodeID: "node-1", CPUUsage: 33, Uptime: 86400, DiskReadSpeed: 4096, DiskWriteSpeed: 8192, CreatedAt: now.Add(-30 * time.Minute)}); err != nil {
		t.Fatalf("insert metric: %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/metrics?range=1h", nil)
	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	var response struct {
		Metrics []MetricResponse `json:"metrics"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Metrics) != 1 || response.Metrics[0].CPUUsage != 33 {
		t.Fatalf("metrics = %#v", response.Metrics)
	}
}

func TestNodeProcessesReturnsSnapshotAndEmptyState(t *testing.T) {
	mux, nodes, _, processes, _ := testRouter(t)
	now := time.Now().UTC()
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	if err := processes.Upsert(t.Context(), "node-1", protocol.ProcessSnapshot{
		CollectedAt: 1710000000,
		Error:       "partial permission denied",
		Processes:   []protocol.ProcessInfo{{PID: 42, Name: "nginx", Command: "nginx -g daemon off", User: "www-data", Status: "sleeping", CPUUsage: 12.5, MemoryRSS: 2048, MemoryUsage: 3.4}},
	}); err != nil {
		t.Fatalf("upsert process snapshot: %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/processes", nil)
	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response ProcessSnapshotResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.NodeID != "node-1" || response.CollectedAt != 1710000000 || response.Error != "partial permission denied" || len(response.Processes) != 1 {
		t.Fatalf("response = %#v", response)
	}
	if response.Processes[0].PID != 42 || response.Processes[0].Name != "nginx" || response.Processes[0].Command != "" {
		t.Fatalf("processes = %#v", response.Processes)
	}

	emptyRecorder := httptest.NewRecorder()
	emptyRequest := httptest.NewRequest(http.MethodGet, "/api/nodes/node-2/processes", nil)
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-2", Name: "Empty", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert empty node: %v", err)
	}
	mux.ServeHTTP(emptyRecorder, emptyRequest)
	if emptyRecorder.Code != http.StatusOK {
		t.Fatalf("empty status = %d", emptyRecorder.Code)
	}
	if body := emptyRecorder.Body.String(); !strings.Contains(body, `"collected_at":0`) || !strings.Contains(body, `"processes":[]`) {
		t.Fatalf("empty response body = %s", body)
	}
}

type fakeTerminalHub struct {
	enabled bool
}

func (h fakeTerminalHub) NodeTerminalEnabled(string) bool {
	return h.enabled
}

func (h fakeTerminalHub) AttachTerminal(context.Context, string, *websocket.Conn) error {
	return nil
}

func (h fakeTerminalHub) AttachContainerExec(context.Context, string, string, *websocket.Conn) error {
	return nil
}

type fakeNodeOperations struct {
	fileListPath       string
	fileReadPath       string
	fileWritePath      string
	fileContent        string
	fileUploadPath     string
	fileUploadBase64   string
	fileDeletePath     string
	rebootNodeID       string
	disconnectedNodeID string
}

func (f *fakeNodeOperations) NodeTerminalEnabled(string) bool { return true }
func (f *fakeNodeOperations) AttachTerminal(context.Context, string, *websocket.Conn) error {
	return nil
}
func (f *fakeNodeOperations) AttachContainerExec(context.Context, string, string, *websocket.Conn) error {
	return nil
}

func (f *fakeNodeOperations) DisconnectNode(nodeID string) {
	f.disconnectedNodeID = nodeID
}

func (f *fakeNodeOperations) FileList(ctx context.Context, nodeID string, path string) (protocol.FileListResponse, error) {
	f.fileListPath = path
	return protocol.FileListResponse{Type: protocol.MessageTypeFileListResponse, Path: path, Entries: []protocol.FileEntry{{Name: "app", Path: path + "/app", Type: "directory"}}}, nil
}

func (f *fakeNodeOperations) FileRead(ctx context.Context, nodeID string, path string) (protocol.FileReadResponse, error) {
	f.fileReadPath = path
	return protocol.FileReadResponse{Type: protocol.MessageTypeFileReadResponse, Path: path, Content: "key=value\n", Editable: true}, nil
}

func (f *fakeNodeOperations) FileWrite(ctx context.Context, nodeID string, path string, content string) (protocol.FileWriteResponse, error) {
	f.fileWritePath = path
	f.fileContent = content
	return protocol.FileWriteResponse{Type: protocol.MessageTypeFileWriteResponse, Path: path, Saved: true}, nil
}

func (f *fakeNodeOperations) FileUpload(ctx context.Context, nodeID string, path string, contentBase64 string) (protocol.FileUploadResponse, error) {
	f.fileUploadPath = path
	f.fileUploadBase64 = contentBase64
	return protocol.FileUploadResponse{Type: protocol.MessageTypeFileUploadResponse, Path: path, Uploaded: true}, nil
}

func (f *fakeNodeOperations) FileDelete(ctx context.Context, nodeID string, path string) (protocol.FileDeleteResponse, error) {
	f.fileDeletePath = path
	return protocol.FileDeleteResponse{Type: protocol.MessageTypeFileDeleteResponse, Path: path, Deleted: true}, nil
}

func (f *fakeNodeOperations) Reboot(ctx context.Context, nodeID string) (protocol.RebootResponse, error) {
	f.rebootNodeID = nodeID
	return protocol.RebootResponse{Type: protocol.MessageTypeRebootResponse, Accepted: true}, nil
}

func TestNodeFileOperationsForwardToAgentWithoutBrowserAuth(t *testing.T) {
	_, nodes, metrics, _, _ := testRouter(t)
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: time.Now().UTC()}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	ops := &fakeNodeOperations{}
	mux := NewRouter(nodes, metrics, ops)

	listRecorder := httptest.NewRecorder()
	mux.ServeHTTP(listRecorder, httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/files?path=/etc", nil))
	if listRecorder.Code != http.StatusOK || ops.fileListPath != "/etc" {
		t.Fatalf("list status/path = %d/%q body=%s", listRecorder.Code, ops.fileListPath, listRecorder.Body.String())
	}

	readRecorder := httptest.NewRecorder()
	mux.ServeHTTP(readRecorder, httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/files/content?path=/etc/app.conf", nil))
	if readRecorder.Code != http.StatusOK || ops.fileReadPath != "/etc/app.conf" {
		t.Fatalf("read status/path = %d/%q body=%s", readRecorder.Code, ops.fileReadPath, readRecorder.Body.String())
	}

	writeRecorder := httptest.NewRecorder()
	body := bytes.NewBufferString(`{"path":"/etc/app.conf","content":"port=8080\n"}`)
	writeRequest := httptest.NewRequest(http.MethodPut, "/api/nodes/node-1/files/content", body)
	writeRequest.Header.Set("Origin", "http://example.com")
	writeRequest.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(writeRecorder, writeRequest)
	if writeRecorder.Code != http.StatusOK || ops.fileWritePath != "/etc/app.conf" || ops.fileContent != "port=8080\n" {
		t.Fatalf("write status/path/content = %d/%q/%q body=%s", writeRecorder.Code, ops.fileWritePath, ops.fileContent, writeRecorder.Body.String())
	}

	uploadRecorder := httptest.NewRecorder()
	uploadBody := bytes.NewBufferString(`{"path":"/etc/upload.bin","content_base64":"AAEC"}`)
	uploadRequest := httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/files/upload", uploadBody)
	uploadRequest.Header.Set("Origin", "http://example.com")
	uploadRequest.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(uploadRecorder, uploadRequest)
	if uploadRecorder.Code != http.StatusOK || ops.fileUploadPath != "/etc/upload.bin" || ops.fileUploadBase64 != "AAEC" {
		t.Fatalf("upload status/path/content = %d/%q/%q body=%s", uploadRecorder.Code, ops.fileUploadPath, ops.fileUploadBase64, uploadRecorder.Body.String())
	}

	deleteRecorder := httptest.NewRecorder()
	deleteBody := bytes.NewBufferString(`{"path":"/etc/upload.bin"}`)
	deleteRequest := httptest.NewRequest(http.MethodDelete, "/api/nodes/node-1/files/content", deleteBody)
	deleteRequest.Header.Set("Origin", "http://example.com")
	deleteRequest.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(deleteRecorder, deleteRequest)
	if deleteRecorder.Code != http.StatusOK || ops.fileDeletePath != "/etc/upload.bin" {
		t.Fatalf("delete status/path = %d/%q body=%s", deleteRecorder.Code, ops.fileDeletePath, deleteRecorder.Body.String())
	}

	rebootRecorder := httptest.NewRecorder()
	rebootRequest := httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/reboot", nil)
	rebootRequest.Header.Set("Origin", "http://example.com")
	mux.ServeHTTP(rebootRecorder, rebootRequest)
	if rebootRecorder.Code != http.StatusOK || ops.rebootNodeID != "node-1" {
		t.Fatalf("reboot status/node = %d/%q body=%s", rebootRecorder.Code, ops.rebootNodeID, rebootRecorder.Body.String())
	}
}

func TestStateChangingNodeFileOperationsRequireSameOrigin(t *testing.T) {
	_, nodes, metrics, _, _ := testRouter(t)
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: time.Now().UTC()}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	mux := NewRouter(nodes, metrics, &fakeNodeOperations{})

	for _, tc := range []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPut, "/api/nodes/node-1/files/content", `{"path":"/etc/app.conf","content":"x"}`},
		{http.MethodPost, "/api/nodes/node-1/files/upload", `{"path":"/etc/upload.bin","content_base64":"AAEC"}`},
		{http.MethodDelete, "/api/nodes/node-1/files/content", `{"path":"/etc/upload.bin"}`},
		{http.MethodPost, "/api/nodes/node-1/reboot", ``},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		request.Header.Set("Origin", "http://evil.example")
		request.Header.Set("Content-Type", "application/json")
		mux.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusForbidden {
			t.Fatalf("%s %s status = %d, want 403; body=%s", tc.method, tc.path, recorder.Code, recorder.Body.String())
		}
	}
}

func TestTerminalSessionRequiresServerAndNodeOptIn(t *testing.T) {
	_, nodes, metrics, _, _ := testRouter(t)
	now := time.Now().UTC()
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}

	disabledMux := NewRouter(nodes, metrics, fakeTerminalHub{enabled: true})
	disabledRecorder := httptest.NewRecorder()
	disabledRequest := httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/terminal/session", nil)
	disabledRequest.Host = "panel.example"
	disabledRequest.Header.Set("Origin", "http://panel.example")
	disabledMux.ServeHTTP(disabledRecorder, disabledRequest)
	if disabledRecorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled status = %d, want 503", disabledRecorder.Code)
	}

	nodeDisabledMux := NewRouter(nodes, metrics, fakeTerminalHub{enabled: false}, TerminalConfig{Enabled: true})
	nodeDisabledRecorder := httptest.NewRecorder()
	nodeDisabledRequest := httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/terminal/session", nil)
	nodeDisabledRequest.Host = "panel.example"
	nodeDisabledRequest.Header.Set("Origin", "http://panel.example")
	nodeDisabledMux.ServeHTTP(nodeDisabledRecorder, nodeDisabledRequest)
	if nodeDisabledRecorder.Code != http.StatusForbidden {
		t.Fatalf("node disabled status = %d, want 403", nodeDisabledRecorder.Code)
	}

	enabledMux := NewRouter(nodes, metrics, fakeTerminalHub{enabled: true}, TerminalConfig{Enabled: true})
	enabledRecorder := httptest.NewRecorder()
	enabledRequest := httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/terminal/session", nil)
	enabledRequest.Host = "panel.example"
	enabledRequest.Header.Set("Origin", "http://panel.example")
	enabledMux.ServeHTTP(enabledRecorder, enabledRequest)
	if enabledRecorder.Code != http.StatusOK {
		t.Fatalf("enabled status = %d, body = %s", enabledRecorder.Code, enabledRecorder.Body.String())
	}
	var response struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(enabledRecorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode terminal session response: %v", err)
	}
	if response.Token == "" {
		t.Fatal("terminal session token is empty")
	}
}

func TestTerminalTokenIsSingleUse(t *testing.T) {
	server := &Server{terminalTokens: make(map[string]terminalToken)}
	token, err := server.createTerminalToken(terminalTokenKindNode, "node-1", "")
	if err != nil {
		t.Fatalf("create terminal token: %v", err)
	}
	if !server.consumeTerminalToken(terminalTokenKindNode, "node-1", "", token) {
		t.Fatal("token was not accepted")
	}
	if server.consumeTerminalToken(terminalTokenKindNode, "node-1", "", token) {
		t.Fatal("token was accepted twice")
	}
}

func TestContainerExecTokenIsBoundToNodeAndContainer(t *testing.T) {
	server := &Server{terminalTokens: make(map[string]terminalToken)}
	token, err := server.createTerminalToken(terminalTokenKindContainerExec, "node-1", "container-1")
	if err != nil {
		t.Fatalf("create exec token: %v", err)
	}
	if server.consumeTerminalToken(terminalTokenKindContainerExec, "node-1", "container-2", token) {
		t.Fatal("token was accepted for a different container")
	}
	if server.consumeTerminalToken(terminalTokenKindContainerExec, "node-1", "container-1", token) {
		t.Fatal("token was accepted after failed consume removed it")
	}

	token, err = server.createTerminalToken(terminalTokenKindContainerExec, "node-1", "container-1")
	if err != nil {
		t.Fatalf("create exec token: %v", err)
	}
	if !server.consumeTerminalToken(terminalTokenKindContainerExec, "node-1", "container-1", token) {
		t.Fatal("token was not accepted for the bound container")
	}
}

func TestContainerExecSessionRequiresServerNodeAndOrigin(t *testing.T) {
	_, nodes, metrics, _, _ := testRouter(t)
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: time.Now().UTC()}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}

	disabledMux := NewRouter(nodes, metrics, fakeTerminalHub{enabled: true})
	disabledRecorder := httptest.NewRecorder()
	disabledRequest := httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/containers/container-1/exec/session", nil)
	disabledRequest.Host = "panel.example"
	disabledRequest.Header.Set("Origin", "http://panel.example")
	disabledMux.ServeHTTP(disabledRecorder, disabledRequest)
	if disabledRecorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled status = %d, want 503", disabledRecorder.Code)
	}

	nodeDisabledMux := NewRouter(nodes, metrics, fakeTerminalHub{enabled: false}, TerminalConfig{Enabled: true})
	nodeDisabledRecorder := httptest.NewRecorder()
	nodeDisabledRequest := httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/containers/container-1/exec/session", nil)
	nodeDisabledRequest.Host = "panel.example"
	nodeDisabledRequest.Header.Set("Origin", "http://panel.example")
	nodeDisabledMux.ServeHTTP(nodeDisabledRecorder, nodeDisabledRequest)
	if nodeDisabledRecorder.Code != http.StatusForbidden {
		t.Fatalf("node disabled status = %d, want 403", nodeDisabledRecorder.Code)
	}

	enabledMux := NewRouter(nodes, metrics, fakeTerminalHub{enabled: true}, TerminalConfig{Enabled: true})
	enabledRecorder := httptest.NewRecorder()
	enabledRequest := httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/containers/container-1/exec/session", nil)
	enabledRequest.Host = "panel.example"
	enabledRequest.Header.Set("Origin", "http://panel.example")
	enabledMux.ServeHTTP(enabledRecorder, enabledRequest)
	if enabledRecorder.Code != http.StatusOK {
		t.Fatalf("enabled status = %d, body = %s", enabledRecorder.Code, enabledRecorder.Body.String())
	}
	var response struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(enabledRecorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode exec session response: %v", err)
	}
	if response.Token == "" {
		t.Fatal("exec session token is empty")
	}

	crossOriginRecorder := httptest.NewRecorder()
	crossOriginRequest := httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/containers/container-1/exec/session", nil)
	crossOriginRequest.Host = "panel.example"
	crossOriginRequest.Header.Set("Origin", "https://evil.example")
	enabledMux.ServeHTTP(crossOriginRecorder, crossOriginRequest)
	if crossOriginRecorder.Code != http.StatusForbidden {
		t.Fatalf("cross-origin status = %d, want 403", crossOriginRecorder.Code)
	}
}

func TestTerminalSessionRejectsCrossOrigin(t *testing.T) {
	_, nodes, metrics, _, _ := testRouter(t)
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: time.Now().UTC()}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	mux := NewRouter(nodes, metrics, fakeTerminalHub{enabled: true}, TerminalConfig{Enabled: true})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/terminal/session", nil)
	request.Host = "panel.example"
	request.Header.Set("Origin", "https://evil.example")
	mux.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", recorder.Code)
	}
}

func TestNodeDockerReturnsSnapshotUnavailableAnd404(t *testing.T) {
	mux, nodes, _, _, docker := testRouter(t)
	now := time.Now().UTC()
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-1", Name: "Oracle", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node: %v", err)
	}
	if err := nodes.Upsert(t.Context(), store.Node{ID: "node-2", Name: "No Docker", Status: "online", LastSeenAt: now}); err != nil {
		t.Fatalf("upsert node 2: %v", err)
	}
	if err := docker.Upsert(t.Context(), "node-1", protocol.DockerSnapshot{
		CollectedAt: 1710000100,
		Available:   true,
		Version:     "24.0.0",
		Containers:  []protocol.ContainerInfo{{ID: "abcdef123456", Name: "web", Image: "nginx:latest", State: "running", Status: "Up 1 minute", CPUUsage: 3.2, MemoryUsage: 1048576}},
	}); err != nil {
		t.Fatalf("upsert docker snapshot: %v", err)
	}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/docker", nil)
	mux.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response DockerSnapshotResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.NodeID != "node-1" || !response.Available || response.Version != "24.0.0" || len(response.Containers) != 1 {
		t.Fatalf("response = %#v", response)
	}

	emptyRecorder := httptest.NewRecorder()
	emptyRequest := httptest.NewRequest(http.MethodGet, "/api/nodes/node-2/docker", nil)
	mux.ServeHTTP(emptyRecorder, emptyRequest)
	if emptyRecorder.Code != http.StatusOK {
		t.Fatalf("empty status = %d", emptyRecorder.Code)
	}
	if body := emptyRecorder.Body.String(); !strings.Contains(body, `"available":false`) || !strings.Contains(body, `"containers":[]`) {
		t.Fatalf("empty docker response body = %s", body)
	}

	missingRecorder := httptest.NewRecorder()
	missingRequest := httptest.NewRequest(http.MethodGet, "/api/nodes/missing/docker", nil)
	mux.ServeHTTP(missingRecorder, missingRequest)
	if missingRecorder.Code != http.StatusNotFound {
		t.Fatalf("missing status = %d, want 404", missingRecorder.Code)
	}
}
