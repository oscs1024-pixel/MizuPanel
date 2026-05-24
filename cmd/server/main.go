package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"strings"

	"github.com/mizupanel/mizupanel/internal/server/app"
	"github.com/mizupanel/mizupanel/internal/server/config"
	serverdb "github.com/mizupanel/mizupanel/internal/server/db"
	"github.com/mizupanel/mizupanel/internal/server/retention"
	"github.com/mizupanel/mizupanel/internal/server/store"
)

func main() {
	configPath := flag.String("config", "", "path to server config file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	if err := requireServerSecrets(cfg); err != nil {
		log.Fatal(err)
	}
	database, err := serverdb.Open(cfg.DatabasePath)
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()

	nodes := store.NewNodeStore(database)
	metrics := store.NewMetricStore(database)
	cleaner := retention.NewCleaner(metrics, cfg.MetricsRetention)
	go cleaner.Run(context.Background(), cfg.CleanupInterval)

	handler := app.NewHandler(app.Dependencies{
		Nodes:         nodes,
		Metrics:       metrics,
		AgentToken:    cfg.AgentToken,
		AdminPassword: cfg.AdminPassword,
		Interval:      5,
		StaticDir:     "web/dist",
		DownloadDir:   "dist/downloads",
	})
	log.Printf("MizuPanel server listening on %s", cfg.Listen)
	log.Fatal(http.ListenAndServe(cfg.Listen, handler))
}

func requireServerSecrets(cfg config.Config) error {
	if strings.TrimSpace(cfg.AdminPassword) == "" {
		return errors.New("admin_password must be set in server config or MIZUPANEL_ADMIN_PASSWORD")
	}
	return nil
}
