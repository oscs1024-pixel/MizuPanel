package kubectl

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/yaml"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

// Client Kubernetes client-go 客户端封装
type Client struct {
	clientset kubernetes.Interface
	dynamic   dynamic.Interface
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
	dynamicClient, err := dynamic.NewForConfig(resetConfig)
	if err != nil {
		return nil, fmt.Errorf("创建 Kubernetes dynamic 客户端失败: %w", err)
	}
	return &Client{clientset: clientset, dynamic: dynamicClient, context: contextName}, nil
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

func labelSelectorText(selector *metav1.LabelSelector) string {
	if selector == nil {
		return ""
	}
	parsed, err := metav1.LabelSelectorAsSelector(selector)
	if err != nil {
		return ""
	}
	return parsed.String()
}

func objectYAML(value interface{}) (string, error) {
	switch item := value.(type) {
	case *corev1.Pod:
		copy := item.DeepCopy()
		copy.APIVersion = corev1.SchemeGroupVersion.String()
		copy.Kind = "Pod"
		sanitizeObjectMeta(&copy.ObjectMeta)
		value = copy
	case *appsv1.Deployment:
		copy := item.DeepCopy()
		copy.APIVersion = appsv1.SchemeGroupVersion.String()
		copy.Kind = "Deployment"
		sanitizeObjectMeta(&copy.ObjectMeta)
		value = copy
	case *appsv1.StatefulSet:
		copy := item.DeepCopy()
		copy.APIVersion = appsv1.SchemeGroupVersion.String()
		copy.Kind = "StatefulSet"
		sanitizeObjectMeta(&copy.ObjectMeta)
		value = copy
	case *appsv1.DaemonSet:
		copy := item.DeepCopy()
		copy.APIVersion = appsv1.SchemeGroupVersion.String()
		copy.Kind = "DaemonSet"
		sanitizeObjectMeta(&copy.ObjectMeta)
		value = copy
	}
	data, err := yaml.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("序列化 YAML 失败: %w", err)
	}
	return string(data), nil
}

func sanitizeObjectMeta(meta *metav1.ObjectMeta) {
	meta.ManagedFields = nil
	meta.ResourceVersion = ""
	meta.UID = ""
	meta.Generation = 0
	meta.SelfLink = ""
}

func eventsToProtocol(events []corev1.Event) []protocol.K8sEvent {
	out := make([]protocol.K8sEvent, 0, len(events))
	for _, event := range events {
		out = append(out, protocol.K8sEvent{
			Type:    event.Type,
			Reason:  event.Reason,
			Message: event.Message,
			Count:   event.Count,
			Age:     formatAge(event.LastTimestamp),
		})
	}
	return out
}

func podContainerState(status corev1.ContainerStatus) string {
	switch {
	case status.State.Running != nil:
		return "Running"
	case status.State.Waiting != nil:
		return "Waiting"
	case status.State.Terminated != nil:
		return "Terminated"
	default:
		return ""
	}
}

func podDiagnosticsFromObject(pod *corev1.Pod, events []corev1.Event) (*protocol.K8sDiagnostics, error) {
	body, err := objectYAML(pod)
	if err != nil {
		return nil, err
	}
	containers := make([]protocol.K8sContainerDetail, 0, len(pod.Status.ContainerStatuses))
	statusByName := make(map[string]corev1.ContainerStatus, len(pod.Status.ContainerStatuses))
	for _, status := range pod.Status.ContainerStatuses {
		statusByName[status.Name] = status
	}
	for _, container := range pod.Spec.Containers {
		status := statusByName[container.Name]
		containers = append(containers, protocol.K8sContainerDetail{
			Name:         container.Name,
			Image:        container.Image,
			Ready:        status.Ready,
			RestartCount: status.RestartCount,
			State:        podContainerState(status),
		})
	}
	conditions := make([]protocol.K8sCondition, 0, len(pod.Status.Conditions))
	for _, condition := range pod.Status.Conditions {
		conditions = append(conditions, protocol.K8sCondition{Type: string(condition.Type), Status: string(condition.Status), Reason: condition.Reason, Message: condition.Message})
	}
	describe := fmt.Sprintf(
		"Name: %s\nNamespace: %s\nStatus: %s\nNode: %s\nIP: %s\nContainers:\n%s\nConditions: %d\nEvents: %d\n",
		pod.Name,
		pod.Namespace,
		pod.Status.Phase,
		pod.Spec.NodeName,
		pod.Status.PodIP,
		describeContainers(containers),
		len(conditions),
		len(events),
	)
	return &protocol.K8sDiagnostics{
		Kind:       "pod",
		Namespace:  pod.Namespace,
		Name:       pod.Name,
		Status:     string(pod.Status.Phase),
		Age:        formatAge(pod.CreationTimestamp),
		Node:       pod.Spec.NodeName,
		IP:         pod.Status.PodIP,
		Metadata:   pod.Labels,
		Summary:    map[string]string{"node": pod.Spec.NodeName, "pod_ip": pod.Status.PodIP},
		Containers: containers,
		Conditions: conditions,
		Events:     eventsToProtocol(events),
		YAML:       body,
		Describe:   describe,
	}, nil
}

