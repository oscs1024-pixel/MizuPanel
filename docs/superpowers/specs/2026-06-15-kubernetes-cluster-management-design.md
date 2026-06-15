# Kubernetes 集群管理功能设计文档

**日期**: 2026-06-15  
**版本**: v1.0  
**状态**: 设计中

## 1. 概述

### 1.1 目标

为 MizuPanel 增加 Kubernetes 集群管理能力，允许用户通过已安装 Agent 的节点连接和管理 K8s 集群。

### 1.2 核心原则

- **复用现有架构**: 通过 Agent 执行 kubectl 命令，Server 不直接连接 K8s API
- **安全优先**: kubeconfig 文件保留在 Agent 节点，不上传到 Server
- **分阶段实现**: MVP 优先，快速迭代，逐步增强功能
- **设计一致性**: 保持与现有 Docker 容器管理的交互模式一致

### 1.3 功能范围

#### 阶段 1: 只读查看（v1.0）
- 连接/删除 K8s 集群
- 集群概览统计
- Pod 列表查看和筛选
- Pod 日志查看

#### 阶段 2: 基础操作（v1.1）
- Pod Exec 终端
- 重启/删除 Pod
- 查看 Pod 详细信息（YAML）

#### 阶段 3: 资源扩展（v1.2）
- Deployment 列表和管理
- Service 列表
- Kubernetes Nodes 列表
- 扩缩容 Deployment

#### 阶段 4: 高级功能（v2.0）
- YAML 编辑器
- ConfigMap 和 Secret 管理
- 事件查看（Events）
- 资源使用监控（CPU/内存）

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────┐        ┌─────────────┐        ┌─────────────┐
│   Browser   │        │   Server    │        │    Agent    │
│  (Dashboard)│◄──────►│  (Go/Gin)   │◄──────►│  (kubectl)  │
└─────────────┘        └─────────────┘        └─────────────┘
     HTTP/WS               WebSocket              kubectl cmd
                                                       │
                                                       ▼
                                              ┌─────────────┐
                                              │ K8s Cluster │
                                              │   (API)     │
                                              └─────────────┘
```

### 2.2 通信流程

1. **连接集群**: Dashboard → Server API → Server 验证 Agent → 存储集群配置到数据库
2. **查询资源**: Dashboard → Server API → Server 通过 WebSocket 请求 Agent → Agent 执行 kubectl → 返回结果
3. **操作资源**: 同上，Agent 执行 kubectl 操作命令

### 2.3 核心设计决策

#### 为什么通过 Agent 执行 kubectl？

**优势**:
- ✅ kubeconfig 文件不需要上传到 Server，安全性更高
- ✅ 复用现有 Agent-Server WebSocket 架构
- ✅ Agent 节点可能本身就是 K8s 集群的一部分，访问更直接
- ✅ 用户可以灵活选择使用哪个 Agent 节点连接集群

**劣势**:
- ❌ Agent 节点必须安装 kubectl 并配置好 kubeconfig
- ❌ 增加了 Agent 的责任和复杂度

#### kubectl 还是 client-go？

**选择**: 第一阶段使用 **kubectl 命令行**，后续可选 client-go 优化。

**理由**:
- kubectl 实现简单，Agent 只需执行命令并解析输出
- 用户的 kubeconfig 直接可用，无需额外配置
- kubectl 输出格式稳定（JSON/YAML），易于解析
- 后续可根据性能需求切换到 client-go（不影响前端）

---

## 3. 数据库设计

### 3.1 k8s_clusters 表

```sql
CREATE TABLE IF NOT EXISTS k8s_clusters (
    id TEXT PRIMARY KEY,                  -- 集群 ID (UUID)
    name TEXT NOT NULL,                   -- 集群名称（用户自定义）
    node_id TEXT NOT NULL,                -- 关联的 Agent 节点 ID
    kubeconfig_path TEXT NOT NULL,        -- kubeconfig 文件路径
    context TEXT,                         -- K8s context（可选）
    status TEXT NOT NULL DEFAULT 'online',-- 状态: online/offline
    last_seen_at DATETIME,                -- 最后连接时间
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);
```

### 3.2 索引

```sql
CREATE INDEX IF NOT EXISTS idx_k8s_clusters_node ON k8s_clusters(node_id);
CREATE INDEX IF NOT EXISTS idx_k8s_clusters_status ON k8s_clusters(status);
```

### 3.3 数据模型说明

- **集群与节点关系**: 多对一（多个集群可以关联同一个 Agent 节点）
- **节点删除时**: 关联的集群自动删除（CASCADE）
- **状态维护**: Server 定期通过 Agent 检查集群连通性，更新 status 和 last_seen_at

---

## 4. WebSocket 通信协议

### 4.1 消息类型定义

```go
// internal/protocol/messages.go

