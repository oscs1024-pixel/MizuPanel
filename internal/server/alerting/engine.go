package alerting

import (
	"context"
	"fmt"
	"reflect"
	"sync"
	"time"

	"github.com/mizupanel/mizupanel/internal/server/store"
)

// AlertState tracks the state of an alert for a specific rule and node
type AlertState struct {
	RuleID        int64
	NodeID        string
	ConditionMet  bool
	Triggered     bool  // Whether notification has been sent
	HistoryID     int64 // Alert history record ID
	FirstMetAt    time.Time
	LastChecked   time.Time
}

// Engine manages alert rule evaluation and notification
type Engine struct {
	alerts   *store.AlertStore
	metrics  *store.MetricStore
	nodes    *store.NodeStore
	notifier *Notifier
	states   map[string]*AlertState // key: "ruleID:nodeID"
	mu       sync.RWMutex
}

// NewEngine creates a new alerting engine
func NewEngine(alerts *store.AlertStore, metrics *store.MetricStore, nodes *store.NodeStore) *Engine {
	return &Engine{
		alerts:   alerts,
		metrics:  metrics,
		nodes:    nodes,
		notifier: NewNotifier(),
		states:   make(map[string]*AlertState),
	}
}

// CheckRules evaluates all enabled alert rules against latest metrics
func (e *Engine) CheckRules(ctx context.Context) error {
	rules, err := e.alerts.GetEnabledAlertRules()
	if err != nil {
		return fmt.Errorf("get enabled rules: %w", err)
	}

	nodes, err := e.nodes.List(ctx)
	if err != nil {
		return fmt.Errorf("list nodes: %w", err)
	}

	for _, rule := range rules {
		for _, node := range nodes {
			// Check if node is in scope
			if !e.nodeInScope(&rule, node.ID) {
				continue
			}

			// Get latest metric for this node
			metric, ok, err := e.metrics.Latest(ctx, node.ID)
			if err != nil {
				return fmt.Errorf("get latest metric for node %s: %w", node.ID, err)
			}
			if !ok {
				continue // No metrics yet for this node
			}

			// Evaluate rule
			triggered := e.evaluateRule(&rule, &metric)
			if triggered {
				// Send notification and create alert history
				e.handleAlert(ctx, &rule, &node, &metric)
			} else {
				// Check if alert was previously triggered and should be resolved
				e.checkResolution(ctx, &rule, node.ID)
			}
		}
	}

	return nil
}

// handleAlert sends notification and creates alert history when rule triggers
func (e *Engine) handleAlert(ctx context.Context, rule *store.AlertRule, node *store.Node, metric *store.Metric) {
	stateKey := fmt.Sprintf("%d:%s", rule.ID, metric.NodeID)
	e.mu.Lock()
	state := e.states[stateKey]
	e.mu.Unlock()

	// Only send notification once
	if state != nil && state.Triggered {
		return
	}

	// Extract metric value
	metricValue := e.getMetricValue(metric, rule.MetricField)
	floatValue := 0.0
	if metricValue != nil {
		if v, ok := metricValue.(float64); ok {
			floatValue = v
		} else if v, ok := metricValue.(int64); ok {
			floatValue = float64(v)
		}
	}

	// Create alert history
	history := &store.AlertHistory{
		RuleID:           rule.ID,
		RuleName:         rule.Name,
		NodeID:           node.ID,
		NodeName:         node.Name,
		MetricField:      rule.MetricField,
		MetricValue:      floatValue,
		Threshold:        rule.Threshold,
		TriggeredAt:      time.Now().UTC(),
		NotificationSent: false,
	}

	if err := e.alerts.CreateAlertHistory(history); err != nil {
		// Log error but continue with notifications
		return
	}

	// Send notifications
	payload := AlertPayload{
		RuleName:    rule.Name,
		NodeID:      node.ID,
		NodeName:    node.Name,
		MetricField: rule.MetricField,
		MetricValue: floatValue,
		Threshold:   rule.Threshold,
		Operator:    rule.Operator,
		TriggeredAt: history.TriggeredAt,
		Status:      "triggered",
	}

	notificationSent := false
	var notificationError string
	for _, channel := range rule.NotificationChannels {
		nc := NotificationChannel{
			Type:       channel.Type,
			WebhookURL: channel.WebhookURL,
			Secret:     channel.Secret,
			Headers:    channel.Headers,
		}
		if err := e.notifier.Send(ctx, nc, payload); err != nil {
			notificationError = err.Error()
		} else {
			notificationSent = true
		}
	}

	// Update history with notification status
	if notificationSent {
		history.NotificationSent = true
	}
	if notificationError != "" {
		history.NotificationError = notificationError
	}

	// Mark as triggered in state
	e.mu.Lock()
	if e.states[stateKey] != nil {
		e.states[stateKey].Triggered = true
		e.states[stateKey].HistoryID = history.ID
	}
	e.mu.Unlock()
}

