//go:build !windows

package main

import "context"

func runAgentEntrypoint(configPath string) error {
	return runAgent(context.Background(), configPath)
}
