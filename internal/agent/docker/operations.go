package docker

import (
	"context"
	"fmt"
	"net/http"
)

// ContainerStart starts a stopped container
func (c *Collector) ContainerStart(ctx context.Context, id string) error {
	client := c.client
	if client == nil {
		client = newSocketClient(c.socketPath, c.statsTimeout)
	}
	return client.(*socketClient).containerAction(ctx, id, "start")
}

// ContainerStop stops a running container
func (c *Collector) ContainerStop(ctx context.Context, id string) error {
	client := c.client
	if client == nil {
		client = newSocketClient(c.socketPath, c.statsTimeout)
	}
	return client.(*socketClient).containerAction(ctx, id, "stop")
}

// ContainerRestart restarts a container
func (c *Collector) ContainerRestart(ctx context.Context, id string) error {
	client := c.client
	if client == nil {
		client = newSocketClient(c.socketPath, c.statsTimeout)
	}
	return client.(*socketClient).containerAction(ctx, id, "restart")
}

// ContainerDelete removes a container (force=true removes even if running)
func (c *Collector) ContainerDelete(ctx context.Context, id string, force bool) error {
	client := c.client
	if client == nil {
		client = newSocketClient(c.socketPath, c.statsTimeout)
	}

	path := fmt.Sprintf("/containers/%s?force=%v", id, force)
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, client.(*socketClient).baseURL+path, nil)
	if err != nil {
		return err
	}

	response, err := client.(*socketClient).httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Docker API status %d", response.StatusCode)
	}

	return nil
}

func (c *socketClient) containerAction(ctx context.Context, id string, action string) error {
	path := fmt.Sprintf("/containers/%s/%s", id, action)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, nil)
	if err != nil {
		return err
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Docker API status %d", response.StatusCode)
	}

	return nil
}
