package alerting

import (
	"context"
	"database/sql"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"

	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
	"github.com/mizupanel/mizupanel/internal/server/store"
)

func testEngine(t *testing.T) (*Engine, *store.AlertStore, *store.MetricStore, *store.NodeStore) {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	if err := serverdb.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	alerts := store.NewAlertStore(db)
	metrics := store.NewMetricStore(db)
	nodes := store.NewNodeStore(db)
	engine := NewEngine(alerts, metrics, nodes)
	return engine, alerts, metrics, nodes
}

func TestEvaluateRuleThresholdGreaterThan(t *testing.T) {
	engine, alerts, _, _ := testEngine(t)

	rule := &store.AlertRule{
		ID:              1,
		Name:            "CPU High",
		Enabled:         true,
		MetricField:     "cpu_usage",
		Operator:        ">",
		Threshold:       80.0,
		DurationSeconds: 0, // instant trigger
		ScopeType:       "all",
	}
	if err := alerts.CreateAlertRule(rule); err != nil {
		t.Fatalf("create rule: %v", err)
	}

	metric := &store.Metric{
		NodeID:    "node-1",
		CPUUsage:  85.0,
		CreatedAt: time.Now().UTC(),
	}

	triggered := engine.evaluateRule(rule, metric)
	if !triggered {
		t.Fatal("expected rule to trigger with cpu_usage=85.0 > 80.0")
	}
}

func TestEvaluateRuleThresholdNotMet(t *testing.T) {
	engine, alerts, _, _ := testEngine(t)

	rule := &store.AlertRule{
		ID:              1,
		Name:            "CPU High",
		Enabled:         true,
		MetricField:     "cpu_usage",
		Operator:        ">",
		Threshold:       80.0,
		DurationSeconds: 0,
		ScopeType:       "all",
	}
	if err := alerts.CreateAlertRule(rule); err != nil {
		t.Fatalf("create rule: %v", err)
	}

	metric := &store.Metric{
		NodeID:    "node-1",
		CPUUsage:  75.0,
		CreatedAt: time.Now().UTC(),
	}

	triggered := engine.evaluateRule(rule, metric)
	if triggered {
		t.Fatal("expected rule not to trigger with cpu_usage=75.0 <= 80.0")
	}
}

func TestEvaluateRuleOperatorLessThan(t *testing.T) {
	engine, alerts, _, _ := testEngine(t)

	rule := &store.AlertRule{
		ID:              1,
		Name:            "Disk Low",
		Enabled:         true,
		MetricField:     "disk_usage",
		Operator:        "<",
		Threshold:       20.0,
		DurationSeconds: 0,
		ScopeType:       "all",
	}
	if err := alerts.CreateAlertRule(rule); err != nil {
		t.Fatalf("create rule: %v", err)
	}

	metric := &store.Metric{
		NodeID:    "node-1",
		DiskUsage: 15.0,
		CreatedAt: time.Now().UTC(),
	}

	triggered := engine.evaluateRule(rule, metric)
	if !triggered {
		t.Fatal("expected rule to trigger with disk_usage=15.0 < 20.0")
	}
}

func TestEvaluateRuleWithDuration(t *testing.T) {
	engine, alerts, _, _ := testEngine(t)

	rule := &store.AlertRule{
		ID:              1,
		Name:            "CPU High",
		Enabled:         true,
		MetricField:     "cpu_usage",
		Operator:        ">",
		Threshold:       80.0,
		DurationSeconds: 60, // require 60 seconds above threshold
		ScopeType:       "all",
	}
	if err := alerts.CreateAlertRule(rule); err != nil {
		t.Fatalf("create rule: %v", err)
	}

	now := time.Now().UTC()
	metric := &store.Metric{
		NodeID:    "node-1",
		CPUUsage:  85.0,
		CreatedAt: now,
	}

	// First evaluation - should not trigger yet
	triggered := engine.evaluateRule(rule, metric)
	if triggered {
		t.Fatal("expected rule not to trigger on first evaluation (duration not met)")
	}

	// Check state was recorded
	state := engine.getAlertState(rule.ID, "node-1")
	if state == nil || !state.ConditionMet || state.FirstMetAt.IsZero() {
		t.Fatal("expected alert state to be recorded")
	}

	// Simulate time passing (61 seconds later)
	state.FirstMetAt = now.Add(-61 * time.Second)

	// Second evaluation after duration elapsed - should trigger
	triggered = engine.evaluateRule(rule, metric)
	if !triggered {
		t.Fatal("expected rule to trigger after duration elapsed")
	}
}