func describeContainers(containers []protocol.K8sContainerDetail) string {
	if len(containers) == 0 {
		return "  <none>"
	}
	lines := make([]string, 0, len(containers))
	for _, container := range containers {
		lines = append(lines, fmt.Sprintf("  %s: image=%s ready=%t restarts=%d state=%s", container.Name, container.Image, container.Ready, container.RestartCount, container.State))
	}
	return strings.Join(lines, "\n")
}

func deploymentDiagnosticsFromObject(deployment *appsv1.Deployment, events []corev1.Event) (*protocol.K8sDiagnostics, error) {
	body, err := objectYAML(deployment)
	if err != nil {
		return nil, err
	}
	replicas := int32PtrValue(deployment.Spec.Replicas)
	selector := labelSelectorText(deployment.Spec.Selector)
	describe := fmt.Sprintf(
		"Name: %s\nNamespace: %s\nSelector: %s\nReplicas: %d desired | %d updated | %d available\nEvents: %d\n",
		deployment.Name,
		deployment.Namespace,
		selector,
		replicas,
		deployment.Status.UpdatedReplicas,
		deployment.Status.AvailableReplicas,
		len(events),
	)
	return &protocol.K8sDiagnostics{
		Kind:      "deployment",
		Namespace: deployment.Namespace,
		Name:      deployment.Name,
		Status:    fmt.Sprintf("%d/%d ready", deployment.Status.ReadyReplicas, replicas),
		Age:       formatAge(deployment.CreationTimestamp),
		Metadata:  deployment.Labels,
		Summary: map[string]string{
			"replicas":  fmt.Sprintf("%d", replicas),
			"ready":     fmt.Sprintf("%d", deployment.Status.ReadyReplicas),
			"updated":   fmt.Sprintf("%d", deployment.Status.UpdatedReplicas),
			"available": fmt.Sprintf("%d", deployment.Status.AvailableReplicas),
			"selector":  selector,
		},
		Events:   eventsToProtocol(events),
		YAML:     body,
		Describe: describe,
	}, nil
}

func statefulSetDiagnosticsFromObject(statefulSet *appsv1.StatefulSet, events []corev1.Event) (*protocol.K8sDiagnostics, error) {
	body, err := objectYAML(statefulSet)
	if err != nil {
		return nil, err
	}
	replicas := int32PtrValue(statefulSet.Spec.Replicas)
	selector := labelSelectorText(statefulSet.Spec.Selector)
	return &protocol.K8sDiagnostics{
		Kind:      "statefulset",
		Namespace: statefulSet.Namespace,
		Name:      statefulSet.Name,
		Status:    fmt.Sprintf("%d/%d ready", statefulSet.Status.ReadyReplicas, replicas),
		Age:       formatAge(statefulSet.CreationTimestamp),
		Metadata:  statefulSet.Labels,
		Summary: map[string]string{
			"replicas":     fmt.Sprintf("%d", replicas),
			"ready":        fmt.Sprintf("%d", statefulSet.Status.ReadyReplicas),
			"service_name": statefulSet.Spec.ServiceName,
			"selector":     selector,
		},
		Events:   eventsToProtocol(events),
		YAML:     body,
		Describe: fmt.Sprintf("Name: %s\nNamespace: %s\nSelector: %s\nService: %s\nReplicas: %d desired | %d ready\nEvents: %d\n", statefulSet.Name, statefulSet.Namespace, selector, statefulSet.Spec.ServiceName, replicas, statefulSet.Status.ReadyReplicas, len(events)),
	}, nil
}

