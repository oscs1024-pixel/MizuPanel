package reboot

import (
	"context"
	"os/exec"
	"runtime"
	"strings"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

type Runner interface {
	Run(context.Context, string, ...string) error
}

type commandRunner struct{}

func CurrentOS() string {
	return runtime.GOOS
}

func Run(ctx context.Context, goos string, runner Runner) protocol.RebootResponse {
	if goos != "linux" {
		return protocol.RebootResponse{Type: protocol.MessageTypeRebootResponse, Code: "unsupported", Error: "当前平台暂不支持重启。"}
	}
	if runner == nil {
		runner = commandRunner{}
	}
	if err := runner.Run(ctx, "systemctl", "reboot"); err != nil {
		code := "failed"
		message := err.Error()
		if permissionDenied(message) {
			code = "permission_denied"
			message = "权限不足：当前 Agent 运行用户无权重启机器。"
		}
		return protocol.RebootResponse{Type: protocol.MessageTypeRebootResponse, Code: code, Error: message}
	}
	return protocol.RebootResponse{Type: protocol.MessageTypeRebootResponse, Accepted: true}
}

func (commandRunner) Run(ctx context.Context, name string, args ...string) error {
	return exec.CommandContext(ctx, name, args...).Run()
}

func permissionDenied(message string) bool {
	message = strings.ToLower(message)
	return strings.Contains(message, "permission denied") || strings.Contains(message, "access denied") || strings.Contains(message, "not authorized") || strings.Contains(message, "interactive authentication required")
}
