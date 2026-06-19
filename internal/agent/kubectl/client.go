package kubectl

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

// Client Kubernetes client-go 客户端封装
type Client struct {
	clientset *kubernetes.Clientset
	context   string
}

// NewClientFromKubeconfig 从 kubeconfig 内容创建 Kubernetes 客户端，不写入磁盘。
func NewClientFromKubeconfig(kubeconfigContent, contextName string) (*Client, error) {
	if strings.TrimSpace(kubeconfigContent) == "" {
		return nil, fmt.Errorf("kubeconfig 内容为空")
	}

	apiConfig, err := clientcmd.Load(bytes.NewBufferString(kubeconfigContent).Bytes())
	if err != nil {
		return nil, fmt.Errorf("解析 kubeconfig 失败: %w", err)
	}
	for userName, authInfo := range apiConfig.AuthInfos {
		if authInfo != nil && authInfo.Exec != nil {
			return nil, fmt.Errorf("不支持 kubeconfig exec 认证插件（用户 %q）", userName)
		}
	}
	if contextName != "" {
		apiConfig.CurrentContext = contextName
	}

	configOverrides := &clientcmd.ConfigOverrides{}
	if contextName != "" {
		configOverrides.CurrentContext = contextName
	}
	clientConfig := clientcmd.NewDefaultClientConfig(*apiConfig, configOverrides)
	resetConfig, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("创建 Kubernetes 配置失败: %w", err)
	}
	resetConfig.Timeout = 15 * time.Second

	clientset, err := kubernetes.NewForConfig(resetConfig)
	if err != nil {
		return nil, fmt.Errorf("创建 Kubernetes 客户端失败: %w", err)
	}
	return &Client{clientset: clientset, context: contextName}, nil
}

// NewClient 保留旧构造函数名称以兼容现有调用；内容型请求应使用 NewClientFromKubeconfig。
func NewClient(kubeconfigPath, contextName string) *Client {
	return &Client{context: contextName}
}

func namespaceOrAll(namespace string) string {
	if namespace == "" {
		return metav1.NamespaceAll
	}
	return namespace
}

func formatAge(t metav1.Time) string {
	if t.IsZero() {
		return ""
	}
	seconds := int64(time.Since(t.Time).Seconds())
	if seconds < 0 {
		seconds = 0
	}
	return formatAgeFromSeconds(seconds)
}

func formatAgeFromSeconds(seconds int64) string {
	days := seconds / 86400
	if days > 0 {
		return fmt.Sprintf("%dd", days)
	}
	hours := seconds / 3600
	minutes := (seconds % 3600) / 60
	if hours > 0 {
		return fmt.Sprintf("%dh%dm", hours, minutes)
	}
	if minutes > 0 {
		return fmt.Sprintf("%dm", minutes)
	}
	return fmt.Sprintf("%ds", seconds)
}

func joinNonEmpty(values []string, separator string) string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, value)
		}
	}
	return strings.Join(result, separator)
}

func int32PtrValue(value *int32) int32 {
	if value == nil {
		return 0
	}
	return *value
}

func (c *Client) ensureClientset() error {
	if c.clientset == nil {
		return fmt.Errorf("Kubernetes 客户端未初始化")
	}
	return nil
}

func (c *Client) GetSummary(ctx context.Context) (*protocol.K8sResourceSummary, error) {
	if err := c.ensureClientset(); err != nil {
		return nil, err
	}
	version, err := c.clientset.Discovery().ServerVersion()
	if err != nil {
		return nil, fmt.Errorf("获取集群版本失败: %w", err)
	}
	nodes, err := c.clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取节点列表失败: %w", err)
	}
	ns, err := c.clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取命名空间列表失败: %w", err)
	}
	pods, err := c.clientset.CoreV1().Pods(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取 Pod 列表失败: %w", err)
	}
	deploy, err := c.clientset.AppsV1().Deployments(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取 Deployment 列表失败: %w", err)
	}
	sts, err := c.clientset.AppsV1().StatefulSets(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取 StatefulSet 列表失败: %w", err)
	}
	ds, err := c.clientset.AppsV1().DaemonSets(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取 DaemonSet 列表失败: %w", err)
	}
	svc, err := c.clientset.CoreV1().Services(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取 Service 列表失败: %w", err)
	}
	ing, err := c.clientset.NetworkingV1().Ingresses(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取 Ingress 列表失败: %w", err)
	}
	return &protocol.K8sResourceSummary{Version: version.GitVersion, NodeCount: len(nodes.Items), NamespaceCount: len(ns.Items), PodCount: len(pods.Items), DeploymentCount: len(deploy.Items), StatefulSetCount: len(sts.Items), DaemonSetCount: len(ds.Items), ServiceCount: len(svc.Items), IngressCount: len(ing.Items)}, nil
}

