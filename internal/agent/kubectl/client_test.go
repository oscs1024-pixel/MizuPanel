package kubectl

import (
	"context"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/dynamic"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	k8sfake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/mizupanel/mizupanel/internal/protocol"
)

func TestFormatAgeReturnsHumanReadableDuration(t *testing.T) {
	got := formatAgeFromSeconds(3661)
	if got != "1h1m" {
		t.Fatalf("expected 1h1m, got %q", got)
	}
}

func TestJoinNonEmptySkipsEmptyValues(t *testing.T) {
	got := joinNonEmpty([]string{"10.0.0.1", "", "10.0.0.2"}, ",")
	if got != "10.0.0.1,10.0.0.2" {
		t.Fatalf("unexpected join result %q", got)
	}
}

func TestNewClientFromKubeconfigRejectsExecAuthPlugin(t *testing.T) {
	kubeconfig := `apiVersion: v1
kind: Config
clusters:
- name: test-cluster
  cluster:
    server: https://127.0.0.1:6443
    insecure-skip-tls-verify: true
contexts:
- name: test-context
  context:
    cluster: test-cluster
    user: test-user
current-context: test-context
users:
- name: test-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1
      command: malicious-command
`

	_, err := NewClientFromKubeconfig(kubeconfig, "")
	if err == nil {
		t.Fatal("expected exec auth plugin to be rejected")
	}
	message := err.Error()
	if !strings.Contains(message, "exec") && !strings.Contains(message, "认证插件") {
		t.Fatalf("expected error to mention exec or 认证插件, got %q", message)
	}
}

func TestGetNodesIncludesCapacityAndAllocatableResources(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:   "master01",
			Labels: map[string]string{"node-role.kubernetes.io/control-plane": ""},
		},
		Spec: corev1.NodeSpec{PodCIDR: "10.42.0.0/24"},
		Status: corev1.NodeStatus{
			Capacity: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("4"),
				corev1.ResourceMemory: resource.MustParse("8Gi"),
				corev1.ResourcePods:   resource.MustParse("110"),
			},
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("3900m"),
				corev1.ResourceMemory: resource.MustParse("7Gi"),
				corev1.ResourcePods:   resource.MustParse("100"),
			},
			Addresses: []corev1.NodeAddress{{Type: corev1.NodeInternalIP, Address: "192.168.98.10"}},
			Conditions: []corev1.NodeCondition{{
				Type:   corev1.NodeReady,
				Status: corev1.ConditionTrue,
			}},
			NodeInfo: corev1.NodeSystemInfo{KubeletVersion: "v1.28.15"},
		},
	}
	client := &Client{clientset: k8sfake.NewSimpleClientset(node)}

	nodes, err := client.GetNodes(t.Context())
	if err != nil {
		t.Fatalf("get nodes: %v", err)
	}
	if len(nodes) != 1 {
		t.Fatalf("nodes = %#v", nodes)
	}
	got := nodes[0]
	if got.CPUCapacityMilli != 4000 || got.CPUAllocatableMilli != 3900 {
		t.Fatalf("unexpected cpu capacity fields: %#v", got)
	}
	if got.MemoryCapacityBytes != 8*1024*1024*1024 || got.MemoryAllocatableBytes != 7*1024*1024*1024 {
		t.Fatalf("unexpected memory capacity fields: %#v", got)
	}
	if got.PodCapacity != 110 || got.PodAllocatable != 100 {
		t.Fatalf("unexpected pod capacity fields: %#v", got)
	}
}

