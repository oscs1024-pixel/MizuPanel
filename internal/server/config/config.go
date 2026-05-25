package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Listen           string
	DatabasePath     string
	MetricsRetention time.Duration
	CleanupInterval  time.Duration
	AgentToken       string
	PublicURL        string
}

type fileConfig struct {
	Listen           string `yaml:"listen"`
	DatabasePath     string `yaml:"database_path"`
	MetricsRetention string `yaml:"metrics_retention"`
	CleanupInterval  string `yaml:"cleanup_interval"`
	AgentToken       string `yaml:"agent_token"`
	PublicURL        string `yaml:"public_url"`
}

func Load(path string) (Config, error) {
	cfg := Config{
		Listen:           ":8080",
		DatabasePath:     "./data/mizupanel.db",
		MetricsRetention: 6 * time.Hour,
		CleanupInterval:  10 * time.Minute,
		AgentToken:       os.Getenv("MIZUPANEL_AGENT_TOKEN"),
	}
	if path == "" {
		return cfg, nil
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}

	var file fileConfig
	if err := yaml.Unmarshal(content, &file); err != nil {
		return Config{}, err
	}
	if file.Listen != "" {
		cfg.Listen = file.Listen
	}
	if file.DatabasePath != "" {
		cfg.DatabasePath = file.DatabasePath
	}
	if file.MetricsRetention != "" {
		duration, err := parseDuration(file.MetricsRetention)
		if err != nil {
			return Config{}, fmt.Errorf("parse metrics_retention: %w", err)
		}
		cfg.MetricsRetention = duration
	}
	if file.CleanupInterval != "" {
		duration, err := parseDuration(file.CleanupInterval)
		if err != nil {
			return Config{}, fmt.Errorf("parse cleanup_interval: %w", err)
		}
		cfg.CleanupInterval = duration
	}
	if file.AgentToken != "" {
		cfg.AgentToken = file.AgentToken
	}
	if file.PublicURL != "" {
		cfg.PublicURL = strings.TrimRight(file.PublicURL, "/")
	}
	return cfg, nil
}

func parseDuration(value string) (time.Duration, error) {
	if strings.HasSuffix(value, "d") {
		days, err := strconv.Atoi(strings.TrimSuffix(value, "d"))
		if err != nil {
			return 0, err
		}
		return time.Duration(days) * 24 * time.Hour, nil
	}
	return time.ParseDuration(value)
}