const (
    // K8s 集群连接验证
    MessageTypeK8sClusterConnect       = "k8s_cluster_connect"
    MessageTypeK8sClusterConnectResult = "k8s_cluster_connect_result"
    
    // Pod 列表查询
    MessageTypeK8sGetPods        = "k8s_get_pods"
    MessageTypeK8sGetPodsResult  = "k8s_get_pods_result"
    
    // Pod 日志查询
    MessageTypeK8sGetPodLogs       = "k8s_get_pod_logs"
    MessageTypeK8sGetPodLogsResult = "k8s_get_pod_logs_result"
    
    // Pod 操作（阶段 2）
    MessageTypeK8sDeletePod       = "k8s_delete_pod"
    MessageTypeK8sDeletePodResult = "k8s_delete_pod_result"
)
```

### 4.2 消息结构体

#### 连接集群验证

```go
type K8sClusterConnectRequest struct {
    Type            string `json:"type"`
    RequestID       string `json:"request_id"`
    KubeconfigPath  string `json:"kubeconfig_path"`
    Context         string `json:"context,omitempty"`
}

type K8sClusterConnectResult struct {
    Type      string `json:"type"`
    RequestID string `json:"request_id"`
    Success   bool   `json:"success"`
    Error     string `json:"error,omitempty"`
    // 验证成功后返回集群基本信息
    ClusterInfo *K8sClusterInfo `json:"cluster_info,omitempty"`
}

type K8sClusterInfo struct {
    Version        string `json:"version"`         // K8s 版本
    NodeCount      int    `json:"node_count"`      // 节点数量
    NamespaceCount int    `json:"namespace_count"` // 命名空间数量
}
```

#### 查询 Pod 列表

```go
type K8sGetPodsRequest struct {
    Type       string `json:"type"`
    RequestID  string `json:"request_id"`
    ClusterID  string `json:"cluster_id"`
    Namespace  string `json:"namespace,omitempty"` // 空表示所有命名空间
}

type K8sGetPodsResult struct {
    Type      string    `json:"type"`
    RequestID string    `json:"request_id"`
    Success   bool      `json:"success"`
    Error     string    `json:"error,omitempty"`
    Pods      []K8sPod  `json:"pods,omitempty"`
}

type K8sPod struct {
    Name         string `json:"name"`
    Namespace    string `json:"namespace"`
    Status       string `json:"status"`        // Running, Pending, Failed, etc.
    Ready        string `json:"ready"`         // 1/1, 0/1, etc.
    Restarts     int    `json:"restarts"`      // 重启次数
    Age          string `json:"age"`           // 运行时间
    Node         string `json:"node"`          // 所在节点
    IP           string `json:"ip,omitempty"`  // Pod IP
}
```

#### 查询 Pod 日志

```go
type K8sGetPodLogsRequest struct {
    Type       string `json:"type"`
    RequestID  string `json:"request_id"`
    ClusterID  string `json:"cluster_id"`
    Namespace  string `json:"namespace"`
    PodName    string `json:"pod_name"`
    Container  string `json:"container,omitempty"` // 多容器时指定
    Follow     bool   `json:"follow"`              // 是否实时跟踪
    TailLines  int    `json:"tail_lines"`          // 最后 N 行
}