func daemonSetDiagnosticsFromObject(daemonSet *appsv1.DaemonSet, events []corev1.Event) (*protocol.K8sDiagnostics, error) {
	body, err := objectYAML(daemonSet)
	if err != nil {
		return nil, err
	}
	selector := labelSelectorText(daemonSet.Spec.Selector)
	return &protocol.K8sDiagnostics{
		Kind:      "daemonset",
		Namespace: daemonSet.Namespace,
		Name:      daemonSet.Name,
		Status:    fmt.Sprintf("%d/%d ready", daemonSet.Status.NumberReady, daemonSet.Status.DesiredNumberScheduled),
		Age:       formatAge(daemonSet.CreationTimestamp),
		Metadata:  daemonSet.Labels,
		Summary: map[string]string{
			"desired":   fmt.Sprintf("%d", daemonSet.Status.DesiredNumberScheduled),
			"current":   fmt.Sprintf("%d", daemonSet.Status.CurrentNumberScheduled),
			"ready":     fmt.Sprintf("%d", daemonSet.Status.NumberReady),
			"available": fmt.Sprintf("%d", daemonSet.Status.NumberAvailable),
			"selector":  selector,
		},
		Events:   eventsToProtocol(events),
		YAML:     body,
		Describe: fmt.Sprintf("Name: %s\nNamespace: %s\nSelector: %s\nDesired: %d\nCurrent: %d\nReady: %d\nAvailable: %d\nEvents: %d\n", daemonSet.Name, daemonSet.Namespace, selector, daemonSet.Status.DesiredNumberScheduled, daemonSet.Status.CurrentNumberScheduled, daemonSet.Status.NumberReady, daemonSet.Status.NumberAvailable, len(events)),
	}, nil
}

func (c *Client) ensureClientset() error {
	if c.clientset == nil {
		return fmt.Errorf("Kubernetes 客户端未初始化")
	}
	return nil
}

func (c *Client) ensureDynamic() error {
	if c.dynamic == nil {
		return fmt.Errorf("Kubernetes dynamic 客户端未初始化")
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

func (c *Client) resourceEvents(ctx context.Context, namespace, kind, name string) ([]corev1.Event, error) {
	if err := c.ensureClientset(); err != nil {
		return nil, err
	}
	selector := fields.AndSelectors(
		fields.OneTermEqualSelector("involvedObject.kind", kind),
		fields.OneTermEqualSelector("involvedObject.name", name),
	)
	items, err := c.clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{FieldSelector: selector.String()})
	if err != nil {
		return nil, fmt.Errorf("获取事件列表失败: %w", err)
	}
	return items.Items, nil
}

func (c *Client) GetDiagnostics(ctx context.Context, kind, namespace, name string) (*protocol.K8sDiagnostics, error) {
	if err := c.ensureClientset(); err != nil {
		return nil, err
	}
	kind = strings.ToLower(strings.TrimSpace(kind))
	namespace = strings.TrimSpace(namespace)
	name = strings.TrimSpace(name)
	if namespace == "" {
		return nil, fmt.Errorf("命名空间不能为空")
	}
	if name == "" {
		return nil, fmt.Errorf("资源名称不能为空")
	}

	switch kind {
	case "pod":
		pod, err := c.clientset.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("获取 Pod 失败: %w", err)
		}
		events, err := c.resourceEvents(ctx, namespace, "Pod", name)
		if err != nil {
			return nil, err
		}
		return podDiagnosticsFromObject(pod, events)
	case "deployment":
		deployment, err := c.clientset.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("获取 Deployment 失败: %w", err)
		}
		events, err := c.resourceEvents(ctx, namespace, "Deployment", name)
		if err != nil {
			return nil, err
		}
		return deploymentDiagnosticsFromObject(deployment, events)
	case "statefulset":
		statefulSet, err := c.clientset.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("获取 StatefulSet 失败: %w", err)
		}
		events, err := c.resourceEvents(ctx, namespace, "StatefulSet", name)
		if err != nil {
			return nil, err
		}
		return statefulSetDiagnosticsFromObject(statefulSet, events)
	case "daemonset":
		daemonSet, err := c.clientset.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, fmt.Errorf("获取 DaemonSet 失败: %w", err)
		}
		events, err := c.resourceEvents(ctx, namespace, "DaemonSet", name)
		if err != nil {
			return nil, err
		}
		return daemonSetDiagnosticsFromObject(daemonSet, events)
	default:
		return nil, fmt.Errorf("不支持的资源类型: %s", kind)
	}
}