func TestEvaluateRuleScopeNodeIDs(t *testing.T) {
	engine, alerts, _, _ := testEngine(t)

	rule := &store.AlertRule{
		ID:              1,
		Name:            "CPU High",
		Enabled:         true,
		MetricField:     "cpu_usage",
		Operator:        ">",
		Threshold:       80.0,
		DurationSeconds: 0,
		ScopeType:       "nodes",
		ScopeNodeIDs:    []string{"node-1", "node-2"},
	}
	if err := alerts.CreateAlertRule(rule); err != nil {
		t.Fatalf("create rule: %v", err)
	}

	// node-1 is in scope - should trigger
	metric1 := &store.Metric{
		NodeID:    "node-1",
		CPUUsage:  85.0,
		CreatedAt: time.Now().UTC(),
	}
	if !engine.evaluateRule(rule, metric1) {
		t.Fatal("expected rule to trigger for node-1 (in scope)")
	}

	// node-3 is NOT in scope - should not trigger even if threshold met
	metric3 := &store.Metric{
		NodeID:    "node-3",
		CPUUsage:  85.0,
		CreatedAt: time.Now().UTC(),
	}
	if engine.evaluateRule(rule, metric3) {
		t.Fatal("expected rule not to trigger for node-3 (out of scope)")
	}
}

func TestCheckRulesIntegration(t *testing.T) {
	engine, alerts, metrics, nodes := testEngine(t)

	// Create a node
	node := store.Node{
		ID:       "node-1",
		Name:     "Test Node",
		OS:       "linux",
		Hostname: "test-host",
	}
	if err := nodes.Upsert(context.Background(), node); err != nil {
		t.Fatalf("upsert node: %v", err)
	}

	// Create a rule
	rule := &store.AlertRule{
		Name:            "Memory High",
		Enabled:         true,
		MetricField:     "memory_usage",
		Operator:        ">=",
		Threshold:       90.0,
		DurationSeconds: 0,
		ScopeType:       "all",
		NotificationChannels: []store.NotificationChannel{
			{Type: "webhook", WebhookURL: "http://example.com/webhook"},
		},
	}
	if err := alerts.CreateAlertRule(rule); err != nil {
		t.Fatalf("create rule: %v", err)
	}

	// Insert a metric that triggers the rule
	metric := store.Metric{
		NodeID:      "node-1",
		MemoryUsage: 95.0,
		CPUUsage:    50.0,
		DiskUsage:   60.0,
		CreatedAt:   time.Now().UTC(),
	}
	if err := metrics.Insert(context.Background(), metric); err != nil {
		t.Fatalf("insert metric: %v", err)
	}

	// Run check
	ctx := context.Background()
	if err := engine.CheckRules(ctx); err != nil {
		t.Fatalf("check rules: %v", err)
	}

	// Verify alert state was created
	state := engine.getAlertState(rule.ID, "node-1")
	if state == nil || !state.ConditionMet {
		t.Fatal("expected alert state to be created and condition met")
	}
}

