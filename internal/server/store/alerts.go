package store

import (
	"database/sql"
	"encoding/json"
	"time"

	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
)

type AlertStore struct {
	db      *sql.DB
	dialect serverdb.Dialect
}

func NewAlertStore(db *sql.DB) *AlertStore {
	return &AlertStore{
		db:      db,
		dialect: serverdb.DialectSQLite,
	}
}

type AlertRule struct {
	ID                     int64                  `json:"id"`
	Name                   string                 `json:"name"`
	Enabled                bool                   `json:"enabled"`
	MetricField            string                 `json:"metric_field"`
	Operator               string                 `json:"operator"`
	Threshold              float64                `json:"threshold"`
	DurationSeconds        int                    `json:"duration_seconds"`
	ScopeType              string                 `json:"scope_type"`
	ScopeNodeIDs           []string               `json:"scope_node_ids,omitempty"`
	NotificationChannels   []NotificationChannel  `json:"notification_channels"`
	CreatedAt              time.Time              `json:"created_at"`
	UpdatedAt              time.Time              `json:"updated_at"`
}

type NotificationChannel struct {
	Type       string            `json:"type"`
	WebhookURL string            `json:"webhook_url,omitempty"`
	Headers    map[string]string `json:"headers,omitempty"`
	Secret     string            `json:"secret,omitempty"`
}

type AlertHistory struct {
	ID                 int64     `json:"id"`
	RuleID             int64     `json:"rule_id"`
	RuleName           string    `json:"rule_name"`
	NodeID             string    `json:"node_id"`
	NodeName           string    `json:"node_name"`
	MetricField        string    `json:"metric_field"`
	MetricValue        float64   `json:"metric_value"`
	Threshold          float64   `json:"threshold"`
	TriggeredAt        time.Time `json:"triggered_at"`
	ResolvedAt         *time.Time `json:"resolved_at,omitempty"`
	NotificationSent   bool      `json:"notification_sent"`
	NotificationError  string    `json:"notification_error,omitempty"`
	CreatedAt          time.Time `json:"created_at"`
}

func (s *AlertStore) CreateAlertRule(rule *AlertRule) error {
	scopeNodeIDsJSON, err := json.Marshal(rule.ScopeNodeIDs)
	if err != nil {
		return err
	}
	notificationChannelsJSON, err := json.Marshal(rule.NotificationChannels)
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	result, err := s.db.Exec(`INSERT INTO alert_rules (name, enabled, metric_field, operator, threshold, duration_seconds, scope_type, scope_node_ids, notification_channels, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		rule.Name, rule.Enabled, rule.MetricField, rule.Operator, rule.Threshold, rule.DurationSeconds, rule.ScopeType, string(scopeNodeIDsJSON), string(notificationChannelsJSON), now, now)
	if err != nil {
		return err
	}

	id, err := result.LastInsertId()
	if err != nil {
		return err
	}
	rule.ID = id
	rule.CreatedAt = now
	rule.UpdatedAt = now
	return nil
}

func (s *AlertStore) GetAlertRules() ([]AlertRule, error) {
	rows, err := s.db.Query(`SELECT id, name, enabled, metric_field, operator, threshold, duration_seconds, scope_type, scope_node_ids, notification_channels, created_at, updated_at FROM alert_rules ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []AlertRule
	for rows.Next() {
		var rule AlertRule
		var scopeNodeIDsJSON, notificationChannelsJSON string
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.Enabled, &rule.MetricField, &rule.Operator, &rule.Threshold, &rule.DurationSeconds, &rule.ScopeType, &scopeNodeIDsJSON, &notificationChannelsJSON, &rule.CreatedAt, &rule.UpdatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(scopeNodeIDsJSON), &rule.ScopeNodeIDs); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(notificationChannelsJSON), &rule.NotificationChannels); err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	return rules, rows.Err()
}

