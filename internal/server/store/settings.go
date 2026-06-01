package store

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"

	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
)

const (
	MetricsRetentionMin = 6 * time.Hour
	MetricsRetentionMax = 7 * 24 * time.Hour
	metricsRetentionKey = "metrics_retention"
)

type SettingsStore struct {
	db      *sql.DB
	dialect serverdb.Dialect
}

func NewSettingsStore(db *sql.DB) *SettingsStore {
	return NewSettingsStoreWithDialect(db, serverdb.DialectSQLite)
}

func NewSettingsStoreWithDialect(db *sql.DB, dialect serverdb.Dialect) *SettingsStore {
	return &SettingsStore{db: db, dialect: dialect}
}

func (s *SettingsStore) MetricsRetention(ctx context.Context, fallback time.Duration) (time.Duration, error) {
	value, err := s.MetricsRetentionValue(ctx, fallback)
	if err != nil {
		return 0, err
	}
	return ParseMetricsRetention(value)
}

func (s *SettingsStore) MetricsRetentionValue(ctx context.Context, fallback time.Duration) (string, error) {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE `+"`key`"+` = ?`, metricsRetentionKey).Scan(&value)
	if err == sql.ErrNoRows {
		return FormatMetricsRetention(fallback), nil
	}
	if err != nil {
		return "", err
	}
	retention, err := ParseMetricsRetention(value)
	if err != nil {
		return "", err
	}
	return FormatMetricsRetention(retention), nil
}

func (s *SettingsStore) SetMetricsRetention(ctx context.Context, value string) error {
	retention, err := ParseMetricsRetention(value)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, settingsUpsertSQL(s.dialect), metricsRetentionKey, FormatMetricsRetention(retention), formatTime(time.Now().UTC()))
	return err
}

func settingsUpsertSQL(dialect serverdb.Dialect) string {
	if dialect == serverdb.DialectMySQL {
		return `INSERT INTO settings (` + "`key`" + `, value, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`
	}
	return `INSERT INTO settings (` + "`key`" + `, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(` + "`key`" + `) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
}

func ParseMetricsRetention(value string) (time.Duration, error) {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	if strings.HasSuffix(trimmed, "d") {
		days, err := strconv.Atoi(strings.TrimSuffix(trimmed, "d"))
		if err != nil {
			return 0, fmt.Errorf("invalid metrics retention")
		}
		return validateMetricsRetention(time.Duration(days) * 24 * time.Hour)
	}
	parsed, err := time.ParseDuration(trimmed)
	if err != nil {
		return 0, fmt.Errorf("invalid metrics retention")
	}
	return validateMetricsRetention(parsed)
}

func FormatMetricsRetention(retention time.Duration) string {
	if retention == 24*time.Hour {
		return "24h"
	}
	if retention%(24*time.Hour) == 0 && retention >= 48*time.Hour {
		return fmt.Sprintf("%dd", int(retention/(24*time.Hour)))
	}
	if retention%time.Hour == 0 {
		return fmt.Sprintf("%dh", int(retention/time.Hour))
	}
	return retention.String()
}

func validateMetricsRetention(retention time.Duration) (time.Duration, error) {
	for _, allowed := range []time.Duration{6 * time.Hour, 24 * time.Hour, 3 * 24 * time.Hour, MetricsRetentionMax} {
		if retention == allowed {
			return retention, nil
		}
	}
	return 0, fmt.Errorf("metrics retention must be one of 6h, 24h, 3d, or 7d")
}