func TestCheckRulesResolvesTriggeredAlertWhenMetricRecovers(t *testing.T) {
	engine, alerts, metrics, nodes := testEngine(t)
	ctx := context.Background()

	node := store.Node{
		ID:       "node-1",
		Name:     "Test Node",
		OS:       "linux",
		Hostname: "test-host",
	}
	if err := nodes.Upsert(ctx, node); err != nil {
		t.Fatalf("upsert node: %v", err)
	}

	rule := &store.AlertRule{
		Name:            "CPU High",
		Enabled:         true,
		MetricField:     "cpu_usage",
		Operator:        ">",
		Threshold:       80.0,
		DurationSeconds: 0,
		ScopeType:       "all",
	}
	if err := alerts.CreateAlertRule(rule); err != nil {
		t.Fatalf("create rule: %v", err)
	}

	now := time.Now().UTC()
	if err := metrics.Insert(ctx, store.Metric{NodeID: "node-1", CPUUsage: 95.0, CreatedAt: now}); err != nil {
		t.Fatalf("insert triggering metric: %v", err)
	}
	if err := engine.CheckRules(ctx); err != nil {
		t.Fatalf("check triggering rules: %v", err)
	}

	active, err := alerts.GetActiveAlertHistory()
	if err != nil {
		t.Fatalf("get active alerts: %v", err)
	}
	if len(active) != 1 {
		t.Fatalf("active alerts = %d, want 1", len(active))
	}

	if err := metrics.Insert(ctx, store.Metric{NodeID: "node-1", CPUUsage: 30.0, CreatedAt: now.Add(time.Minute)}); err != nil {
		t.Fatalf("insert recovery metric: %v", err)
	}
	if err := engine.CheckRules(ctx); err != nil {
		t.Fatalf("check recovered rules: %v", err)
	}

	active, err = alerts.GetActiveAlertHistory()
	if err != nil {
		t.Fatalf("get active alerts after recovery: %v", err)
	}
	if len(active) != 0 {
		t.Fatalf("active alerts after recovery = %d, want 0", len(active))
	}

	history, err := alerts.GetAlertHistory("node-1", 10)
	if err != nil {
		t.Fatalf("get alert history: %v", err)
	}
	if len(history) != 1 || history[0].ResolvedAt == nil {
		t.Fatalf("history = %+v, want one resolved alert", history)
	}
}

func TestCheckRulesClearsExternallyResolvedStateBeforeRetriggering(t *testing.T) {
	engine, alerts, metrics, nodes := testEngine(t)
	ctx := context.Background()

	node := store.Node{
		ID:       "node-1",
		Name:     "Test Node",
		OS:       "linux",
		Hostname: "test-host",
	}
	if err := nodes.Upsert(ctx, node); err != nil {
		t.Fatalf("upsert node: %v", err)
	}

	rule := &store.AlertRule{
		Name:            "CPU High",
		Enabled:         true,
		MetricField:     "cpu_usage",
		Operator:        ">",
		Threshold:       80.0,
		DurationSeconds: 0,
		ScopeType:       "all",
	}
	if err := alerts.CreateAlertRule(rule); err != nil {
		t.Fatalf("create rule: %v", err)
	}

	now := time.Now().UTC()
	if err := metrics.Insert(ctx, store.Metric{NodeID: "node-1", CPUUsage: 95.0, CreatedAt: now}); err != nil {
		t.Fatalf("insert first metric: %v", err)
	}
	if err := engine.CheckRules(ctx); err != nil {
		t.Fatalf("check first rules: %v", err)
	}

	active, err := alerts.GetActiveAlertHistory()
	if err != nil {
		t.Fatalf("get active alerts: %v", err)
	}
	if len(active) != 1 {
		t.Fatalf("active alerts = %d, want 1", len(active))
	}
	firstHistoryID := active[0].ID
	if err := alerts.UpdateAlertHistoryResolved(firstHistoryID, now.Add(30*time.Second)); err != nil {
		t.Fatalf("externally resolve alert: %v", err)
	}

	if err := metrics.Insert(ctx, store.Metric{NodeID: "node-1", CPUUsage: 96.0, CreatedAt: now.Add(time.Minute)}); err != nil {
		t.Fatalf("insert second metric: %v", err)
	}
	if err := engine.CheckRules(ctx); err != nil {
		t.Fatalf("check second rules: %v", err)
	}

	active, err = alerts.GetActiveAlertHistory()
	if err != nil {
		t.Fatalf("get retriggered active alerts: %v", err)
	}
	if len(active) != 1 {
		t.Fatalf("active alerts after retrigger = %d, want 1", len(active))
	}
	if active[0].ID == firstHistoryID {
		t.Fatalf("retriggered alert reused resolved history id %d", firstHistoryID)
	}
}
