# 容器日志功能实现计划

## 需求
在容器列表的操作列增加日志按钮，点击后在页面下方弹出Modal查看容器日志（类似 `docker logs -f`）

## 架构设计

### 1. 协议层（Protocol）
新增消息类型：
- `container_logs_request` - 请求容器日志
- `container_logs_response` - 响应开始
- `container_logs_data` - 日志数据流
- `container_logs_stop` - 停止请求
- `container_logs_exit` - 日志流结束
- `container_logs_error` - 错误消息

消息结构：
```go
type ContainerLogsRequest struct {
    Type        string `json:"type"`
    SessionID   string `json:"session_id"`
    NodeID      string `json:"node_id"`
    ContainerID string `json:"container_id"`
    Lines       int    `json:"lines"`        // 初始显示行数（类似 tail -n）
    Follow      bool   `json:"follow"`       // 是否持续跟踪（类似 -f）
    Timestamps  bool   `json:"timestamps"`   // 是否显示时间戳
}

type ContainerLogsResponse struct {
    Type        string `json:"type"`
    SessionID   string `json:"session_id"`
    ContainerID string `json:"container_id"`
    Started     bool   `json:"started"`
    Error       string `json:"error,omitempty"`
}

type ContainerLogsData struct {
    Type      string `json:"type"`
    SessionID string `json:"session_id"`
    Data      string `json:"data"`     // 日志内容
    Stream    string `json:"stream"`   // "stdout" 或 "stderr"
}

// 其他消息类型复用 LogTailStop/Exit/Error 结构
```

### 2. Agent端实现

创建 `/internal/agent/docker/logs_manager.go`：
- 使用 Docker API `/containers/{id}/logs` 获取日志
- 支持 tail（初始行数）、follow（持续流）、timestamps
- 区分 stdout 和 stderr
- WebSocket 实时推送日志数据

参考实现：
```go
// 核心逻辑
func (m *LogsManager) Start(ctx context.Context, sessionID, containerID string, lines int, follow bool, timestamps bool, onData func(string, string), onExit func(error)) error
```

Docker API 调用：
```
GET /containers/{id}/logs?stdout=1&stderr=1&follow=1&tail=100&timestamps=0
```

### 3. Server端实现

在 `/internal/server/api/routes.go` 新增路由：
```
/api/nodes/{nodeID}/containers/{containerID}/logs/stream
```

WebSocket handler：
- 类似 handleNodeLogTail
- 转发 browser <-> agent 消息
- 管理会话生命周期

在 `/internal/server/agenthub/hub.go` 新增方法：
```go
func (h *Hub) AttachContainerLogs(ctx context.Context, nodeID, containerID string, browser *websocket.Conn) error
```

### 4. Frontend实现

#### 4.1 类型定义（types.ts）
```typescript
export type ContainerLogsRequest = {
  type: 'container_logs_request'
  session_id: string
  node_id: string
  container_id: string
  lines: number
  follow: boolean
  timestamps: boolean
}

export type ContainerLogsResponse = {
  type: 'container_logs_response'
  session_id: string
  container_id: string
  started: boolean
  error?: string
}

export type ContainerLogsData = {
  type: 'container_logs_data'
  session_id: string
  data: string
  stream: 'stdout' | 'stderr'
}
```

#### 4.2 UI组件

**NodeDetail.tsx 修改：**
1. DockerTable 操作列增加日志按钮
2. 新增 state 管理 Modal 显示状态
3. 操作列宽度从 10% 改为 12%

**新建 ContainerLogsModal.tsx：**
- Props: `{ nodeId, containerId, containerName, open, onClose }`
- WebSocket 连接容器日志流
- 支持搜索、自动滚动、清屏
- stdout/stderr 不同颜色显示
- 类似 LogViewer 的UI布局

UI布局：
```
┌─────────────────────────────────────────────────┐
│ 容器日志: nginx-web                        [✕] │
├─────────────────────────────────────────────────┤
│ [🔄 刷新] [100行▼] [□ 时间戳] [🔍搜索框] [⚡自动滚动] │
├─────────────────────────────────────────────────┤
│ 2024-06-15 10:30:01 stdout: Server started     │
│ 2024-06-15 10:30:05 stderr: Warning: ...       │
│ ...                                             │
│                                                 │
└─────────────────────────────────────────────────┘
```

#### 4.3 API Client（client.ts）
无需新增，直接使用 WebSocket

### 5. 实现步骤

#### Phase 1: 协议和Agent端
1. 定义协议消息类型（protocol/messages.go）
2. 实现 Agent Docker logs manager（agent/docker/logs_manager.go）
3. 在 Agent ws client 中处理容器日志消息

#### Phase 2: Server端
1. 新增 WebSocket 路由
2. 实现 hub 转发逻辑
3. 测试 Server <-> Agent 通信

#### Phase 3: Frontend
1. 更新类型定义
2. 创建 ContainerLogsModal 组件
3. 修改 DockerTable 增加日志按钮
4. 集成测试

## 技术细节

### Docker Logs API
- Endpoint: `/containers/{id}/logs`
- Query params:
  - `stdout=1&stderr=1` - 包含标准输出和错误
  - `follow=1` - 持续流式输出（类似 -f）
  - `tail=100` - 只显示最后N行
  - `timestamps=0` - 是否显示时间戳
  - `since` - 从某个时间点开始
- Response: Stream (text/plain with multiplexed frames)

### Stream 格式
Docker logs API 返回的是 multiplexed stream：
```
[8]byte header + payload
header[0] = stream type (0=stdin, 1=stdout, 2=stderr)
header[4:8] = payload size (big endian)
```

需要解析这个格式来区分 stdout/stderr

### 样式设计
- stdout: 默认前景色
- stderr: 红色文字
- 时间戳: 灰色
- 搜索高亮: 黄色背景

## 后续扩展
- [ ] 支持下载日志文件
- [ ] 支持日志级别过滤（如果日志是结构化的）
- [ ] 历史日志分页（不follow时）
- [ ] 多容器日志并排查看