type K8sGetPodLogsResult struct {
    Type      string `json:"type"`
    RequestID string `json:"request_id"`
    Success   bool   `json:"success"`
    Error     string `json:"error,omitempty"`
    Logs      string `json:"logs,omitempty"`      // 日志内容
    Stream    bool   `json:"stream"`              // 是否为流式响应
}
```

---

## 5. API 设计

### 5.1 RESTful 接口

#### 集群管理

```
POST   /api/k8s/clusters              创建（连接）集群
GET    /api/k8s/clusters              获取集群列表
GET    /api/k8s/clusters/:id          获取集群详情
DELETE /api/k8s/clusters/:id          删除集群连接
```

#### Pod 查询（阶段 1）

```
GET    /api/k8s/clusters/:id/pods                    获取 Pod 列表
GET    /api/k8s/clusters/:id/pods/:namespace/:name/logs  获取 Pod 日志
```

#### Pod 操作（阶段 2）

```
DELETE /api/k8s/clusters/:id/pods/:namespace/:name    删除 Pod
POST   /api/k8s/clusters/:id/pods/:namespace/:name/restart  重启 Pod
GET    /api/k8s/clusters/:id/pods/:namespace/:name/yaml     获取 Pod YAML
```

#### Deployment 管理（阶段 3）

```
GET    /api/k8s/clusters/:id/deployments             获取 Deployment 列表
PATCH  /api/k8s/clusters/:id/deployments/:namespace/:name/scale  扩缩容
```

### 5.2 请求/响应示例

#### 创建集群连接

**请求**:
```json
POST /api/k8s/clusters
{
  "name": "prod-cluster",
  "node_id": "node-123",
  "kubeconfig_path": "/root/.kube/config",
  "context": "prod"
}
```

**响应**:
```json
{
  "success": true,
  "cluster": {
    "id": "cluster-456",
    "name": "prod-cluster",
    "node_id": "node-123",
    "status": "online",
    "cluster_info": {
      "version": "v1.28.0",
      "node_count": 3,
      "namespace_count": 8
    },
    "created_at": "2026-06-15T10:00:00Z"
  }
}
```

#### 获取 Pod 列表

**请求**:
```
GET /api/k8s/clusters/cluster-456/pods?namespace=production&status=Running
```

**响应**:
```json
{
  "success": true,
  "pods": [
    {
      "name": "nginx-deployment-7d8f",
      "namespace": "production",
      "status": "Running",
      "ready": "1/1",
      "restarts": 0,
      "age": "1d 3h",
      "node": "worker-1",
      "ip": "10.244.1.5"
    }
  ]
}
```

---

## 6. Agent 端实现

### 6.1 目录结构

```
internal/agent/
  kubectl/
    client.go          # kubectl 命令封装
    pods.go            # Pod 相关操作
    deployments.go     # Deployment 相关操作（阶段 3）
    handler.go         # WebSocket 消息处理
```

### 6.2 kubectl 命令封装

```go
// internal/agent/kubectl/client.go

type Client struct {
    kubeconfigPath string
    context        string
}

func NewClient(kubeconfigPath, context string) *Client {
    return &Client{
        kubeconfigPath: kubeconfigPath,
        context:        context,
    }
}

// buildCommand 构造 kubectl 命令
func (c *Client) buildCommand(args ...string) *exec.Cmd {
    cmdArgs := []string{"--kubeconfig", c.kubeconfigPath}
    if c.context != "" {
        cmdArgs = append(cmdArgs, "--context", c.context)
    }
    cmdArgs = append(cmdArgs, args...)
    return exec.Command("kubectl", cmdArgs...)
}

// GetClusterInfo 获取集群信息
func (c *Client) GetClusterInfo(ctx context.Context) (*K8sClusterInfo, error) {
    // kubectl version --output=json
    // kubectl get nodes --output=json
    // kubectl get namespaces --output=json
}

// GetPods 获取 Pod 列表
func (c *Client) GetPods(ctx context.Context, namespace string) ([]K8sPod, error) {
    // kubectl get pods -n <namespace> --output=json
    // 或 kubectl get pods --all-namespaces --output=json
}

// GetPodLogs 获取 Pod 日志
func (c *Client) GetPodLogs(ctx context.Context, namespace, podName string, 
    follow bool, tailLines int) (io.ReadCloser, error) {
    // kubectl logs -n <namespace> <podName> --tail=<tailLines> [--follow]
}
```

### 6.3 消息处理器

```go
// internal/agent/kubectl/handler.go

