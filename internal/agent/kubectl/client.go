package kubectl

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

// Client kubectl 客户端封装
type Client struct {
	kubeconfigPath string
	context        string
}

// NewClient 创建 kubectl 客户端
func NewClient(kubeconfigPath, context string) *Client {
	return &Client{
		kubeconfigPath: kubeconfigPath,
		context:        context,
	}
}

// buildCommand 构造 kubectl 命令
func (c *Client) buildCommand(ctx context.Context, args ...string) *exec.Cmd {
	cmdArgs := []string{"--kubeconfig", c.kubeconfigPath}
	if c.context != "" {
		cmdArgs = append(cmdArgs, "--context", c.context)
	}
	cmdArgs = append(cmdArgs, args...)
	return exec.CommandContext(ctx, "kubectl", cmdArgs...)
}

// execCommand 执行 kubectl 命令并返回输出
func (c *Client) execCommand(ctx context.Context, args ...string) (string, error) {
	cmd := c.buildCommand(ctx, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("kubectl 命令执行失败: %w, 输出: %s", err, string(output))
	}
	return string(output), nil
}

// GetClusterInfo 获取集群信息
func (c *Client) GetClusterInfo(ctx context.Context) (*ClusterInfo, error) {
	info := &ClusterInfo{}

	// 获取 K8s 版本
	versionOutput, err := c.execCommand(ctx, "version", "--output=json", "--short")
	if err != nil {
		return nil, fmt.Errorf("获取集群版本失败: %w", err)
	}

	var versionData struct {
		ServerVersion struct {
			GitVersion string `json:"gitVersion"`
		} `json:"serverVersion"`
	}
	if err := json.Unmarshal([]byte(versionOutput), &versionData); err != nil {
		// 如果 JSON 解析失败，尝试从文本输出中提取版本
		lines := strings.Split(versionOutput, "\n")
		for _, line := range lines {
			if strings.Contains(line, "Server Version") {
				parts := strings.Fields(line)
				if len(parts) >= 3 {
					info.Version = parts[2]
				}
			}
		}
		if info.Version == "" {
			info.Version = "unknown"
		}
	} else {
		info.Version = versionData.ServerVersion.GitVersion
	}

	// 获取节点数量
	nodesOutput, err := c.execCommand(ctx, "get", "nodes", "--output=json")
	if err != nil {
		return nil, fmt.Errorf("获取节点列表失败: %w", err)
	}

	var nodesList struct {
		Items []interface{} `json:"items"`
	}
	if err := json.Unmarshal([]byte(nodesOutput), &nodesList); err != nil {
		return nil, fmt.Errorf("解析节点列表失败: %w", err)
	}
	info.NodeCount = len(nodesList.Items)

	// 获取命名空间数量
	namespacesOutput, err := c.execCommand(ctx, "get", "namespaces", "--output=json")
	if err != nil {
		return nil, fmt.Errorf("获取命名空间列表失败: %w", err)
	}

	var namespacesList struct {
		Items []interface{} `json:"items"`
	}
	if err := json.Unmarshal([]byte(namespacesOutput), &namespacesList); err != nil {
		return nil, fmt.Errorf("解析命名空间列表失败: %w", err)
	}
	info.NamespaceCount = len(namespacesList.Items)

	return info, nil
}

// GetPods 获取 Pod 列表
func (c *Client) GetPods(ctx context.Context, namespace string) ([]Pod, error) {
	args := []string{"get", "pods", "--output=json"}
	if namespace != "" {
		args = append(args, "-n", namespace)
	} else {
		args = append(args, "--all-namespaces")
	}

	output, err := c.execCommand(ctx, args...)
	if err != nil {
		return nil, fmt.Errorf("获取 Pod 列表失败: %w", err)
	}

	var podsList struct {
		Items []struct {
			Metadata struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"metadata"`
			Status struct {
				Phase             string `json:"phase"`
				PodIP             string `json:"podIP"`
				ContainerStatuses []struct {
					Ready        bool `json:"ready"`
					RestartCount int  `json:"restartCount"`
				} `json:"containerStatuses"`
				StartTime string `json:"startTime"`
			} `json:"status"`
			Spec struct {
				NodeName string `json:"nodeName"`
			} `json:"spec"`
		} `json:"items"`
	}

	if err := json.Unmarshal([]byte(output), &podsList); err != nil {
		return nil, fmt.Errorf("解析 Pod 列表失败: %w", err)
	}

	pods := make([]Pod, 0, len(podsList.Items))
	for _, item := range podsList.Items {
		pod := Pod{
			Name:      item.Metadata.Name,
			Namespace: item.Metadata.Namespace,
			Status:    item.Status.Phase,
			Node:      item.Spec.NodeName,
			IP:        item.Status.PodIP,
		}

		// 计算就绪状态
		readyCount := 0
		totalCount := len(item.Status.ContainerStatuses)
		totalRestarts := 0
		for _, cs := range item.Status.ContainerStatuses {
			if cs.Ready {
				readyCount++
			}
			totalRestarts += cs.RestartCount
		}
		pod.Ready = fmt.Sprintf("%d/%d", readyCount, totalCount)
		pod.Restarts = totalRestarts

		// 计算运行时间
		pod.Age = calculateAge(item.Status.StartTime)

		pods = append(pods, pod)
	}

	return pods, nil
}

// GetPodLogs 获取 Pod 日志
func (c *Client) GetPodLogs(ctx context.Context, namespace, podName, container string, follow bool, tailLines int) (string, error) {
	args := []string{"logs", "-n", namespace, podName}
	if container != "" {
		args = append(args, "-c", container)
	}
	if tailLines > 0 {
		args = append(args, fmt.Sprintf("--tail=%d", tailLines))
	}
	if follow {
		args = append(args, "--follow")
	}

	output, err := c.execCommand(ctx, args...)
	if err != nil {
		return "", fmt.Errorf("获取 Pod 日志失败: %w", err)
	}

	return output, nil
}

// calculateAge 计算资源运行时间
func calculateAge(startTime string) string {
	// 简单实现，实际应该解析 ISO8601 时间并计算差值
	// 这里先返回原始时间，后续可以优化
	return startTime
}