func TestGetProtocolPodsIncludesCurrentUsageAndResourceSpec(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api-7d9f", Namespace: "payments"},
		Spec: corev1.PodSpec{
			NodeName: "node-a",
			Containers: []corev1.Container{{
				Name:  "api",
				Image: "example/api:v1",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("100m"),
						corev1.ResourceMemory: resource.MustParse("128Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("500m"),
						corev1.ResourceMemory: resource.MustParse("512Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			PodIP: "10.42.0.11",
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "api",
				Ready:        true,
				RestartCount: 2,
				State:        corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
			}},
		},
	}
	podMetrics := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "metrics.k8s.io/v1beta1",
			"kind":       "PodMetrics",
			"metadata": map[string]interface{}{
				"name":      "api-7d9f",
				"namespace": "payments",
			},
			"containers": []interface{}{
				map[string]interface{}{
					"name": "api",
					"usage": map[string]interface{}{
						"cpu":    "37m",
						"memory": "96Mi",
					},
				},
			},
		},
	}
	dynamicClient := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(
		runtime.NewScheme(),
		map[schema.GroupVersionResource]string{{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "pods"}: "PodMetricsList"},
	)
	dynamicClient.Fake.PrependReactor("list", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, &unstructured.UnstructuredList{Items: []unstructured.Unstructured{*podMetrics}}, nil
	})
	client := &Client{
		clientset: k8sfake.NewSimpleClientset(pod),
		dynamic:   dynamicClient,
	}

	pods, err := client.GetProtocolPods(t.Context(), "payments")
	if err != nil {
		t.Fatalf("get pods: %v", err)
	}
	if len(pods) != 1 {
		t.Fatalf("pods = %#v", pods)
	}
	got := pods[0]
	if !got.MetricsAvailable || got.CPUUsageMilli != 37 || got.MemoryUsageBytes != 96*1024*1024 {
		t.Fatalf("unexpected pod usage: %#v", got)
	}
	if len(got.Containers) != 1 {
		t.Fatalf("containers = %#v", got.Containers)
	}
	container := got.Containers[0]
	if container.Name != "api" || container.Image != "example/api:v1" || !container.Ready || container.RestartCount != 2 || container.State != "Running" {
		t.Fatalf("unexpected container basics: %#v", container)
	}
	if container.CPUUsageMilli != 37 || container.MemoryUsageBytes != 96*1024*1024 || container.CPURequestMilli != 100 || container.CPULimitMilli != 500 || container.MemoryRequestBytes != 128*1024*1024 || container.MemoryLimitBytes != 512*1024*1024 {
		t.Fatalf("unexpected container resources: %#v", container)
	}
}

func TestGetProtocolPodsIncludesWorkloadOwner(t *testing.T) {
	controller := true
	deploymentPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "api-7d9f-abcde",
			Namespace: "payments",
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "ReplicaSet",
				Name:       "api-7d9f",
				Controller: &controller,
			}},
		},
		Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "api"}}},
		Status: corev1.PodStatus{
			Phase:             corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{Name: "api", Ready: true}},
		},
	}
	statefulSetPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "mysql-0",
			Namespace: "payments",
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "StatefulSet",
				Name:       "mysql",
				Controller: &controller,
			}},
		},
		Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "mysql"}}},
		Status: corev1.PodStatus{
			Phase:             corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{Name: "mysql", Ready: true}},
		},
	}
	replicaSet := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "api-7d9f",
			Namespace: "payments",
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       "api",
				Controller: &controller,
			}},
		},
	}
	client := &Client{clientset: k8sfake.NewSimpleClientset(deploymentPod, statefulSetPod, replicaSet)}

	pods, err := client.GetProtocolPods(t.Context(), "payments")
	if err != nil {
		t.Fatalf("get pods: %v", err)
	}
	byName := make(map[string]protocol.K8sPod, len(pods))
	for _, pod := range pods {
		byName[pod.Name] = pod
	}
	if got := byName["api-7d9f-abcde"]; got.WorkloadKind != "deployment" || got.WorkloadName != "api" {
		t.Fatalf("deployment pod owner = %#v, want deployment/api", got)
	}
	if got := byName["mysql-0"]; got.WorkloadKind != "statefulset" || got.WorkloadName != "mysql" {
		t.Fatalf("statefulset pod owner = %#v, want statefulset/mysql", got)
	}
}

