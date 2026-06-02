package sshops

import (
	"context"
	"fmt"
	"strings"

	"golang.org/x/crypto/ssh"
)

type InstallRequest struct {
	SSHRequest
	BaseURL        string
	ServerURL      string
	Token          string
	NodeID         string
	Name           string
	EnableTerminal bool
	EnableDocker   bool
	Mode           string
}

type UninstallRequest struct {
	SSHRequest
	BaseURL          string
	NodeID           string
	RemoveNodeRecord bool
}

type Runner interface {
	Install(ctx context.Context, request InstallRequest, emit EmitFunc) (string, error)
	Uninstall(ctx context.Context, request UninstallRequest, emit EmitFunc) error
}

func InstallCommand(request InstallRequest) string {
	lines := []string{
		`script="$(mktemp /tmp/mizupanel-install-agent.XXXXXX)"`,
		`trap 'rm -f "$script"' EXIT`,
		fmt.Sprintf("curl -fsSL %s -o \"$script\"", shellQuote(request.BaseURL+"/scripts/install-agent.sh")),
		`chmod 700 "$script"`,
	}
	if strings.TrimSpace(request.NodeID) == "" {
		lines = append(lines, `NODE_ID="${NODE_ID:-$(hostname)}"`)
	}
	if strings.TrimSpace(request.Name) == "" {
		lines = append(lines, `NODE_NAME="${NODE_NAME:-$NODE_ID}"`)
	}
	lines = append(lines, strings.Join(installCommandArgs(request), " "))
	return strings.Join(lines, " && ")
}

func installCommandArgs(request InstallRequest) []string {
	mode := request.Mode
	if mode == "" {
		mode = "normal"
	}
	nodeID := shellQuote(request.NodeID)
	if strings.TrimSpace(request.NodeID) == "" {
		nodeID = `"$NODE_ID"`
	}
	name := shellQuote(request.Name)
	if strings.TrimSpace(request.Name) == "" {
		name = `"$NODE_NAME"`
	}
	args := []string{
		`"$script"`,
		"--binary-base-url", shellQuote(request.BaseURL + "/downloads"),
		"--server-url", shellQuote(request.ServerURL),
		"--token", shellQuote(request.Token),
		"--mode", shellQuote(mode),
		"--node-id", nodeID,
		"--name", name,
	}
	if request.EnableDocker {
		args = append(args, "--enable-docker")
	}
	if request.EnableTerminal {
		args = append(args, "--enable-terminal")
	}
	return args
}

