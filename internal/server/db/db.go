package db

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

func Open(path string) (*sql.DB, error) {
	if dir := filepath.Dir(path); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, err
		}
	}

	database, err := sql.Open("sqlite3", sqliteDSN(path))
	if err != nil {
		return nil, err
	}
	database.SetMaxOpenConns(1)
	if _, err := database.Exec("PRAGMA journal_mode=WAL"); err != nil {
		database.Close()
		return nil, err
	}
	if err := Migrate(database); err != nil {
		database.Close()
		return nil, err
	}
	return database, nil
}

func sqliteDSN(path string) string {
	if path == ":memory:" {
		return path
	}
	if strings.Contains(path, "?") {
		return path + "&_busy_timeout=5000"
	}
	return path + "?_busy_timeout=5000"
}
