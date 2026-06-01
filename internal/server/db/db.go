package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	mysql "github.com/go-sql-driver/mysql"
	_ "github.com/mattn/go-sqlite3"
)

type Dialect string

const (
	DialectSQLite Dialect = "sqlite"
	DialectMySQL  Dialect = "mysql"
)

type StorageConfig struct {
	Driver string
	SQLite SQLiteConfig
	MySQL  MySQLConfig
}

type SQLiteConfig struct {
	Path string
}

type MySQLConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	Database string
}

func Open(path string) (*sql.DB, error) {
	database, _, err := OpenStorage(StorageConfig{Driver: string(DialectSQLite), SQLite: SQLiteConfig{Path: path}})
	return database, err
}

func OpenStorage(storage StorageConfig) (*sql.DB, Dialect, error) {
	switch storage.Driver {
	case "", string(DialectSQLite):
		database, err := openSQLite(storage.SQLite.Path)
		return database, DialectSQLite, err
	case string(DialectMySQL):
		database, err := openMySQL(storage.MySQL)
		return database, DialectMySQL, err
	default:
		return nil, "", fmt.Errorf("unsupported storage driver %q", storage.Driver)
	}
}

func openSQLite(path string) (*sql.DB, error) {
	if path == "" {
		path = "./data/mizupanel.db"
	}
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
	if err := MigrateDialect(database, DialectSQLite); err != nil {
		database.Close()
		return nil, err
	}
	return database, nil
}

func openMySQL(cfg MySQLConfig) (*sql.DB, error) {
	database, err := sql.Open("mysql", mysqlDSN(cfg))
	if err != nil {
		return nil, err
	}
	database.SetMaxOpenConns(25)
	database.SetMaxIdleConns(5)
	database.SetConnMaxLifetime(30 * time.Minute)
	if err := database.Ping(); err != nil {
		database.Close()
		return nil, err
	}
	if err := MigrateDialect(database, DialectMySQL); err != nil {
		database.Close()
		return nil, err
	}
	return database, nil
}

func mysqlDSN(cfg MySQLConfig) string {
	port := cfg.Port
	if port == 0 {
		port = 3306
	}
	mysqlConfig := mysql.Config{
		User:                 cfg.Username,
		Passwd:               cfg.Password,
		Net:                  "tcp",
		Addr:                 fmt.Sprintf("%s:%d", cfg.Host, port),
		DBName:               cfg.Database,
		AllowNativePasswords: true,
		ParseTime:            true,
		Params: map[string]string{
			"charset": "utf8mb4",
		},
	}
	return mysqlConfig.FormatDSN()
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