type Handler struct {
    clients map[string]*Client  // clusterID -> Client
    mu      sync.RWMutex
}

func (h *Handler) Handle(ctx context.Context, msgType string, 
    data json.RawMessage, sender ws.Sender) error {
    switch msgType {
    case protocol.MessageTypeK8sClusterConnect:
        return h.handleClusterConnect(ctx, data, sender)
    case protocol.MessageTypeK8sGetPods:
        return h.handleGetPods(ctx, data, sender)
    case protocol.MessageTypeK8sGetPodLogs:
        return h.handleGetPodLogs(ctx, data, sender)
    }
    return nil
}
```

---

## 7. Server 端实现

### 7.1 目录结构

```
internal/server/
  k8s/
    store.go           # 数据库操作
    service.go         # 业务逻辑
  api/
    k8s_routes.go      # K8s API 路由
    k8s_handlers.go    # 请求处理
  agenthub/
    hub_k8s.go         # K8s 相关的 Agent 通信
```

### 7.2 数据存储层

```go
// internal/server/k8s/store.go

type Store struct {
    db *sql.DB
}

func (s *Store) CreateCluster(cluster *K8sCluster) error
func (s *Store) GetCluster(id string) (*K8sCluster, error)
func (s *Store) ListClusters() ([]*K8sCluster, error)
func (s *Store) UpdateClusterStatus(id, status string) error
func (s *Store) DeleteCluster(id string) error
```

### 7.3 业务逻辑层

```go
// internal/server/k8s/service.go

type Service struct {
    store *Store
    hub   *agenthub.Hub
}

// ConnectCluster 连接 K8s 集群
// 1. 验证 node_id 存在且在线
// 2. 通过 Agent 验证 kubeconfig 可用
// 3. 保存集群信息到数据库
func (s *Service) ConnectCluster(req *ConnectClusterRequest) (*K8sCluster, error)

// GetPods 获取 Pod 列表
func (s *Service) GetPods(clusterID, namespace string) ([]K8sPod, error)

// GetPodLogs 获取 Pod 日志
func (s *Service) GetPodLogs(clusterID, namespace, podName string, 
    follow bool, tailLines int) (io.ReadCloser, error)
```

---

## 8. 前端实现

### 8.1 页面结构

```
web/src/
  pages/
    K8sClustersPage.tsx         # 集群列表页
    K8sClusterDetail.tsx        # 集群详情页
  components/
    K8sConnectClusterModal.tsx  # 连接集群对话框
    K8sPodList.tsx              # Pod 列表组件
    K8sPodLogsModal.tsx         # Pod 日志查看对话框
  types.ts                      # TypeScript 类型定义
  api/
    k8s.ts                      # K8s API 客户端
```

### 8.2 TypeScript 类型定义

```typescript
// web/src/types.ts

export type K8sCluster = {
  id: string
  name: string
  node_id: string
  node_name: string
  node_ip: string
  status: 'online' | 'offline'
  cluster_info?: {
    version: string
    node_count: number
    namespace_count: number
  }
  created_at: string
  updated_at: string
}

export type K8sPod = {
  name: string
  namespace: string
  status: string
  ready: string
  restarts: number
  age: string
  node: string
  ip?: string
}
```

### 8.3 路由设计

```typescript
// web/src/App.tsx

type AppRoute =
  | { kind: 'k8s-clusters' }                        // /k8s
  | { kind: 'k8s-cluster-detail', clusterID: string } // /k8s/:id
  | ...existing routes