func TestPodDiagnosticsFromObjectReturnsEventsYAMLAndDescribe(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "nginx", Namespace: "default", Labels: map[string]string{"app": "nginx"}},
		Spec: corev1.PodSpec{
			NodeName:   "node-1",
			Containers: []corev1.Container{{Name: "nginx", Image: "nginx:1.27"}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			PodIP: "10.42.0.8",
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "nginx",
				Image:        "nginx:1.27",
				Ready:        true,
				RestartCount: 2,
			}},
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue, Reason: "ContainersReady", Message: "ready"}},
		},
	}
	events := []corev1.Event{
		{
			ObjectMeta:     metav1.ObjectMeta{Name: "nginx-started", Namespace: "default"},
			InvolvedObject: corev1.ObjectReference{Kind: "Pod", Namespace: "default", Name: "nginx"},
			Type:           corev1.EventTypeNormal,
			Reason:         "Started",
			Message:        "Started container nginx",
			Count:          1,
		},
	}

	diagnostics, err := podDiagnosticsFromObject(pod, events)
	if err != nil {
		t.Fatalf("pod diagnostics: %v", err)
	}
	if diagnostics.Kind != "pod" || diagnostics.Name != "nginx" || diagnostics.Namespace != "default" || diagnostics.Status != "Running" {
		t.Fatalf("unexpected diagnostics identity: %#v", diagnostics)
	}
	if len(diagnostics.Containers) != 1 || diagnostics.Containers[0].Name != "nginx" || !diagnostics.Containers[0].Ready || diagnostics.Containers[0].RestartCount != 2 {
		t.Fatalf("unexpected containers: %#v", diagnostics.Containers)
	}
	if len(diagnostics.Conditions) != 1 || diagnostics.Conditions[0].Type != "Ready" {
		t.Fatalf("unexpected conditions: %#v", diagnostics.Conditions)
	}
	if len(diagnostics.Events) != 1 || diagnostics.Events[0].Reason != "Started" {
		t.Fatalf("unexpected events: %#v", diagnostics.Events)
	}
	if !strings.Contains(diagnostics.YAML, "kind: Pod") || !strings.Contains(diagnostics.YAML, "name: nginx") {
		t.Fatalf("yaml missing pod identity:\n%s", diagnostics.YAML)
	}
	if !strings.Contains(diagnostics.Describe, "Name: nginx") || !strings.Contains(diagnostics.Describe, "Containers:") {
		t.Fatalf("describe missing expected content:\n%s", diagnostics.Describe)
	}
}

func TestObjectYAMLOmitsServerManagedMetadata(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "nginx",
			Namespace:       "default",
			Labels:          map[string]string{"app": "nginx"},
			UID:             types.UID("29d48621-75ac-44ca-b526-db2e23b2d1da"),
			ResourceVersion: "12345",
			Generation:      7,
			ManagedFields: []metav1.ManagedFieldsEntry{{
				Manager:    "kubectl",
				Operation:  metav1.ManagedFieldsOperationApply,
				APIVersion: "v1",
				FieldsType: "FieldsV1",
				FieldsV1:   &metav1.FieldsV1{Raw: []byte(`{"f:metadata":{"f:labels":{".":{},"f:app.kubernetes.io/name":{}}},"f:spec":{}}`)},
			}},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "nginx", Image: "nginx:1.27"}},
		},
	}

	body, err := objectYAML(pod)
	if err != nil {
		t.Fatalf("object yaml: %v", err)
	}
	for _, unwanted := range []string{"managedFields", "f:labels", "f:spec", "resourceVersion", "uid:", "generation:"} {
		if strings.Contains(body, unwanted) {
			t.Fatalf("expected yaml to omit %q:\n%s", unwanted, body)
		}
	}
	if !strings.Contains(body, "kind: Pod") || !strings.Contains(body, "name: nginx") || !strings.Contains(body, "app: nginx") {
		t.Fatalf("yaml missing expected user-facing fields:\n%s", body)
	}
}