func normalizeResourceIdentity(kind, namespace, name string) (string, string, string) {
	return strings.ToLower(strings.TrimSpace(kind)), strings.TrimSpace(namespace), strings.TrimSpace(name)
}

func actionResult(requestID, message string) *protocol.K8sResourceActionResult {
	return &protocol.K8sResourceActionResult{Type: protocol.MessageTypeK8sResourceActionResult, RequestID: requestID, Success: true, Message: message}
}

func (c *Client) ExecuteResourceAction(ctx context.Context, req protocol.K8sResourceActionRequest) (*protocol.K8sResourceActionResult, error) {
	kind, namespace, name := normalizeResourceIdentity(req.Kind, req.Namespace, req.Name)
	action := strings.ToLower(strings.TrimSpace(req.Action))
	if namespace == "" {
		return nil, fmt.Errorf("命名空间不能为空")
	}
	if name == "" {
		return nil, fmt.Errorf("资源名称不能为空")
	}

	switch action {
	case "delete":
		if kind != "pod" {
			return nil, fmt.Errorf("不支持删除 %s", kind)
		}
		if err := c.deletePod(ctx, namespace, name); err != nil {
			return nil, err
		}
		return actionResult(req.RequestID, "Pod删除成功"), nil
	case "restart":
		if err := c.restartWorkload(ctx, kind, namespace, name); err != nil {
			return nil, err
		}
		return actionResult(req.RequestID, "重启成功"), nil
	case "scale":
		if req.Replicas == nil {
			return nil, fmt.Errorf("副本数不能为空")
		}
		if *req.Replicas < 0 {
			return nil, fmt.Errorf("副本数不能小于 0")
		}
		if err := c.scaleWorkload(ctx, kind, namespace, name, *req.Replicas); err != nil {
			return nil, err
		}
		return actionResult(req.RequestID, "扩缩容成功"), nil
	case "dry_run_apply":
		if err := c.applyYAML(ctx, kind, namespace, name, req.YAML, true); err != nil {
			return nil, err
		}
		return actionResult(req.RequestID, "Dry Run通过"), nil
	case "apply":
		if err := c.applyYAML(ctx, kind, namespace, name, req.YAML, false); err != nil {
			return nil, err
		}
		return actionResult(req.RequestID, "YAML应用成功"), nil
	default:
		return nil, fmt.Errorf("不支持的操作: %s", req.Action)
	}
}

func (c *Client) deletePod(ctx context.Context, namespace, name string) error {
	if err := c.ensureClientset(); err != nil {
		return err
	}
	if err := c.clientset.CoreV1().Pods(namespace).Delete(ctx, name, metav1.DeleteOptions{}); err != nil {
		return fmt.Errorf("删除 Pod 失败: %w", err)
	}
	return nil
}

func (c *Client) restartWorkload(ctx context.Context, kind, namespace, name string) error {
	if err := c.ensureClientset(); err != nil {
		return err
	}
	restartedAt := time.Now().UTC().Format(time.RFC3339)
	switch kind {
	case "deployment":
		item, err := c.clientset.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("获取 Deployment 失败: %w", err)
		}
		ensureAnnotations(&item.Spec.Template.ObjectMeta)["kubectl.kubernetes.io/restartedAt"] = restartedAt
		if _, err := c.clientset.AppsV1().Deployments(namespace).Update(ctx, item, metav1.UpdateOptions{}); err != nil {
			return fmt.Errorf("重启 Deployment 失败: %w", err)
		}
	case "statefulset":
		item, err := c.clientset.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("获取 StatefulSet 失败: %w", err)
		}
		ensureAnnotations(&item.Spec.Template.ObjectMeta)["kubectl.kubernetes.io/restartedAt"] = restartedAt
		if _, err := c.clientset.AppsV1().StatefulSets(namespace).Update(ctx, item, metav1.UpdateOptions{}); err != nil {
			return fmt.Errorf("重启 StatefulSet 失败: %w", err)
		}
	case "daemonset":
		item, err := c.clientset.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("获取 DaemonSet 失败: %w", err)
		}
		ensureAnnotations(&item.Spec.Template.ObjectMeta)["kubectl.kubernetes.io/restartedAt"] = restartedAt
		if _, err := c.clientset.AppsV1().DaemonSets(namespace).Update(ctx, item, metav1.UpdateOptions{}); err != nil {
			return fmt.Errorf("重启 DaemonSet 失败: %w", err)
		}
	default:
		return fmt.Errorf("不支持重启 %s", kind)
	}
	return nil
}

