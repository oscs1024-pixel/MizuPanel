package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	_ "github.com/mattn/go-sqlite3"

	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
	"github.com/mizupanel/mizupanel/internal/server/store"
)

func testAlertRouter(t *testing.T) (*http.ServeMux, *store.AlertStore) {
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
	alerts := store.NewAlertStore(database)
	mux := NewRouter(nodes, metrics, alerts)
	return mux, alerts
}

func TestCreateAlertRule(t *testing.T) {
	router, _ := testAlertRouter(t)

	rule := map[string]interface{}{
		"name":             "CPU Usage High",
		"enabled":          true,
		"metric_field":     "cpu_usage",
		"operator":         ">",
		"threshold":        80.0,
		"duration_seconds": 300,
		"scope_type":       "all",
		"notification_channels": []map[string]interface{}{
			{"type": "webhook", "webhook_url": "http://example.com/webhook"},
		},
	}
	body, _ := json.Marshal(rule)
	req := httptest.NewRequest("POST", "/api/alerts/rules", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://"+req.Host)
	req.Header.Set("Origin", "http://"+req.Host)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", w.Code)
	}

	var response store.AlertRule
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.ID == 0 {
		t.Fatal("response.ID = 0, want non-zero")
	}
	if response.Name != "CPU Usage High" {
		t.Fatalf("response.Name = %q, want CPU Usage High", response.Name)
	}
	if !response.Enabled {
		t.Fatal("response.Enabled = false, want true")
	}
}

func TestListAlertRules(t *testing.T) {
	router, s := testAlertRouter(t)

	// Create test rules
	rule1 := &store.AlertRule{
		Name:            "Rule 1",
		Enabled:         true,
		MetricField:     "cpu_usage",
		Operator:        ">",
		Threshold:       80.0,
		DurationSeconds: 300,
		ScopeType:       "all",
		NotificationChannels: []store.NotificationChannel{
			{Type: "webhook", WebhookURL: "http://example.com/webhook"},
		},
	}
	if err := s.CreateAlertRule(rule1); err != nil {
		t.Fatalf("create rule1: %v", err)
	}

	rule2 := &store.AlertRule{
		Name:            "Rule 2",
		Enabled:         false,
		MetricField:     "memory_usage",
		Operator:        ">",
		Threshold:       90.0,
		DurationSeconds: 180,
		ScopeType:       "nodes",
		ScopeNodeIDs:    []string{"node-1", "node-2"},
		NotificationChannels: []store.NotificationChannel{
			{Type: "dingtalk", WebhookURL: "http://dingtalk.com/webhook", Secret: "secret"},
		},
	}
	if err := s.CreateAlertRule(rule2); err != nil {
		t.Fatalf("create rule2: %v", err)
	}

	req := httptest.NewRequest("GET", "/api/alerts/rules", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var response struct {
		Rules []store.AlertRule `json:"rules"`
	}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Rules) != 2 {
		t.Fatalf("len(rules) = %d, want 2", len(response.Rules))
	}
	if response.Rules[0].Name != "Rule 1" || response.Rules[1].Name != "Rule 2" {
		t.Fatalf("rules = %+v", response.Rules)
	}
}

