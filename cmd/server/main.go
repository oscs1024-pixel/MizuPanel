package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"

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
	database, err := serverdb.Open(cfg.DatabasePath)
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()

	nodes := store.NewNodeStore(database)
	metrics := store.NewMetricStore(database)
	agentTokens := store.NewAgentTokenStore(database)
	cleaner := retention.NewCleaner(metrics, cfg.MetricsRetention)
	go cleaner.Run(context.Background(), cfg.CleanupInterval)

	paths, err := runtimeReleasePaths(os.Executable)
	if err != nil {
		log.Fatal(err)
	}
	handler := app.NewHandler(app.Dependencies{
		Nodes:       nodes,
		Metrics:     metrics,
		AgentTokens: agentTokens,
		AgentToken:  cfg.AgentToken,
		PublicURL:   cfg.PublicURL,
		Interval:    5,
		StaticDir:   paths.StaticDir,
		DownloadDir: paths.DownloadDir,
	})
	log.Printf("MizuPanel server listening on %s", cfg.Listen)
	log.Fatal(http.ListenAndServe(cfg.Listen, handler))
}

type releaseAssetPaths struct {
	StaticDir   string
	DownloadDir string
}

func runtimeReleasePaths(executablePath func() (string, error)) (releaseAssetPaths, error) {
	executable, err := executablePath()
	if err != nil {
		return releaseAssetPaths{}, err
	}
	absolute, err := filepath.Abs(executable)
	if err != nil {
		return releaseAssetPaths{}, err
	}
	return releasePaths(absolute), nil
}

func releasePaths(executable string) releaseAssetPaths {
	root := filepath.Dir(executable)
	return releaseAssetPaths{
		StaticDir:   filepath.Join(root, "web"),
		DownloadDir: filepath.Join(root, "downloads"),
	}
}