```

### 8.4 导航栏更新

```typescript
const navItems: Array<{ page: AppPage, label: string, icon: string }> = [
  { page: 'overview', label: '概览', icon: 'overview' },
  { page: 'hosts', label: '主机列表', icon: 'hosts' },
  { page: 'k8s', label: 'Kubernetes 集群', icon: 'k8s' },  // 新增
  { page: 'history', label: '历史记录', icon: 'history' },
  { page: 'alerts', label: '告警规则', icon: 'alerts' },
  { page: 'settings', label: '系统设置', icon: 'settings' },
  { page: 'logs', label: '日志', icon: 'logs' }
]
```

---

## 9. UI/UX 设计

### 9.1 集群列表页面

**布局**: 卡片网格布局（类似主机列表）

**功能区域**:
- 顶部：搜索框 + "连接集群"按钮
- 主体：集群卡片网格
  - 每个卡片显示：集群名称、关联节点、状态、节点数/Pods数/命名空间数
  - 点击卡片进入集群详情
- 底部：集群总数统计

**空状态**: 显示"暂无集群，点击连接 Kubernetes 集群"

### 9.2 连接集群对话框

**布局**: 分步向导（2 步）

**步骤 1 - 选择 Agent 节点**:
- 显示所有在线的 Agent 节点卡片
- 每个卡片显示节点名称、IP、资源使用率
- 点击选中一个节点

**步骤 2 - 填写集群信息**:
- 集群名称（必填）
- kubeconfig 路径（必填，默认 /root/.kube/config）
- Context（可选）
- 提交后 Server 验证连接，成功后跳转到集群详情

### 9.3 集群详情页面

**布局**: 多标签页布局

**顶部区域**:
- 集群名称、状态标签
- 关联的 Agent 节点信息
- 统计卡片：K8s 节点数、Pods 数、命名空间数、Deployments 数

**标签页**:
- **集群概览**: 集群基本信息、版本、节点列表概览
- **Pods**: Pod 列表（重点）
- **Deployments**: Deployment 列表（阶段 3）
- **Services**: Service 列表（阶段 3）
- **Nodes**: Kubernetes 节点列表（阶段 3）

### 9.4 Pod 列表页面

**布局**: 卡片布局

**工具栏**:
- 命名空间下拉选择（全部/default/kube-system/...）
- 状态筛选按钮（全部/运行中/异常）
- 搜索框

**Pod 卡片**:
- 显示：名称、命名空间、状态标签、就绪状态、重启次数、运行时间、节点
- 异常 Pod 用红色边框突出
- 右侧三点菜单包含操作：
  - 查看日志
  - 进入容器 Exec（阶段 2）
  - 重启 Pod（阶段 2）
  - 删除 Pod（阶段 2）
  - 查看详情 YAML（阶段 2）

### 9.5 Pod 日志对话框

**布局**: 全屏模态框（类似容器日志）

**功能**:
- 实时日志流（WebSocket）
- 可暂停/继续
- 滚动到底部按钮
- 复制日志按钮
- 关闭按钮

---

## 10. 样式规范

### 10.1 颜色主题

保持与 MizuPanel 现有设计一致：

- **主色调**: 绿色系（success: #16a34a）
- **卡片**: 白色背景 + 圆角 20px + 阴影
- **状态标签**: 
  - Running: 绿色背景（#dcfce7）+ 绿色文字（#16a34a）
  - Pending/Unknown: 蓝色
  - Failed/CrashLoopBackOff: 红色背景（#fee2e2）+ 红色文字（#dc2626）

### 10.2 组件样式

- **按钮**: 圆角 12px，font-weight: 900
- **输入框**: 圆角 12px，边框 #e2e8f0
- **卡片间距**: 12px
- **标签页**: 选中状态使用深色背景（#0f172a）

---

## 11. 错误处理

### 11.1 Agent 端错误

| 错误场景 | 处理方式 |
|---------|---------|
| kubectl 命令不存在 | 返回错误信息："kubectl 未安装或不在 PATH 中" |
| kubeconfig 文件不存在 | 返回错误信息："kubeconfig 文件不存在: {path}" |
| 无法连接 K8s API | 返回错误信息："无法连接到 Kubernetes 集群，请检查配置" |
| 权限不足 | 返回错误信息："kubeconfig 权限不足，无法访问资源" |
| Context 不存在 | 返回错误信息："Context '{context}' 不存在" |

### 11.2 Server 端错误

| 错误场景 | HTTP 状态码 | 错误信息 |
|---------|-----------|---------|
| Agent 节点不存在 | 404 | "Agent 节点不存在" |
| Agent 节点离线 | 503 | "Agent 节点离线，无法连接集群" |
| 集群不存在 | 404 | "集群不存在" |
| 集群已存在（同名） | 409 | "集群名称已存在" |
| WebSocket 超时 | 504 | "Agent 响应超时" |

### 11.3 前端错误处理

- 使用 Toast 通知显示错误信息（遵循 `.claude/toast-notification-guideline.md`）
- 错误格式：`{操作}失败: {具体原因}`
- 示例：
  - "连接集群失败: kubectl 未安装"
  - "获取 Pod 列表失败: 集群连接超时"
  - "查看日志失败: Pod 不存在"

---

## 12. 安全考虑

### 12.1 kubeconfig 安全

- ✅ kubeconfig 文件保留在 Agent 节点，不上传到 Server
- ✅ Server 只存储 kubeconfig 路径，不存储内容
- ⚠️ 确保 Agent 进程有权限读取 kubeconfig 文件
- ⚠️ kubeconfig 路径不应通过 API 直接暴露给前端（已由 Server 管理）

### 12.2 权限控制

- 如果 MizuPanel 启用了认证（Auth v1），K8s 管理接口也应受保护
- 建议：K8s 管理 API 默认需要管理员权限
- 考虑后续版本支持细粒度权限（只读用户、操作用户等）

### 12.3 命令注入防护

Agent 端构造 kubectl 命令时：
- ✅ 使用 exec.Command 的参数数组形式，避免 shell 注入
- ✅ 校验用户输入的参数（namespace、pod name 等）符合 K8s 命名规范
- ❌ 不要使用字符串拼接构造命令

```go
// ❌ 错误示例
cmd := exec.Command("sh", "-c", fmt.Sprintf("kubectl get pods -n %s", namespace))

