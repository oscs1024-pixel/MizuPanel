package db

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

func TestOpenStorageDefaultsToSQLiteAndMigratesSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "mizupanel.db")
	database, dialect, err := OpenStorage(StorageConfig{Driver: "sqlite", SQLite: SQLiteConfig{Path: path}})
	if err != nil {
		t.Fatalf("OpenStorage returned error: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if dialect != DialectSQLite {
		t.Fatalf("dialect = %q, want sqlite", dialect)
	}

	assertTableExists(t, database, "nodes")
	assertTableExists(t, database, "node_metrics")
	assertTableExists(t, database, "install_tokens")
	assertTableExists(t, database, "node_tokens")
}

func TestMySQLDSNBuildsFromStructuredConfig(t *testing.T) {
	dsn := mysqlDSN(MySQLConfig{
		Host:     "db.internal",
		Port:     3307,
		Username: "mizupanel",
		Password: "secret",
		Database: "mizupanel_prod",
	})

	if !strings.Contains(dsn, "mizupanel:secret@tcp(db.internal:3307)/mizupanel_prod") {
		t.Fatalf("mysql dsn = %q", dsn)
	}
	for _, option := range []string{"parseTime=true", "charset=utf8mb4"} {
		if !strings.Contains(dsn, option) {
			t.Fatalf("mysql dsn missing %s: %q", option, dsn)
		}
	}
}

func TestMySQLCompatibilityColumnsUseMySQLTypes(t *testing.T) {
	statements := strings.Join(nodeCompatibilityColumnStatements(DialectMySQL), "\n")
	if !strings.Contains(statements, "VARCHAR(32)") || !strings.Contains(statements, "VARCHAR(255)") {
		t.Fatalf("mysql compatibility columns use wrong types: %s", statements)
	}
	if strings.Contains(statements, "TEXT NOT NULL DEFAULT") {
		t.Fatalf("mysql compatibility columns contain sqlite text default syntax: %s", statements)
	}
}

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
