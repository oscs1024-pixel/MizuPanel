package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
)

type AgentTokenStore struct {
	db      *sql.DB
	dialect serverdb.Dialect
}

func NewAgentTokenStore(db *sql.DB) *AgentTokenStore {
	return NewAgentTokenStoreWithDialect(db, serverdb.DialectSQLite)
}

func NewAgentTokenStoreWithDialect(db *sql.DB, dialect serverdb.Dialect) *AgentTokenStore {
	return &AgentTokenStore{db: db, dialect: dialect}
}

const tokenHashPrefix = "sha256:"

func (s *AgentTokenStore) SaveNodeToken(ctx context.Context, nodeID string, token string, createdAt time.Time) error {
	_, err := s.db.ExecContext(ctx, agentTokenUpsertSQL(s.dialect), nodeID, hashToken(token), formatTime(createdAt))
	return err
}

func agentTokenUpsertSQL(dialect serverdb.Dialect) string {
	if dialect == serverdb.DialectMySQL {
		return `
			INSERT INTO node_tokens (node_id, token, created_at)
			VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE
				token = VALUES(token),
				created_at = VALUES(created_at)
		`
	}
	return `
			INSERT INTO node_tokens (node_id, token, created_at)
			VALUES (?, ?, ?)
			ON CONFLICT(node_id) DO UPDATE SET
				token = excluded.token,
				created_at = excluded.created_at
		`
}

func (s *AgentTokenStore) NodeToken(ctx context.Context, nodeID string) (string, bool, error) {
	row := s.db.QueryRowContext(ctx, `SELECT token FROM node_tokens WHERE node_id = ?`, nodeID)
	var token string
	if err := row.Scan(&token); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	return token, true, nil
}

func (s *AgentTokenStore) NodeIDForToken(ctx context.Context, token string) (string, bool, error) {
	tokenHash := hashToken(token)
	row := s.db.QueryRowContext(ctx, `SELECT node_id FROM node_tokens WHERE token = ?`, tokenHash)
	var nodeID string
	if err := row.Scan(&nodeID); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return "", false, err
		}
	} else {
		return nodeID, true, nil
	}
	if strings.HasPrefix(token, tokenHashPrefix) {
		return "", false, nil
	}

	row = s.db.QueryRowContext(ctx, `SELECT node_id FROM node_tokens WHERE token = ?`, token)
	if err := row.Scan(&nodeID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE node_tokens SET token = ? WHERE node_id = ? AND token = ?`, tokenHash, nodeID, token); err != nil {
		return "", false, err
	}
	return nodeID, true, nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return tokenHashPrefix + hex.EncodeToString(sum[:])
}