// ✅ 正确示例
cmd := exec.Command("kubectl", "get", "pods", "-n", namespace)
```

---

## 13. 性能优化

### 13.1 缓存策略

**阶段 1（v1.0）**: 不实现缓存，每次都实时查询

**后续优化**:
- Server 端缓存集群状态（5 分钟）
- Agent 端缓存 kubectl 输出（30 秒）
- 前端缓存 Pod 列表（手动刷新）

### 13.2 请求超时

| 操作类型 | 超时时间 |
|---------|---------|
| 连接验证 | 10 秒 |
| 获取 Pod 列表 | 15 秒 |
| 获取日志（首次） | 10 秒 |
| 日志流（持续） | 不超时 |
| 删除/重启 Pod | 30 秒 |

### 13.3 并发控制

- Agent 端同时处理的 kubectl 命令数限制：10 个
- 超出限制时排队等待
- Server 端对单个集群的并发请求限制：20 个

---

## 14. 测试计划

### 14.1 单元测试

**Agent 端**:
- kubectl 命令构造测试
- JSON 输出解析测试
- 错误处理测试

**Server 端**:
- 数据库 CRUD 测试
- API 路由测试
- WebSocket 消息处理测试

### 14.2 集成测试

- Agent-Server 通信测试
- 完整连接集群流程测试
- Pod 列表查询测试
- Pod 日志查看测试

### 14.3 手动测试场景

1. 连接集群成功/失败
2. kubectl 未安装时的错误提示
3. kubeconfig 文件不存在时的错误提示
4. 多命名空间 Pod 列表查询
5. 异常 Pod 的状态显示
6. 实时日志流的暂停/继续
7. Agent 节点离线时的错误提示

---

## 15. 部署和迁移

### 15.1 数据库迁移

添加新的迁移语句到 `internal/server/db/migrations.go`：

```go
`CREATE TABLE IF NOT EXISTS k8s_clusters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    node_id TEXT NOT NULL,
    kubeconfig_path TEXT NOT NULL,
    context TEXT,
    status TEXT NOT NULL DEFAULT 'online',
    last_seen_at DATETIME,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);`,
