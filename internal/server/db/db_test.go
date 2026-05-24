package db

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestOpenCreatesDatabaseAndMigratesSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "mizupanel.db")
	database, err := Open(path)
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	assertTableExists(t, database, "nodes")
	assertTableExists(t, database, "node_metrics")
	assertTableExists(t, database, "install_tokens")
	assertTableExists(t, database, "node_tokens")
}

func assertTableExists(t *testing.T, db *sql.DB, table string) {
	t.Helper()
	var name string
	if err := db.QueryRow("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table).Scan(&name); err != nil {
		t.Fatalf("table %s does not exist: %v", table, err)
	}
}