// checkResolution checks if a previously triggered alert should be resolved
func (e *Engine) checkResolution(ctx context.Context, rule *store.AlertRule, nodeID string) {
	stateKey := fmt.Sprintf("%d:%s", rule.ID, nodeID)
	e.mu.Lock()
	state := e.states[stateKey]
	e.mu.Unlock()

	// If alert was triggered but condition is no longer met, mark as resolved
	if state != nil && state.Triggered && state.HistoryID > 0 {
		resolvedAt := time.Now().UTC()
		if err := e.alerts.UpdateAlertHistoryResolved(state.HistoryID, resolvedAt); err != nil {
			// Log error but continue
		}

		// Clear state
		e.mu.Lock()
		delete(e.states, stateKey)
		e.mu.Unlock()
	}
}

// evaluateRule evaluates a single rule against a metric
func (e *Engine) evaluateRule(rule *store.AlertRule, metric *store.Metric) bool {
	// Check if node is in scope first
	if !e.nodeInScope(rule, metric.NodeID) {
		return false
	}

	// Check if threshold is met
	thresholdMet := e.checkThreshold(rule, metric)

	stateKey := fmt.Sprintf("%d:%s", rule.ID, metric.NodeID)
	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now().UTC()
	state, exists := e.states[stateKey]

	if !thresholdMet {
		// Condition no longer met - clear state
		if exists {
			delete(e.states, stateKey)
		}
		return false
	}

	// Threshold is met
	if !exists {
		// First time condition met - record state
		e.states[stateKey] = &AlertState{
			RuleID:       rule.ID,
			NodeID:       metric.NodeID,
			ConditionMet: true,
			FirstMetAt:   now,
			LastChecked:  now,
		}
		// If no duration requirement, trigger immediately
		if rule.DurationSeconds == 0 {
			return true
		}
		return false
	}

	// Condition was already met - check if duration elapsed
	state.LastChecked = now
	if rule.DurationSeconds == 0 {
		return true
	}

	elapsed := now.Sub(state.FirstMetAt)
	return elapsed >= time.Duration(rule.DurationSeconds)*time.Second
}

// checkThreshold checks if the metric value meets the rule threshold
func (e *Engine) checkThreshold(rule *store.AlertRule, metric *store.Metric) bool {
	value := e.getMetricValue(metric, rule.MetricField)
	if value == nil {
		return false
	}

	floatValue, ok := value.(float64)
	if !ok {
		// Try converting int64 to float64
		if intValue, ok := value.(int64); ok {
			floatValue = float64(intValue)
		} else {
			return false
		}
	}

	switch rule.Operator {
	case ">":
		return floatValue > rule.Threshold
	case ">=":
		return floatValue >= rule.Threshold
	case "<":
		return floatValue < rule.Threshold
	case "<=":
		return floatValue <= rule.Threshold
	case "=":
		return floatValue == rule.Threshold
	default:
		return false
	}
}

// getMetricValue extracts a specific field value from a metric
func (e *Engine) getMetricValue(metric *store.Metric, field string) interface{} {
	v := reflect.ValueOf(metric)
	if v.Kind() == reflect.Ptr {
		v = v.Elem()
	}

	fieldMap := map[string]string{
		"cpu_usage":        "CPUUsage",
		"memory_usage":     "MemoryUsage",
		"disk_usage":       "DiskUsage",
		"swap_usage":       "SwapUsage",
		"network_rx_bytes": "RXTotal",
		"network_tx_bytes": "TXTotal",
		"load_1":           "Load1",
		"load_5":           "Load5",
		"load_15":          "Load15",
	}

	structField, ok := fieldMap[field]
	if !ok {
		return nil
	}

	fieldValue := v.FieldByName(structField)
	if !fieldValue.IsValid() {
		return nil
	}

	return fieldValue.Interface()
}

// nodeInScope checks if a node is in the scope of a rule
func (e *Engine) nodeInScope(rule *store.AlertRule, nodeID string) bool {
	if rule.ScopeType == "all" {
		return true
	}

	if rule.ScopeType == "nodes" {
		for _, id := range rule.ScopeNodeIDs {
			if id == nodeID {
				return true
			}
		}
		return false
	}

	return false
}

// getAlertState retrieves the alert state for a rule and node (for testing)
func (e *Engine) getAlertState(ruleID int64, nodeID string) *AlertState {
	e.mu.RLock()
	defer e.mu.RUnlock()
	key := fmt.Sprintf("%d:%s", ruleID, nodeID)
	return e.states[key]
}
