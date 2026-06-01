//go:build windows

package main

import (
	"context"
	"log"
	"time"

	"golang.org/x/sys/windows/svc"
)

const windowsServiceName = "mizupanel-agent"

func runAgentEntrypoint(configPath string) error {
	isService, err := svc.IsWindowsService()
	if err != nil {
		return err
	}
	if !isService {
		return runAgent(context.Background(), configPath)
	}
	return svc.Run(windowsServiceName, &agentService{configPath: configPath})
}

type agentService struct {
	configPath string
}

func (s *agentService) Execute(args []string, requests <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- runAgent(ctx, s.configPath)
	}()

	status <- svc.Status{State: svc.StartPending}
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}

	for {
		select {
		case request := <-requests:
			switch request.Cmd {
			case svc.Interrogate:
				status <- request.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				cancel()
				select {
				case err := <-done:
					if err != nil && err != context.Canceled {
						log.Print(err)
					}
				case <-time.After(15 * time.Second):
				}
				status <- svc.Status{State: svc.Stopped}
				return false, 0
			default:
			}
		case err := <-done:
			if err != nil && err != context.Canceled {
				log.Print(err)
			}
			status <- svc.Status{State: svc.Stopped}
			return false, 1
		}
	}
}
