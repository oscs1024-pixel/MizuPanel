package store

import (
	"context"
	"database/sql"
	"time"
)

type Metric struct {
	ID          int64
	NodeID      string
	CPUUsage    float64
	CPUCores    int
	MemoryTotal int64
	MemoryUsed  int64
	MemoryUsage float64
	DiskTotal   int64
	DiskUsed    int64
	DiskUsage   float64
	RXSpeed     int64
	TXSpeed     int64
	RXTotal     int64
	TXTotal     int64
	Load1       float64
	Load5       float64
	Load15      float64
	CreatedAt   time.Time
}

type MetricStore struct {
	db *sql.DB
}

func NewMetricStore(db *sql.DB) *MetricStore {
	return &MetricStore{db: db}
}

func (s *MetricStore) Insert(ctx context.Context, metric Metric) error {
	if metric.CreatedAt.IsZero() {
		metric.CreatedAt = time.Now().UTC()
	}
	result, err := s.db.ExecContext(ctx, `
			INSERT INTO node_metrics (
				node_id, cpu_usage, cpu_cores, memory_total, memory_used, memory_usage,
				disk_total, disk_used, disk_usage, rx_speed, tx_speed, rx_total, tx_total,
				load1, load5, load15, created_at
			)
			SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
			WHERE EXISTS (SELECT 1 FROM nodes WHERE id = ?)
		`, metric.NodeID, metric.CPUUsage, metric.CPUCores, metric.MemoryTotal, metric.MemoryUsed, metric.MemoryUsage, metric.DiskTotal, metric.DiskUsed, metric.DiskUsage, metric.RXSpeed, metric.TXSpeed, metric.RXTotal, metric.TXTotal, metric.Load1, metric.Load5, metric.Load15, formatTime(metric.CreatedAt), metric.NodeID)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *MetricStore) ListRange(ctx context.Context, nodeID string, from time.Time, to time.Time) ([]Metric, error) {
	rows, err := s.db.QueryContext(ctx, `
			SELECT id, node_id, cpu_usage, cpu_cores, memory_total, memory_used, memory_usage,
				disk_total, disk_used, disk_usage, rx_speed, tx_speed, rx_total, tx_total,
				load1, load5, load15, created_at
			FROM node_metrics
			WHERE node_id = ? AND created_at >= ? AND created_at <= ?
			ORDER BY created_at ASC
		`, nodeID, formatTime(from), formatTime(to))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var metrics []Metric
	for rows.Next() {
		metric, err := scanMetric(rows)
		if err != nil {
			return nil, err
		}
		metrics = append(metrics, metric)
	}
	return metrics, rows.Err()
}

func (s *MetricStore) Latest(ctx context.Context, nodeID string) (Metric, bool, error) {
	row := s.db.QueryRowContext(ctx, `
			SELECT id, node_id, cpu_usage, cpu_cores, memory_total, memory_used, memory_usage,
				disk_total, disk_used, disk_usage, rx_speed, tx_speed, rx_total, tx_total,
				load1, load5, load15, created_at
			FROM node_metrics
			WHERE node_id = ?
			ORDER BY created_at DESC
			LIMIT 1
		`, nodeID)
	metric, err := scanMetric(row)
	if err == sql.ErrNoRows {
		return Metric{}, false, nil
	}
	if err != nil {
		return Metric{}, false, err
	}
	return metric, true, nil
}

func (s *MetricStore) DeleteOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {
	result, err := s.db.ExecContext(ctx, `DELETE FROM node_metrics WHERE created_at < ?`, formatTime(cutoff))
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

type metricScanner interface {
	Scan(dest ...any) error
}

func scanMetric(scanner metricScanner) (Metric, error) {
	var metric Metric
	var createdAt string
	if err := scanner.Scan(&metric.ID, &metric.NodeID, &metric.CPUUsage, &metric.CPUCores, &metric.MemoryTotal, &metric.MemoryUsed, &metric.MemoryUsage, &metric.DiskTotal, &metric.DiskUsed, &metric.DiskUsage, &metric.RXSpeed, &metric.TXSpeed, &metric.RXTotal, &metric.TXTotal, &metric.Load1, &metric.Load5, &metric.Load15, &createdAt); err != nil {
		return Metric{}, err
	}
	parsed, err := parseTime(createdAt)
	if err != nil {
		return Metric{}, err
	}
	metric.CreatedAt = parsed
	return metric, nil
}
