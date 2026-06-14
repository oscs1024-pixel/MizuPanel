package db

import (
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func TestMigrateSQLiteCreatesAlertTables(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	if err := Migrate(db); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	// Verify alert_rules table exists
	var tableName string
	err = db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='alert_rules'").Scan(&tableName)
	if err != nil {
		t.Fatalf("alert_rules table not found: %v", err)
	}
	if tableName != "alert_rules" {
		t.Fatalf("table name = %q, want alert_rules", tableName)
	}

	// Verify alert_history table exists
	err = db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='alert_history'").Scan(&tableName)
	if err != nil {
		t.Fatalf("alert_history table not found: %v", err)
	}
	if tableName != "alert_history" {
		t.Fatalf("table name = %q, want alert_history", tableName)
	}

	// Verify indexes exist
	var indexCount int
	err = db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name LIKE 'idx_alert_history_%'").Scan(&indexCount)
	if err != nil {
		t.Fatalf("query indexes: %v", err)
	}
	if indexCount != 3 {
		t.Fatalf("alert_history indexes count = %d, want 3", indexCount)
	}
}

func TestMigrateSQLiteAlertRulesSchema(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	if err := Migrate(db); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	// Insert a test rule
	_, err = db.Exec(`INSERT INTO alert_rules (name, enabled, metric_field, operator, threshold, duration_seconds, scope_type, notification_channels)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"Test Rule", 1, "cpu_usage", ">", 80.0, 300, "all", `[{"type":"webhook","url":"http://example.com"}]`)
	if err != nil {
		t.Fatalf("insert test rule: %v", err)
	}

	// Verify the rule was inserted
	var name string
	var enabled int
	var metricField, operator string
	var threshold float64
	err = db.QueryRow("SELECT name, enabled, metric_field, operator, threshold FROM alert_rules WHERE id = 1").
		Scan(&name, &enabled, &metricField, &operator, &threshold)
	if err != nil {
		t.Fatalf("query test rule: %v", err)
	}
	if name != "Test Rule" || enabled != 1 || metricField != "cpu_usage" || operator != ">" || threshold != 80.0 {
		t.Fatalf("rule data mismatch: name=%q enabled=%d metric=%q op=%q threshold=%f", name, enabled, metricField, operator, threshold)
	}
}

func TestMigrateSQLiteAlertHistorySchema(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	if err := Migrate(db); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	// Insert a test rule first
	_, err = db.Exec(`INSERT INTO alert_rules (name, enabled, metric_field, operator, threshold, duration_seconds, scope_type, notification_channels)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"Test Rule", 1, "cpu_usage", ">", 80.0, 300, "all", `[{"type":"webhook","url":"http://example.com"}]`)
	if err != nil {
		t.Fatalf("insert test rule: %v", err)
	}

	// Insert a test history record
	_, err = db.Exec(`INSERT INTO alert_history (rule_id, rule_name, node_id, node_name, metric_field, metric_value, threshold, triggered_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		1, "Test Rule", "node-1", "Test Node", "cpu_usage", 85.5, 80.0, "2026-06-14T10:00:00Z")
	if err != nil {
		t.Fatalf("insert test history: %v", err)
	}

	// Verify the history record was inserted
	var ruleName, nodeID string
	var metricValue, threshold float64
	err = db.QueryRow("SELECT rule_name, node_id, metric_value, threshold FROM alert_history WHERE id = 1").
		Scan(&ruleName, &nodeID, &metricValue, &threshold)
	if err != nil {
		t.Fatalf("query test history: %v", err)
	}
	if ruleName != "Test Rule" || nodeID != "node-1" || metricValue != 85.5 || threshold != 80.0 {
		t.Fatalf("history data mismatch: rule=%q node=%q value=%f threshold=%f", ruleName, nodeID, metricValue, threshold)
	}
}
