package db

import "database/sql"

func Migrate(db *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS nodes (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			hostname TEXT,
			ip TEXT,
			os TEXT,
			arch TEXT,
			kernel TEXT,
			agent_version TEXT,
			status TEXT NOT NULL DEFAULT 'offline',
			last_seen_at DATETIME,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS node_metrics (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			node_id TEXT NOT NULL,
			cpu_usage REAL,
			cpu_cores INTEGER,
			memory_total INTEGER,
			memory_used INTEGER,
			memory_usage REAL,
			disk_total INTEGER,
			disk_used INTEGER,
			disk_usage REAL,
			rx_speed INTEGER,
			tx_speed INTEGER,
			rx_total INTEGER,
			tx_total INTEGER,
			load1 REAL,
			load5 REAL,
			load15 REAL,
			created_at DATETIME NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_node_metrics_node_created ON node_metrics(node_id, created_at);`,
		`CREATE TABLE IF NOT EXISTS install_tokens (
			token TEXT PRIMARY KEY,
			used_at DATETIME,
			created_at DATETIME NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS node_tokens (
			node_id TEXT PRIMARY KEY,
			token TEXT NOT NULL UNIQUE,
			created_at DATETIME NOT NULL
		);`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}