func UninstallCommand(request UninstallRequest) string {
	lines := []string{
		`script="$(mktemp /tmp/mizupanel-uninstall-agent.XXXXXX)"`,
		`trap 'rm -f "$script"' EXIT`,
		fmt.Sprintf("curl -fsSL %s -o \"$script\"", shellQuote(request.BaseURL+"/scripts/uninstall-agent.sh")),
		`chmod 700 "$script"`,
		`"$script"`,
	}
	return strings.Join(lines, " && ")
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

type CommandRunner struct{}

func NewCommandRunner() *CommandRunner {
	return &CommandRunner{}
}

func (r *CommandRunner) Install(ctx context.Context, request InstallRequest, emit EmitFunc) (string, error) {
	if err := ValidateSSHRequest(&request.SSHRequest); err != nil {
		return "", err
	}
	emit(ProgressEvent{Step: "connect_ssh", Label: "连接 SSH", Status: ProgressRunning, Message: fmt.Sprintf("正在连接 root@%s:%d", request.Host, request.Port)})
	client, err := dialSSH(ctx, request.SSHRequest)
	if err != nil {
		return "", err
	}
	defer client.Close()
	emit(ProgressEvent{Step: "connect_ssh", Label: "连接 SSH", Status: ProgressSuccess, Message: "SSH 已连接"})
	emit(ProgressEvent{Step: "check_root", Label: "检查 root 权限", Status: ProgressRunning, Message: "正在检查远端执行用户"})
	if err := runRemoteCommand(ctx, client, "test \"$(id -u)\" = \"0\""); err != nil {
		return "", fmt.Errorf("remote user is not root")
	}
	emit(ProgressEvent{Step: "check_root", Label: "检查 root 权限", Status: ProgressSuccess, Message: "远端用户为 root"})
	resolvedNodeID := strings.TrimSpace(request.NodeID)
	if resolvedNodeID == "" {
		emit(ProgressEvent{Step: "resolve_hostname", Label: "读取远端 hostname", Status: ProgressRunning, Message: "正在读取远端 hostname 作为节点 ID"})
		resolvedNodeID, err = runRemoteOutput(ctx, client, "hostname")
		if err != nil {
			return "", err
		}
		resolvedNodeID = strings.TrimSpace(resolvedNodeID)
		if resolvedNodeID == "" {
			return "", fmt.Errorf("remote hostname is empty")
		}
		request.NodeID = resolvedNodeID
		if strings.TrimSpace(request.Name) == "" {
			request.Name = resolvedNodeID
		}
		emit(ProgressEvent{Step: "resolve_hostname", Label: "读取远端 hostname", Status: ProgressSuccess, Message: "已使用远端 hostname 作为节点 ID"})
	}
	emit(ProgressEvent{Step: "run_install", Label: "执行安装", Status: ProgressRunning, Message: "正在执行 Agent 安装脚本"})
	if err := runRemoteCommand(ctx, client, InstallCommand(request)); err != nil {
		return "", err
	}
	emit(ProgressEvent{Step: "run_install", Label: "执行安装", Status: ProgressSuccess, Message: "Agent 安装脚本执行完成"})
	emit(ProgressEvent{Step: "wait_agent", Label: "等待 Agent 上线", Status: ProgressSuccess, Message: "安装命令已完成，请等待 Agent 主动连接"})
	return resolvedNodeID, nil
}

func (r *CommandRunner) Uninstall(ctx context.Context, request UninstallRequest, emit EmitFunc) error {
	if err := ValidateSSHRequest(&request.SSHRequest); err != nil {
		return err
	}
	emit(ProgressEvent{Step: "connect_ssh", Label: "连接 SSH", Status: ProgressRunning, Message: fmt.Sprintf("正在连接 root@%s:%d", request.Host, request.Port)})
	client, err := dialSSH(ctx, request.SSHRequest)
	if err != nil {
		return err
	}
	defer client.Close()
	emit(ProgressEvent{Step: "connect_ssh", Label: "连接 SSH", Status: ProgressSuccess, Message: "SSH 已连接"})
	emit(ProgressEvent{Step: "check_root", Label: "检查 root 权限", Status: ProgressRunning, Message: "正在检查远端执行用户"})
	if err := runRemoteCommand(ctx, client, "test \"$(id -u)\" = \"0\""); err != nil {
		return fmt.Errorf("remote user is not root")
	}
	emit(ProgressEvent{Step: "check_root", Label: "检查 root 权限", Status: ProgressSuccess, Message: "远端用户为 root"})
	emit(ProgressEvent{Step: "run_uninstall", Label: "执行卸载", Status: ProgressRunning, Message: "正在执行 Agent 卸载脚本"})
	if err := runRemoteCommand(ctx, client, UninstallCommand(request)); err != nil {
		return err
	}
	emit(ProgressEvent{Step: "run_uninstall", Label: "执行卸载", Status: ProgressSuccess, Message: "Agent 卸载脚本执行完成"})
	return nil
}

func dialSSH(ctx context.Context, request SSHRequest) (*ssh.Client, error) {
	config, err := ClientConfig(request)
	if err != nil {
		return nil, err
	}
	type result struct {
		client *ssh.Client
		err    error
	}
	ch := make(chan result, 1)
	go func() {
		client, err := ssh.Dial("tcp", fmt.Sprintf("%s:%d", request.Host, request.Port), config)
		ch <- result{client: client, err: err}
	}()
	select {
	case result := <-ch:
		return result.client, result.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func runRemoteCommand(ctx context.Context, client *ssh.Client, command string) error {
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()
	type result struct {
		output []byte
		err    error
	}
	ch := make(chan result, 1)
	go func() {
		output, err := session.CombinedOutput(command)
		ch <- result{output: output, err: err}
	}()
	select {
	case result := <-ch:
		if result.err != nil {
			return remoteCommandError(result.output, result.err)
		}
		return nil
	case <-ctx.Done():
		_ = session.Close()
		return ctx.Err()
	}
}

func remoteCommandError(output []byte, err error) error {
	message := strings.TrimSpace(string(output))
	if message == "" {
		return err
	}
	return fmt.Errorf("%w: %s", err, message)
}

func runRemoteOutput(ctx context.Context, client *ssh.Client, command string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()
	type result struct {
		output []byte
		err    error
	}
	ch := make(chan result, 1)
	go func() {
		output, err := session.Output(command)
		ch <- result{output: output, err: err}
	}()
	select {
	case result := <-ch:
		return string(result.output), result.err
	case <-ctx.Done():
		_ = session.Close()
		return "", ctx.Err()
	}
}
