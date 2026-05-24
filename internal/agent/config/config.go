package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	ServerURL string
	Token     string
	NodeID    string
	Name      string
	Interval  time.Duration
}

type fileConfig struct {
	ServerURL string `yaml:"server_url"`
	Token     string `yaml:"token"`
	NodeID    string `yaml:"node_id"`
	Name      string `yaml:"name"`
	Interval  string `yaml:"interval"`
}

func Load(path string) (Config, error) {
	hostname, _ := os.Hostname()
	cfg := Config{
		ServerURL: "ws://localhost:8080/api/agent/ws",
		Token:     "change-me",
		NodeID:    hostname,
		Name:      hostname,
		Interval:  5 * time.Second,
	}
	if cfg.NodeID == "" {
		cfg.NodeID = hostname
	}
	if cfg.Name == "" {
		cfg.Name = "Mizu Agent"
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
	if file.ServerURL != "" {
		cfg.ServerURL = file.ServerURL
	}
	if file.Token != "" {
		cfg.Token = file.Token
	}
	if file.NodeID != "" {
		cfg.NodeID = file.NodeID
	}
	if file.Name != "" {
		cfg.Name = file.Name
	}
	if file.Interval != "" {
		duration, err := time.ParseDuration(file.Interval)
		if err != nil {
			return Config{}, fmt.Errorf("parse interval: %w", err)
		}
		cfg.Interval = duration
	}
	return cfg, nil
}

func SaveToken(path string, token string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var file fileConfig
	if err := yaml.Unmarshal(content, &file); err != nil {
		return err
	}
	file.Token = token
	data, err := yaml.Marshal(file)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}