`CREATE INDEX IF NOT EXISTS idx_k8s_clusters_node ON k8s_clusters(node_id);`,
`CREATE INDEX IF NOT EXISTS idx_k8s_clusters_status ON k8s_clusters(status);`,
```

### 15.2 Agent 依赖

**必需**:
- kubectl 命令行工具（v1.20+）
- 有效的 kubeconfig 文件

**可选**:
- 如果 Agent 节点本身是 K8s 节点，kubectl 可能已安装

### 15.3 文档更新

需要更新的文档：
- README.md: 添加 K8s 集群管理功能说明
- CHANGELOG.md: 记录新功能
- 用户手册: 如何连接和管理 K8s 集群
- Agent 安装文档: 说明 kubectl 依赖

---

## 16. 后续扩展规划

### 16.1 阶段 2（v1.1）- 基础操作

**Pod 操作**:
- Pod Exec 终端（复用现有 terminal 模块）
- 重启 Pod（通过删除实现）
- 删除 Pod
- 查看 Pod 详细信息（YAML）

**实现要点**:
- Exec 需要支持 WebSocket 双向通信
- 参考 Docker Exec 的实现模式

### 16.2 阶段 3（v1.2）- 资源扩展

**新增资源类型**:
- Deployment 列表和管理
- Service 列表和查看
- Kubernetes Nodes 列表

**Deployment 操作**:
- 扩缩容（kubectl scale）
- 重启（kubectl rollout restart）
- 查看状态（kubectl rollout status）

### 16.3 阶段 4（v2.0）- 高级功能

**YAML 编辑器**:
- 查看资源 YAML
- 在线编辑并应用（kubectl apply）
- 语法高亮和验证

**ConfigMap/Secret**:
- 列表查看
- 创建/编辑/删除
- Base64 编解码支持

**事件查看**:
- kubectl get events
- 按资源类型筛选
- 实时事件流

**资源监控**:
- kubectl top pods
- kubectl top nodes
- CPU/内存使用率图表

---

## 17. 风险和注意事项

### 17.1 技术风险

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| kubectl 命令输出格式变化 | 解析失败 | 使用 JSON 输出，固定 API 版本 |
| Agent 节点资源不足 | kubectl 执行慢 | 设置合理的超时和并发限制 |
| kubeconfig 权限问题 | 无法访问集群 | 提供清晰的错误提示和文档 |
| 大规模集群性能 | 查询慢 | 分页加载、缓存优化 |

### 17.2 使用限制

- Agent 节点必须能访问 K8s API Server
- 不支持多用户场景下的 kubeconfig 隔离
- Pod 日志大小限制（避免内存溢出）
- 不支持 Helm Chart 管理（可作为独立功能扩展）

---

## 18. 成功指标

### 18.1 阶段 1 完成标准

- [x] 可以成功连接 K8s 集群
- [x] 集群列表页面显示正常
- [x] Pod 列表可以按命名空间和状态筛选
- [x] Pod 日志可以实时查看
- [x] 所有操作都有清晰的错误提示
- [x] UI 设计与现有风格一致

### 18.2 用户体验目标

- 连接集群流程不超过 3 步
- Pod 列表加载时间 < 3 秒
- 日志查看响应时间 < 1 秒
- 错误提示清晰可操作

---

## 19. 参考资料

### 19.1 相关文档

- [kubectl 命令行参考](https://kubernetes.io/docs/reference/kubectl/)
- [kubeconfig 文件结构](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/)
- [MizuPanel Toast 通知规范](../.claude/toast-notification-guideline.md)
- [MizuPanel 开发指南](../CLAUDE.md)

### 19.2 类似实现参考

- **Portainer**: K8s 管理界面设计参考
- **Lens**: 桌面端 K8s IDE
- **Rancher**: 多集群管理平台

---

## 20. 总结

本设计文档定义了 MizuPanel Kubernetes 集群管理功能的完整技术方案。核心设计原则是：

1. **安全第一**: kubeconfig 不离开 Agent 节点
2. **渐进增强**: MVP 优先，分 4 个阶段实现
3. **体验一致**: 保持与现有 Docker 管理的交互模式一致
4. **架构复用**: 充分利用现有的 Agent-Server WebSocket 架构

**下一步行动**:
1. 评审并确认设计方案
2. 创建实现计划（implementation plan）
3. 开始阶段 1 开发