func (c *Client) GetClusterInfo(ctx context.Context) (*ClusterInfo, error) {
	summary, err := c.GetSummary(ctx)
	if err != nil {
		return nil, err
	}
	return &ClusterInfo{Version: summary.Version, NodeCount: summary.NodeCount, NamespaceCount: summary.NamespaceCount}, nil
}

func (c *Client) GetNamespaces(ctx context.Context) ([]protocol.K8sNamespace, error) {
	if err := c.ensureClientset(); err != nil {
		return nil, err
	}
	items, err := c.clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取命名空间列表失败: %w", err)
	}
	out := make([]protocol.K8sNamespace, 0, len(items.Items))
	for _, item := range items.Items {
		out = append(out, protocol.K8sNamespace{Name: item.Name, Status: string(item.Status.Phase), Age: formatAge(item.CreationTimestamp)})
	}
	return out, nil
}

func (c *Client) GetNodes(ctx context.Context) ([]protocol.K8sNode, error) {
	if err := c.ensureClientset(); err != nil {
		return nil, err
	}
	items, err := c.clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取节点列表失败: %w", err)
	}
	out := make([]protocol.K8sNode, 0, len(items.Items))
	for _, item := range items.Items {
		roles := make([]string, 0)
		for label := range item.Labels {
			if strings.HasPrefix(label, "node-role.kubernetes.io/") {
				role := strings.TrimPrefix(label, "node-role.kubernetes.io/")
				if role != "" {
					roles = append(roles, role)
				}
			}
		}
		sort.Strings(roles)
		roleText := strings.Join(roles, ",")
		if roleText == "" {
			roleText = "<none>"
		}
		status := "NotReady"
		for _, condition := range item.Status.Conditions {
			if condition.Type == corev1.NodeReady && condition.Status == corev1.ConditionTrue {
				status = "Ready"
				break
			}
		}
		ips := make([]string, 0)
		for _, address := range item.Status.Addresses {
			if address.Type == corev1.NodeInternalIP {
				ips = append(ips, address.Address)
			}
		}
		out = append(out, protocol.K8sNode{Name: item.Name, Status: status, Roles: roleText, Version: item.Status.NodeInfo.KubeletVersion, InternalIP: joinNonEmpty(ips, ","), PodCIDR: item.Spec.PodCIDR, Age: formatAge(item.CreationTimestamp)})
	}
	return out, nil
}

func (c *Client) GetPods(ctx context.Context, namespace string) ([]Pod, error) {
	protocolPods, err := c.GetProtocolPods(ctx, namespace)
	if err != nil {
		return nil, err
	}
	pods := make([]Pod, 0, len(protocolPods))
	for _, pod := range protocolPods {
		pods = append(pods, Pod{Name: pod.Name, Namespace: pod.Namespace, Status: pod.Status, Ready: pod.Ready, Restarts: pod.Restarts, Age: pod.Age, Node: pod.Node, IP: pod.IP})
	}
	return pods, nil
}

func (c *Client) GetProtocolPods(ctx context.Context, namespace string) ([]protocol.K8sPod, error) {
	if err := c.ensureClientset(); err != nil {
		return nil, err
	}
	items, err := c.clientset.CoreV1().Pods(namespaceOrAll(namespace)).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取 Pod 列表失败: %w", err)
	}
	out := make([]protocol.K8sPod, 0, len(items.Items))
	for _, item := range items.Items {
		ready, restarts := 0, 0
		for _, cs := range item.Status.ContainerStatuses {
			if cs.Ready {
				ready++
			}
			restarts += int(cs.RestartCount)
		}
		out = append(out, protocol.K8sPod{Name: item.Name, Namespace: item.Namespace, Status: string(item.Status.Phase), Ready: fmt.Sprintf("%d/%d", ready, len(item.Status.ContainerStatuses)), Restarts: restarts, Age: formatAge(item.CreationTimestamp), Node: item.Spec.NodeName, IP: item.Status.PodIP})
	}
	return out, nil
}

func (c *Client) GetDeployments(ctx context.Context, namespace string) ([]protocol.K8sDeployment, error) {
	if err := c.ensureClientset(); err != nil {
		return nil, err
	}
	items, err := c.clientset.AppsV1().Deployments(namespaceOrAll(namespace)).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取 Deployment 列表失败: %w", err)
	}
	out := make([]protocol.K8sDeployment, 0, len(items.Items))
	for _, item := range items.Items {
		out = append(out, protocol.K8sDeployment{Name: item.Name, Namespace: item.Namespace, Ready: fmt.Sprintf("%d/%d", item.Status.ReadyReplicas, int32PtrValue(item.Spec.Replicas)), UpToDate: item.Status.UpdatedReplicas, Available: item.Status.AvailableReplicas, Age: formatAge(item.CreationTimestamp)})
	}
	return out, nil
}