func TestDeploymentDiagnosticsFromObjectReturnsSummaryEventsYAMLAndDescribe(t *testing.T) {
	replicas := int32(3)
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", Labels: map[string]string{"app": "web"}},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
		Status: appsv1.DeploymentStatus{ReadyReplicas: 2, UpdatedReplicas: 3, AvailableReplicas: 2},
	}
	events := []corev1.Event{
		{
			ObjectMeta:     metav1.ObjectMeta{Name: "web-scaled", Namespace: "default"},
			InvolvedObject: corev1.ObjectReference{Kind: "Deployment", Namespace: "default", Name: "web"},
			Type:           corev1.EventTypeNormal,
			Reason:         "ScalingReplicaSet",
			Message:        "Scaled up replica set",
			Count:          1,
		},
	}

	diagnostics, err := deploymentDiagnosticsFromObject(deployment, events)
	if err != nil {
		t.Fatalf("deployment diagnostics: %v", err)
	}
	if diagnostics.Kind != "deployment" || diagnostics.Status != "2/3 ready" {
		t.Fatalf("unexpected deployment diagnostics: %#v", diagnostics)
	}
	if diagnostics.Summary["replicas"] != "3" || diagnostics.Summary["ready"] != "2" || diagnostics.Summary["selector"] != "app=web" {
		t.Fatalf("unexpected summary: %#v", diagnostics.Summary)
	}
	if len(diagnostics.Events) != 1 || diagnostics.Events[0].Reason != "ScalingReplicaSet" {
		t.Fatalf("unexpected events: %#v", diagnostics.Events)
	}
	if !strings.Contains(diagnostics.YAML, "kind: Deployment") || !strings.Contains(diagnostics.Describe, "Selector: app=web") {
		t.Fatalf("missing yaml/describe content:\nYAML:\n%s\nDescribe:\n%s", diagnostics.YAML, diagnostics.Describe)
	}
}

func TestRestartWorkloadPatchesPodTemplateAnnotation(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Template: corev1.PodTemplateSpec{ObjectMeta: metav1.ObjectMeta{Annotations: map[string]string{"keep": "true"}}},
		},
	}
	client := &Client{clientset: k8sfake.NewSimpleClientset(deployment)}

	result, err := client.ExecuteResourceAction(t.Context(), protocol.K8sResourceActionRequest{Kind: "deployment", Namespace: "default", Name: "web", Action: "restart"})
	if err != nil {
		t.Fatalf("restart workload: %v", err)
	}
	if !result.Success || result.Message == "" {
		t.Fatalf("unexpected result: %#v", result)
	}
	updated, err := client.clientset.AppsV1().Deployments("default").Get(t.Context(), "web", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get updated deployment: %v", err)
	}
	if updated.Spec.Template.Annotations["keep"] != "true" || updated.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] == "" {
		t.Fatalf("restart annotation not patched: %#v", updated.Spec.Template.Annotations)
	}
}

func TestScaleWorkloadUpdatesReplicas(t *testing.T) {
	replicas := int32(2)
	nextReplicas := int32(5)
	deployment := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"}, Spec: appsv1.DeploymentSpec{Replicas: &replicas}}
	client := &Client{clientset: k8sfake.NewSimpleClientset(deployment)}

	_, err := client.ExecuteResourceAction(t.Context(), protocol.K8sResourceActionRequest{Kind: "deployment", Namespace: "default", Name: "web", Action: "scale", Replicas: &nextReplicas})
	if err != nil {
		t.Fatalf("scale workload: %v", err)
	}
	updated, err := client.clientset.AppsV1().Deployments("default").Get(t.Context(), "web", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get updated deployment: %v", err)
	}
	if updated.Spec.Replicas == nil || *updated.Spec.Replicas != 5 {
		t.Fatalf("expected replicas 5, got %#v", updated.Spec.Replicas)
	}
}

