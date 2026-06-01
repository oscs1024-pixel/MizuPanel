package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/mizupanel/mizupanel/internal/protocol"
	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
)

type ProcessSnapshotStore struct {
	db      *sql.DB
	dialect serverdb.Dialect
}

func NewProcessSnapshotStore(db *sql.DB) *ProcessSnapshotStore {
	return NewProcessSnapshotStoreWithDialect(db, serverdb.DialectSQLite)
}

func NewProcessSnapshotStoreWithDialect(db *sql.DB, dialect serverdb.Dialect) *ProcessSnapshotStore {
	return &ProcessSnapshotStore{db: db, dialect: dialect}
}

func (s *ProcessSnapshotStore) Upsert(ctx context.Context, nodeID string, snapshot protocol.ProcessSnapshot) error {
	processesJSON, err := json.Marshal(snapshot.Processes)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, processSnapshotUpsertSQL(s.dialect), nodeID, snapshot.CollectedAt, string(processesJSON), snapshot.Error, formatTime(time.Now().UTC()))
	return err
}

func processSnapshotUpsertSQL(dialect serverdb.Dialect) string {
	if dialect == serverdb.DialectMySQL {
		return `
			INSERT INTO node_process_snapshots (node_id, collected_at, processes_json, error, updated_at)
			VALUES (?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE
				collected_at = VALUES(collected_at),
				processes_json = VALUES(processes_json),
				error = VALUES(error),
				updated_at = VALUES(updated_at)
		`
	}
	return `
			INSERT INTO node_process_snapshots (node_id, collected_at, processes_json, error, updated_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(node_id) DO UPDATE SET
				collected_at = excluded.collected_at,
				processes_json = excluded.processes_json,
				error = excluded.error,
				updated_at = excluded.updated_at
		`
}

func (s *ProcessSnapshotStore) Get(ctx context.Context, nodeID string) (protocol.ProcessSnapshot, bool, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT collected_at, processes_json, error
		FROM node_process_snapshots
		WHERE node_id = ?
	`, nodeID)
	var snapshot protocol.ProcessSnapshot
	var processesJSON string
	if err := row.Scan(&snapshot.CollectedAt, &processesJSON, &snapshot.Error); err != nil {
		if err == sql.ErrNoRows {
			return protocol.ProcessSnapshot{}, false, nil
		}
		return protocol.ProcessSnapshot{}, false, err
	}
	if err := json.Unmarshal([]byte(processesJSON), &snapshot.Processes); err != nil {
		return protocol.ProcessSnapshot{}, false, err
	}
	if snapshot.Processes == nil {
		snapshot.Processes = []protocol.ProcessInfo{}
	}
	return snapshot, true, nil
}

type DockerSnapshotStore struct {
	db      *sql.DB
	dialect serverdb.Dialect
}

func NewDockerSnapshotStore(db *sql.DB) *DockerSnapshotStore {
	return NewDockerSnapshotStoreWithDialect(db, serverdb.DialectSQLite)
}

func NewDockerSnapshotStoreWithDialect(db *sql.DB, dialect serverdb.Dialect) *DockerSnapshotStore {
	return &DockerSnapshotStore{db: db, dialect: dialect}
}

func (s *DockerSnapshotStore) Upsert(ctx context.Context, nodeID string, snapshot protocol.DockerSnapshot) error {
	containersJSON, err := json.Marshal(snapshot.Containers)
	if err != nil {
		return err
	}
	available := 0
	if snapshot.Available {
		available = 1
	}
	_, err = s.db.ExecContext(ctx, dockerSnapshotUpsertSQL(s.dialect), nodeID, snapshot.CollectedAt, available, snapshot.Version, string(containersJSON), snapshot.Error, formatTime(time.Now().UTC()))
	return err
}

func dockerSnapshotUpsertSQL(dialect serverdb.Dialect) string {
	if dialect == serverdb.DialectMySQL {
		return `
			INSERT INTO node_docker_snapshots (node_id, collected_at, available, version, containers_json, error, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE
				collected_at = VALUES(collected_at),
				available = VALUES(available),
				version = VALUES(version),
				containers_json = VALUES(containers_json),
				error = VALUES(error),
				updated_at = VALUES(updated_at)
		`
	}
	return `
			INSERT INTO node_docker_snapshots (node_id, collected_at, available, version, containers_json, error, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(node_id) DO UPDATE SET
				collected_at = excluded.collected_at,
				available = excluded.available,
				version = excluded.version,
				containers_json = excluded.containers_json,
				error = excluded.error,
				updated_at = excluded.updated_at
		`
}

func (s *DockerSnapshotStore) Get(ctx context.Context, nodeID string) (protocol.DockerSnapshot, bool, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT collected_at, available, version, containers_json, error
		FROM node_docker_snapshots
		WHERE node_id = ?
	`, nodeID)
	var snapshot protocol.DockerSnapshot
	var containersJSON string
	var available int
	if err := row.Scan(&snapshot.CollectedAt, &available, &snapshot.Version, &containersJSON, &snapshot.Error); err != nil {
		if err == sql.ErrNoRows {
			return protocol.DockerSnapshot{}, false, nil
		}
		return protocol.DockerSnapshot{}, false, err
	}
	snapshot.Available = available != 0
	if err := json.Unmarshal([]byte(containersJSON), &snapshot.Containers); err != nil {
		return protocol.DockerSnapshot{}, false, err
	}
	if snapshot.Containers == nil {
		snapshot.Containers = []protocol.ContainerInfo{}
	}
	return snapshot, true, nil
}
