package store

import (
	"strings"
	"testing"

	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
)

func TestMySQLUpsertSQLUsesMySQLDialect(t *testing.T) {
	queries := []string{
		nodeUpsertSQL(serverdb.DialectMySQL),
		deletedNodeUpsertSQL(serverdb.DialectMySQL),
		agentTokenUpsertSQL(serverdb.DialectMySQL),
		settingsUpsertSQL(serverdb.DialectMySQL),
		processSnapshotUpsertSQL(serverdb.DialectMySQL),
		dockerSnapshotUpsertSQL(serverdb.DialectMySQL),
	}
	for _, query := range queries {
		if !strings.Contains(query, "ON DUPLICATE KEY UPDATE") {
			t.Fatalf("mysql upsert query missing ON DUPLICATE KEY UPDATE: %s", query)
		}
		if strings.Contains(query, "ON CONFLICT") {
			t.Fatalf("mysql upsert query contains sqlite syntax: %s", query)
		}
	}
}