func (c *Client) GetStatefulSets(ctx context.Context, namespace string) ([]protocol.K8sStatefulSet, error) {
	if err := c.ensureClientset(); err != nil {
		return nil, err
	}
	items, err := c.clientset.AppsV1().StatefulSets(namespaceOrAll(namespace)).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取 StatefulSet 列表失败: %w", err)
	}
	out := make([]protocol.K8sStatefulSet, 0, len(items.Items))
	for _, item := range items.Items {
		out = append(out, protocol.K8sStatefulSet{Name: item.Name, Namespace: item.Namespace, Ready: fmt.Sprintf("%d/%d", item.Status.ReadyReplicas, int32PtrValue(item.Spec.Replicas)), ServiceName: item.Spec.ServiceName, Age: formatAge(item.CreationTimestamp)})
	}
	return out, nil
}

func (c *Client) GetDaemonSets(ctx context.Context, namespace string) ([]protocol.K8sDaemonSet, error) {
	if err := c.ensureClientset(); err != nil {
		return nil, err
	}
	items, err := c.clientset.AppsV1().DaemonSets(namespaceOrAll(namespace)).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取 DaemonSet 列表失败: %w", err)
	}
	out := make([]protocol.K8sDaemonSet, 0, len(items.Items))
	for _, item := range items.Items {
		out = append(out, protocol.K8sDaemonSet{Name: item.Name, Namespace: item.Namespace, Desired: item.Status.DesiredNumberScheduled, Current: item.Status.CurrentNumberScheduled, Ready: item.Status.NumberReady, Available: item.Status.NumberAvailable, Age: formatAge(item.CreationTimestamp)})
	}
	return out, nil
}

func (c *Client) GetServices(ctx context.Context, namespace string) ([]protocol.K8sService, error) {
	if err := c.ensureClientset(); err != nil {
		return nil, err
	}
	items, err := c.clientset.CoreV1().Services(namespaceOrAll(namespace)).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取 Service 列表失败: %w", err)
	}
	out := make([]protocol.K8sService, 0, len(items.Items))
	for _, item := range items.Items {
		ports := make([]string, 0, len(item.Spec.Ports))
		for _, port := range item.Spec.Ports {
			if port.NodePort > 0 {
				ports = append(ports, fmt.Sprintf("%d:%d/%s", port.Port, port.NodePort, port.Protocol))
			} else {
				ports = append(ports, fmt.Sprintf("%d/%s", port.Port, port.Protocol))
			}
		}
		external := append([]string{}, item.Spec.ExternalIPs...)
		for _, ingress := range item.Status.LoadBalancer.Ingress {
			external = append(external, ingress.IP, ingress.Hostname)
		}
		out = append(out, protocol.K8sService{Name: item.Name, Namespace: item.Namespace, Type: string(item.Spec.Type), ClusterIP: item.Spec.ClusterIP, ExternalIP: joinNonEmpty(external, ","), Ports: joinNonEmpty(ports, ","), Age: formatAge(item.CreationTimestamp)})
	}
	return out, nil
}

func (c *Client) GetIngresses(ctx context.Context, namespace string) ([]protocol.K8sIngress, error) {
	if err := c.ensureClientset(); err != nil {
		return nil, err
	}
	items, err := c.clientset.NetworkingV1().Ingresses(namespaceOrAll(namespace)).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("获取 Ingress 列表失败: %w", err)
	}
	out := make([]protocol.K8sIngress, 0, len(items.Items))
	for _, item := range items.Items {
		hosts := make([]string, 0)
		for _, rule := range item.Spec.Rules {
			hosts = append(hosts, rule.Host)
		}
		addresses := make([]string, 0)
		for _, ingress := range item.Status.LoadBalancer.Ingress {
			addresses = append(addresses, ingress.IP, ingress.Hostname)
		}
		ports := "80"
		for _, tls := range item.Spec.TLS {
			if len(tls.Hosts) > 0 {
				ports = "80,443"
				break
			}
		}
		className := ""
		if item.Spec.IngressClassName != nil {
			className = *item.Spec.IngressClassName
		}
		out = append(out, protocol.K8sIngress{Name: item.Name, Namespace: item.Namespace, Class: className, Hosts: joinNonEmpty(hosts, ","), Address: joinNonEmpty(addresses, ","), Ports: ports, Age: formatAge(item.CreationTimestamp)})
	}
	return out, nil
}

func (c *Client) GetPodLogs(ctx context.Context, namespace, podName, container string, follow bool, tailLines int) (string, error) {
	if err := c.ensureClientset(); err != nil {
		return "", err
	}
	request := c.clientset.CoreV1().Pods(namespace).GetLogs(podName, &corev1.PodLogOptions{Container: container, Follow: follow, TailLines: func() *int64 {
		if tailLines <= 0 {
			return nil
		}
		value := int64(tailLines)
		return &value
	}()})
	stream, err := request.Stream(ctx)
	if err != nil {
		return "", fmt.Errorf("获取 Pod 日志失败: %w", err)
	}
	defer stream.Close()
	content, err := io.ReadAll(stream)
	if err != nil {
		return "", fmt.Errorf("读取 Pod 日志失败: %w", err)
	}
	return string(content), nil
}
