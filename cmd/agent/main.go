package main

import (
	"context"
	"flag"
	"log"
	"time"

	agentconfig "github.com/mizupanel/mizupanel/internal/agent/config"
	"github.com/mizupanel/mizupanel/internal/agent/metrics"
	agentws "github.com/mizupanel/mizupanel/internal/agent/ws"
	"github.com/mizupanel/mizupanel/internal/protocol"
)

func main() {
	configPath := flag.String("config", "", "path to agent config file")
	flag.Parse()

	cfg, err := agentconfig.Load(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	collector := metrics.NewCollector()
	initialSnapshot, err := collector.Collect()
	if err != nil {
		log.Fatal(err)
	}
	if initialSnapshot.Hostname == "" {
		initialSnapshot.Hostname = cfg.Name
	}
	client := agentws.NewClient(cfg.ServerURL, cfg.Token)
	if *configPath != "" {
		client.SetNodeTokenHandler(func(token string) error {
			return agentconfig.SaveToken(*configPath, token)
		})
	}
	err = client.RunForever(context.Background(), protocol.HelloMessage{
		Type:         protocol.MessageTypeHello,
		NodeID:       cfg.NodeID,
		AgentVersion: "0.1.0",
		Hostname:     initialSnapshot.Hostname,
		Name:         cfg.Name,
		IP:           initialSnapshot.IP,
		OS:           initialSnapshot.OS,
		Arch:         initialSnapshot.Arch,
		Kernel:       initialSnapshot.Kernel,
	}, cfg.Interval, 3*time.Second, func(nodeID string, timestamp int64) (protocol.MetricsMessage, error) {
		snapshot, err := collector.Collect()
		if err != nil {
			return protocol.MetricsMessage{}, err
		}
		if snapshot.Hostname == "" {
			snapshot.Hostname = cfg.Name
		}
		return snapshot.ToMessage(nodeID, timestamp), nil
	})
	if err != nil && err != context.Canceled {
		log.Fatal(err)
	}
	_ = time.Second
}