func ensureAnnotations(meta *metav1.ObjectMeta) map[string]string {
	if meta.Annotations == nil {
		meta.Annotations = make(map[string]string)
	}
	return meta.Annotations
}

func (c *Client) scaleWorkload(ctx context.Context, kind, namespace, name string, replicas int32) error {
	if err := c.ensureClientset(); err != nil {
		return err
	}
	switch kind {
	case "deployment":
		item, err := c.clientset.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("获取 Deployment 失败: %w", err)
		}
		item.Spec.Replicas = &replicas
		if _, err := c.clientset.AppsV1().Deployments(namespace).Update(ctx, item, metav1.UpdateOptions{}); err != nil {
			return fmt.Errorf("扩缩容 Deployment 失败: %w", err)
		}
	case "statefulset":
		item, err := c.clientset.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("获取 StatefulSet 失败: %w", err)
		}
		item.Spec.Replicas = &replicas
		if _, err := c.clientset.AppsV1().StatefulSets(namespace).Update(ctx, item, metav1.UpdateOptions{}); err != nil {
			return fmt.Errorf("扩缩容 StatefulSet 失败: %w", err)
		}
	default:
		return fmt.Errorf("不支持扩缩容 %s", kind)
	}
	return nil
}

func resourceGVR(kind string) (schema.GroupVersionResource, error) {
	switch kind {
	case "pod":
		return schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}, nil
	case "deployment":
		return schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}, nil
	case "statefulset":
		return schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "statefulsets"}, nil
	case "daemonset":
		return schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "daemonsets"}, nil
	default:
		return schema.GroupVersionResource{}, fmt.Errorf("不支持应用 %s", kind)
	}
}

func (c *Client) applyYAML(ctx context.Context, kind, namespace, name, body string, dryRun bool) error {
	if err := c.ensureDynamic(); err != nil {
		return err
	}
	if strings.TrimSpace(body) == "" {
		return fmt.Errorf("YAML 内容不能为空")
	}
	jsonBody, err := yaml.YAMLToJSON([]byte(body))
	if err != nil {
		return fmt.Errorf("解析 YAML 失败: %w", err)
	}
	obj := &unstructured.Unstructured{}
	if err := obj.UnmarshalJSON(jsonBody); err != nil {
		return fmt.Errorf("解析 YAML 失败: %w", err)
	}
	objKind, objNamespace, objName := normalizeResourceIdentity(obj.GetKind(), obj.GetNamespace(), obj.GetName())
	if objNamespace == "" {
		objNamespace = namespace
		obj.SetNamespace(namespace)
	}
	if objKind != kind || objNamespace != namespace || objName != name {
		return fmt.Errorf("YAML 资源与当前对象不一致")
	}
	sanitizeApplyObject(obj)
	gvr, err := resourceGVR(kind)
	if err != nil {
		return err
	}
	options := metav1.PatchOptions{FieldManager: "mizupanel"}
	if dryRun {
		options.DryRun = []string{metav1.DryRunAll}
	}
	applyBody, err := obj.MarshalJSON()
	if err != nil {
		return fmt.Errorf("序列化 YAML 失败: %w", err)
	}
	if _, err := c.dynamic.Resource(gvr).Namespace(namespace).Patch(ctx, name, types.ApplyPatchType, applyBody, options); err != nil {
		if dryRun {
			return fmt.Errorf("Dry Run 失败: %w", err)
		}
		return fmt.Errorf("应用 YAML 失败: %w", err)
	}
	return nil
}

func sanitizeApplyObject(obj *unstructured.Unstructured) {
	unstructured.RemoveNestedField(obj.Object, "metadata", "managedFields")
	unstructured.RemoveNestedField(obj.Object, "metadata", "resourceVersion")
	unstructured.RemoveNestedField(obj.Object, "metadata", "uid")
	unstructured.RemoveNestedField(obj.Object, "metadata", "generation")
	unstructured.RemoveNestedField(obj.Object, "metadata", "selfLink")
	unstructured.RemoveNestedField(obj.Object, "metadata", "creationTimestamp")
	unstructured.RemoveNestedField(obj.Object, "status")
}
