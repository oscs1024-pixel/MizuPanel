package docker

import (
	"bytes"
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"time"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

type ExecHandler struct{}

func NewExecHandler() *ExecHandler {
	return &ExecHandler{}
}

func (h *ExecHandler) HandleDockerExec(ctx context.Context, req protocol.DockerExecRequest) protocol.DockerExecResponse {
	// 验证命令是否以docker开头
	command := strings.TrimSpace(req.Command)
	if !strings.HasPrefix(command, "docker ") {
		return protocol.DockerExecResponse{
			Type:     protocol.MessageTypeDockerExecResponse,
			Accepted: false,
			ExitCode: 1,
			Error:    "命令必须以 'docker ' 开头",
		}
	}

	// 执行docker命令
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()

	output := stdout.String()
	if stderr.Len() > 0 {
		if len(output) > 0 {
			output += "\n"
		}
		output += stderr.String()
	}

	exitCode := 0
	errorMsg := ""

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
		errorMsg = err.Error()
	}

	return protocol.DockerExecResponse{
		Type:     protocol.MessageTypeDockerExecResponse,
		Accepted: true,
		Output:   output,
		ExitCode: exitCode,
		Error:    errorMsg,
	}
}

// DockerExecSender sends docker exec responses
type DockerExecSender interface {
	SendDockerExec(response protocol.DockerExecResponse) error
}

// MessageSender implements DockerExecSender
type MessageSender interface {
	SendMessage(data []byte) error
}

type dockerExecSender struct {
	sender MessageSender
}

func (s *dockerExecSender) SendDockerExec(response protocol.DockerExecResponse) error {
	data, err := json.Marshal(response)
	if err != nil {
		return err
	}
	return s.sender.SendMessage(data)
}

func NewDockerExecSender(sender MessageSender) DockerExecSender {
	return &dockerExecSender{sender: sender}
}