func (s *AlertStore) CreateAlertHistory(history *AlertHistory) error {
	now := time.Now().UTC()
	result, err := s.db.Exec(`INSERT INTO alert_history (rule_id, rule_name, node_id, node_name, metric_field, metric_value, threshold, triggered_at, resolved_at, notification_sent, notification_error, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		history.RuleID, history.RuleName, history.NodeID, history.NodeName, history.MetricField, history.MetricValue, history.Threshold, history.TriggeredAt, history.ResolvedAt, history.NotificationSent, history.NotificationError, now)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return err
	}
	history.ID = id
	history.CreatedAt = now
	return nil
}

func (s *AlertStore) GetAlertHistory(nodeID string, limit int) ([]AlertHistory, error) {
	query := `SELECT id, rule_id, rule_name, node_id, node_name, metric_field, metric_value, threshold, triggered_at, resolved_at, notification_sent, notification_error, created_at
		FROM alert_history WHERE node_id = ? ORDER BY triggered_at DESC LIMIT ?`
	rows, err := s.db.Query(query, nodeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var history []AlertHistory
	for rows.Next() {
		var h AlertHistory
		if err := rows.Scan(&h.ID, &h.RuleID, &h.RuleName, &h.NodeID, &h.NodeName, &h.MetricField, &h.MetricValue, &h.Threshold, &h.TriggeredAt, &h.ResolvedAt, &h.NotificationSent, &h.NotificationError, &h.CreatedAt); err != nil {
			return nil, err
		}
		history = append(history, h)
	}
	return history, rows.Err()
}

func (s *AlertStore) UpdateAlertHistoryResolved(id int64, resolvedAt time.Time) error {
	_, err := s.db.Exec(`UPDATE alert_history SET resolved_at = ? WHERE id = ?`, resolvedAt, id)
	return err
}


func (s *AlertStore) GetAlertRule(id int64) (*AlertRule, error) {
	var rule AlertRule
	var scopeNodeIDsJSON, notificationChannelsJSON string
	err := s.db.QueryRow(`SELECT id, name, enabled, metric_field, operator, threshold, duration_seconds, scope_type, scope_node_ids, notification_channels, created_at, updated_at FROM alert_rules WHERE id = ?`, id).
		Scan(&rule.ID, &rule.Name, &rule.Enabled, &rule.MetricField, &rule.Operator, &rule.Threshold, &rule.DurationSeconds, &rule.ScopeType, &scopeNodeIDsJSON, &notificationChannelsJSON, &rule.CreatedAt, &rule.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(scopeNodeIDsJSON), &rule.ScopeNodeIDs); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(notificationChannelsJSON), &rule.NotificationChannels); err != nil {
		return nil, err
	}
	return &rule, nil
}

func (s *AlertStore) UpdateAlertRule(rule *AlertRule) error {
	scopeNodeIDsJSON, err := json.Marshal(rule.ScopeNodeIDs)
	if err != nil {
		return err
	}
	notificationChannelsJSON, err := json.Marshal(rule.NotificationChannels)
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	_, err = s.db.Exec(`UPDATE alert_rules SET name = ?, enabled = ?, metric_field = ?, operator = ?, threshold = ?, duration_seconds = ?, scope_type = ?, scope_node_ids = ?, notification_channels = ?, updated_at = ? WHERE id = ?`,
		rule.Name, rule.Enabled, rule.MetricField, rule.Operator, rule.Threshold, rule.DurationSeconds, rule.ScopeType, string(scopeNodeIDsJSON), string(notificationChannelsJSON), now, rule.ID)
	if err != nil {
		return err
	}
	rule.UpdatedAt = now
	return nil
}

func (s *AlertStore) DeleteAlertRule(id int64) error {
	_, err := s.db.Exec(`DELETE FROM alert_rules WHERE id = ?`, id)
	return err
}

func (s *AlertStore) GetEnabledAlertRules() ([]AlertRule, error) {
	rows, err := s.db.Query(`SELECT id, name, enabled, metric_field, operator, threshold, duration_seconds, scope_type, scope_node_ids, notification_channels, created_at, updated_at FROM alert_rules WHERE enabled = 1 ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []AlertRule
	for rows.Next() {
		var rule AlertRule
		var scopeNodeIDsJSON, notificationChannelsJSON string
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.Enabled, &rule.MetricField, &rule.Operator, &rule.Threshold, &rule.DurationSeconds, &rule.ScopeType, &scopeNodeIDsJSON, &notificationChannelsJSON, &rule.CreatedAt, &rule.UpdatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(scopeNodeIDsJSON), &rule.ScopeNodeIDs); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(notificationChannelsJSON), &rule.NotificationChannels); err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	return rules, rows.Err()
}