func TestGetAlertRule(t *testing.T) {
	router, s := testAlertRouter(t)

	rule := &store.AlertRule{
		Name:            "Test Rule",
		Enabled:         true,
		MetricField:     "cpu_usage",
		Operator:        ">",
		Threshold:       80.0,
		DurationSeconds: 300,
		ScopeType:       "all",
		NotificationChannels: []store.NotificationChannel{
			{Type: "webhook", WebhookURL: "http://example.com/webhook"},
		},
	}
	if err := s.CreateAlertRule(rule); err != nil {
		t.Fatalf("create rule: %v", err)
	}

	req := httptest.NewRequest("GET", "/api/alerts/rules/1", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var response store.AlertRule
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.ID != rule.ID {
		t.Fatalf("response.ID = %d, want %d", response.ID, rule.ID)
	}
	if response.Name != "Test Rule" {
		t.Fatalf("response.Name = %q, want Test Rule", response.Name)
	}
}

func TestUpdateAlertRule(t *testing.T) {
	router, s := testAlertRouter(t)

	rule := &store.AlertRule{
		Name:            "Original Rule",
		Enabled:         true,
		MetricField:     "cpu_usage",
		Operator:        ">",
		Threshold:       80.0,
		DurationSeconds: 300,
		ScopeType:       "all",
		NotificationChannels: []store.NotificationChannel{
			{Type: "webhook", WebhookURL: "http://example.com/webhook"},
		},
	}
	if err := s.CreateAlertRule(rule); err != nil {
		t.Fatalf("create rule: %v", err)
	}

	update := map[string]interface{}{
		"name":             "Updated Rule",
		"enabled":          false,
		"metric_field":     "memory_usage",
		"operator":         ">=",
		"threshold":        90.0,
		"duration_seconds": 600,
		"scope_type":       "nodes",
		"scope_node_ids":   []string{"node-1"},
		"notification_channels": []map[string]interface{}{
			{"type": "dingtalk", "webhook_url": "http://dingtalk.com/webhook"},
		},
	}
	body, _ := json.Marshal(update)
	req := httptest.NewRequest("PUT", "/api/alerts/rules/1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://"+req.Host)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var response store.AlertRule
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Name != "Updated Rule" || response.Enabled || response.Threshold != 90.0 {
		t.Fatalf("response = %+v", response)
	}
}

func TestDeleteAlertRule(t *testing.T) {
	router, s := testAlertRouter(t)

	rule := &store.AlertRule{
		Name:            "Rule to Delete",
		Enabled:         true,
		MetricField:     "cpu_usage",
		Operator:        ">",
		Threshold:       80.0,
		DurationSeconds: 300,
		ScopeType:       "all",
		NotificationChannels: []store.NotificationChannel{
			{Type: "webhook", WebhookURL: "http://example.com/webhook"},
		},
	}
	if err := s.CreateAlertRule(rule); err != nil {
		t.Fatalf("create rule: %v", err)
	}

	req := httptest.NewRequest("DELETE", "/api/alerts/rules/1", nil)
	req.Header.Set("Origin", "http://"+req.Host)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}

	// Verify rule is deleted
	deletedRule, err := s.GetAlertRule(rule.ID)
	if err != nil {
		t.Fatalf("get deleted rule: %v", err)
	}
	if deletedRule != nil {
		t.Fatal("rule still exists after delete")
	}
}

func TestToggleAlertRule(t *testing.T) {
	router, s := testAlertRouter(t)

	rule := &store.AlertRule{
		Name:            "Toggle Rule",
		Enabled:         true,
		MetricField:     "cpu_usage",
		Operator:        ">",
		Threshold:       80.0,
		DurationSeconds: 300,
		ScopeType:       "all",
		NotificationChannels: []store.NotificationChannel{
			{Type: "webhook", WebhookURL: "http://example.com/webhook"},
		},
	}
	if err := s.CreateAlertRule(rule); err != nil {
		t.Fatalf("create rule: %v", err)
	}

	// Toggle to disabled
	toggle := map[string]interface{}{"enabled": false}
	body, _ := json.Marshal(toggle)
	req := httptest.NewRequest("PATCH", "/api/alerts/rules/1/toggle", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://"+req.Host)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var response store.AlertRule
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Enabled {
		t.Fatal("response.Enabled = true, want false after toggle")
	}
}

func TestCreateAlertRuleRejectsInvalidMetricField(t *testing.T) {
	router, _ := testAlertRouter(t)

	rule := map[string]interface{}{
		"name":             "Invalid Rule",
		"enabled":          true,
		"metric_field":     "invalid_field",
		"operator":         ">",
		"threshold":        80.0,
		"duration_seconds": 300,
		"scope_type":       "all",
		"notification_channels": []map[string]interface{}{
			{"type": "webhook", "webhook_url": "http://example.com/webhook"},
		},
	}
	body, _ := json.Marshal(rule)
	req := httptest.NewRequest("POST", "/api/alerts/rules", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://"+req.Host)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

func TestCreateAlertRuleRejectsInvalidOperator(t *testing.T) {
	router, _ := testAlertRouter(t)

	rule := map[string]interface{}{
		"name":             "Invalid Rule",
		"enabled":          true,
		"metric_field":     "cpu_usage",
		"operator":         "invalid",
		"threshold":        80.0,
		"duration_seconds": 300,
		"scope_type":       "all",
		"notification_channels": []map[string]interface{}{
			{"type": "webhook", "webhook_url": "http://example.com/webhook"},
		},
	}
	body, _ := json.Marshal(rule)
	req := httptest.NewRequest("POST", "/api/alerts/rules", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://"+req.Host)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}