func TestApplyYAMLDryRunUsesDynamicClientAndValidatesIdentity(t *testing.T) {
	dynamicClient := &recordingDynamicClient{}
	client := &Client{clientset: k8sfake.NewSimpleClientset(), dynamic: dynamicClient}
	body := `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
      - name: nginx
        image: nginx:1.27
`

	result, err := client.ExecuteResourceAction(t.Context(), protocol.K8sResourceActionRequest{Kind: "deployment", Namespace: "default", Name: "web", Action: "dry_run_apply", YAML: body})
	if err != nil {
		t.Fatalf("dry-run apply: %v", err)
	}
	if !result.Success || !strings.Contains(result.Message, "Dry Run") {
		t.Fatalf("unexpected dry-run result: %#v", result)
	}
	if dynamicClient.resource.Resource != "deployments" || dynamicClient.namespace != "default" || dynamicClient.name != "web" || dynamicClient.patchType != types.ApplyPatchType {
		t.Fatalf("unexpected dynamic patch target: %#v", dynamicClient)
	}
	if len(dynamicClient.dryRun) != 1 || dynamicClient.dryRun[0] != metav1.DryRunAll {
		t.Fatalf("expected dry-run patch option, got %#v", dynamicClient.dryRun)
	}
	if strings.Contains(string(dynamicClient.data), `"status"`) {
		t.Fatalf("apply payload should omit status: %s", dynamicClient.data)
	}
}

func TestApplyManifestDryRunCreatesMultiDocumentResources(t *testing.T) {
	dynamicClient := &recordingDynamicClient{}
	client := &Client{clientset: k8sfake.NewSimpleClientset(), dynamic: dynamicClient}
	body := `apiVersion: v1
kind: Namespace
metadata:
  name: staging
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: staging
spec:
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
      - name: web
        image: nginx:1.27
`

	result, err := client.ApplyManifest(t.Context(), protocol.K8sApplyManifestRequest{RequestID: "req-apply", YAML: body, DryRun: true})
	if err != nil {
		t.Fatalf("dry-run create manifest: %v", err)
	}
	if !result.Success || result.Type != protocol.MessageTypeK8sApplyManifestResult || !strings.Contains(result.Message, "校验") {
		t.Fatalf("unexpected dry-run result: %#v", result)
	}
	if len(dynamicClient.creates) != 2 {
		t.Fatalf("expected two create calls, got %#v", dynamicClient.creates)
	}
	if dynamicClient.creates[0].resource.Resource != "namespaces" || dynamicClient.creates[0].namespace != "" || dynamicClient.creates[0].name != "staging" {
		t.Fatalf("unexpected namespace create: %#v", dynamicClient.creates[0])
	}
	if dynamicClient.creates[1].resource.Resource != "deployments" || dynamicClient.creates[1].namespace != "staging" || dynamicClient.creates[1].name != "web" {
		t.Fatalf("unexpected deployment create: %#v", dynamicClient.creates[1])
	}
	for _, item := range dynamicClient.creates {
		if len(item.dryRun) != 1 || item.dryRun[0] != metav1.DryRunAll {
			t.Fatalf("expected dry-run create option, got %#v", dynamicClient.creates)
		}
	}
}

func TestApplyManifestSupportsAdvancedNativeKindsFromCustomYAML(t *testing.T) {
	client := &Client{clientset: k8sfake.NewSimpleClientset(), dynamic: &recordingDynamicClient{}}
	body := `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: reader
  namespace: default
`

	result, err := client.ApplyManifest(t.Context(), protocol.K8sApplyManifestRequest{YAML: body, DryRun: true})
	if err != nil {
		t.Fatalf("apply advanced native kind: %v", err)
	}
	if !result.Success {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestApplyManifestRejectsUnknownCustomResourceInstance(t *testing.T) {
	client := &Client{clientset: k8sfake.NewSimpleClientset(), dynamic: &recordingDynamicClient{}}
	body := `apiVersion: example.com/v1
kind: Widget
metadata:
  name: alpha
  namespace: default
`

	_, err := client.ApplyManifest(t.Context(), protocol.K8sApplyManifestRequest{YAML: body, DryRun: true})
	if err == nil || !strings.Contains(err.Error(), "不支持的资源类型") {
		t.Fatalf("expected unsupported kind error, got %v", err)
	}
}

type recordingDynamicClient struct {
	resource  schema.GroupVersionResource
	namespace string
	name      string
	patchType types.PatchType
	data      []byte
	dryRun    []string
	creates   []recordedDynamicCreate
}

type recordedDynamicCreate struct {
	resource  schema.GroupVersionResource
	namespace string
	name      string
	dryRun    []string
}

func (c *recordingDynamicClient) Resource(resource schema.GroupVersionResource) dynamic.NamespaceableResourceInterface {
	c.resource = resource
	return &recordingDynamicResource{client: c}
}

type recordingDynamicResource struct {
	client    *recordingDynamicClient
	namespace string
}

func (r *recordingDynamicResource) Namespace(namespace string) dynamic.ResourceInterface {
	r.namespace = namespace
	r.client.namespace = namespace
	return r
}

func (r *recordingDynamicResource) Create(ctx context.Context, obj *unstructured.Unstructured, options metav1.CreateOptions, subresources ...string) (*unstructured.Unstructured, error) {
	r.client.creates = append(r.client.creates, recordedDynamicCreate{
		resource:  r.client.resource,
		namespace: r.namespace,
		name:      obj.GetName(),
		dryRun:    append([]string(nil), options.DryRun...),
	})
	return obj, nil
}

func (r *recordingDynamicResource) Update(ctx context.Context, obj *unstructured.Unstructured, options metav1.UpdateOptions, subresources ...string) (*unstructured.Unstructured, error) {
	return obj, nil
}

func (r *recordingDynamicResource) UpdateStatus(ctx context.Context, obj *unstructured.Unstructured, options metav1.UpdateOptions) (*unstructured.Unstructured, error) {
	return obj, nil
}

func (r *recordingDynamicResource) Delete(ctx context.Context, name string, options metav1.DeleteOptions, subresources ...string) error {
	return nil
}

func (r *recordingDynamicResource) DeleteCollection(ctx context.Context, options metav1.DeleteOptions, listOptions metav1.ListOptions) error {
	return nil
}

func (r *recordingDynamicResource) Get(ctx context.Context, name string, options metav1.GetOptions, subresources ...string) (*unstructured.Unstructured, error) {
	return &unstructured.Unstructured{}, nil
}

func (r *recordingDynamicResource) List(ctx context.Context, opts metav1.ListOptions) (*unstructured.UnstructuredList, error) {
	return &unstructured.UnstructuredList{}, nil
}

func (r *recordingDynamicResource) Watch(ctx context.Context, opts metav1.ListOptions) (watch.Interface, error) {
	return nil, nil
}

func (r *recordingDynamicResource) Patch(ctx context.Context, name string, patchType types.PatchType, data []byte, options metav1.PatchOptions, subresources ...string) (*unstructured.Unstructured, error) {
	r.client.name = name
	r.client.patchType = patchType
	r.client.data = append([]byte(nil), data...)
	r.client.dryRun = append([]string(nil), options.DryRun...)
	return &unstructured.Unstructured{}, nil
}

func (r *recordingDynamicResource) Apply(ctx context.Context, name string, obj *unstructured.Unstructured, options metav1.ApplyOptions, subresources ...string) (*unstructured.Unstructured, error) {
	return obj, nil
}

func (r *recordingDynamicResource) ApplyStatus(ctx context.Context, name string, obj *unstructured.Unstructured, options metav1.ApplyOptions) (*unstructured.Unstructured, error) {
	return obj, nil
}
