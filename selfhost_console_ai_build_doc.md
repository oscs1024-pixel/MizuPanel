# 轻量自托管服务器控制台：AI 实现需求文档

## 0. 项目目标

做一个面向个人自托管用户的轻量服务器控制台。

核心功能：

- 管理多台服务器节点
- 实时查看 CPU / 内存 / 磁盘 / 网络
- 查看节点详情和历史曲线
- 管理 Docker 容器
- 查看进程列表
- 后续支持 Kubernetes，通过某台带 kubeconfig 的机器代理访问
- 后续支持 Web Terminal

项目风格：

- 清爽
- 好看
- 轻量
- 个人用户友好
- 不做企业运维平台
- 不做复杂权限系统
- 不做大而全后台

一句话定位：

> 一个清爽好看的个人自托管服务器控制台，统一查看 VPS、Docker、K8s、进程和终端。

---

## 1. 技术栈要求

### Server

使用 Go。

推荐：

- Go
- Gin 或 Echo
- SQLite
- WebSocket
- JWT 或简单 Session

Server 负责：

- 提供 Web API
- 提供前端静态资源
- 保存节点信息
- 保存历史监控数据
- 管理 Agent 连接
- 向 Agent 下发 Docker / 进程 / K8s 操作

### Agent

使用 Go。

Agent 安装在每台被监控机器上。

Agent 负责：

- 采集系统指标
- 采集 Docker 信息
- 采集进程信息
- 主动连接 Server
- 接收 Server 下发的操作请求
- 返回执行结果

Agent 不需要暴露端口，必须主动连接 Server。

### Frontend

使用：

- React
- Vite
- TypeScript
- Tailwind CSS
- Recharts 或 ECharts

前端风格：

- 白色 / 浅色为主
- 卡片式布局
- 圆角
- 轻阴影
- 清爽留白
- 支持暗色模式可后续再做

---

## 2. 项目结构

建议目录：

```txt
server-console/
  server/
    cmd/server/main.go
    internal/api/
    internal/db/
    internal/model/
    internal/agent/
    internal/service/
    internal/ws/
  agent/
    cmd/agent/main.go
    internal/collector/
    internal/docker/
    internal/process/
    internal/k8s/
    internal/client/
  web/
    src/
      pages/
      components/
      api/
      types/
      hooks/
  README.md
  docker-compose.yml
```

---

## 3. 版本规划

### v0.1：基础节点监控

第一版只做多节点监控。

功能：

- Server 启动
- Agent 启动
- Agent 注册到 Server
- Agent 定时上报机器状态
- Dashboard 展示节点列表
- Dashboard 展示节点详情
- 支持 CPU / 内存 / 磁盘 / 网络实时数据
- 支持简单历史曲线

不做：

- Docker 操作
- K8s
- 终端
- 复杂告警
- 多用户权限

### v0.2：Docker 管理

功能：

- Agent 读取 Docker 容器列表
- 前端显示容器名称、镜像、状态、端口、运行时间
- 查看容器日志
- 重启容器
- 停止容器
- 启动容器

### v0.3：进程管理

功能：

- Agent 读取进程列表
- 前端显示进程名、PID、CPU、内存、命令
- 支持搜索
- 支持按 CPU / 内存排序
- 后续支持 kill 进程

### v0.4：K8s 管理

功能：

- 某台 Agent 可以启用 K8s 功能
- Agent 读取本机 kubeconfig
- Server 通过这个 Agent 查询 K8s 信息
- 前端显示 Namespace、Node、Pod、Deployment、Service
- 查看 Pod 日志
- 重启 Pod

注意：Server 不直接保存 kubeconfig，不直接连接 K8s。

### v0.5：Web Terminal

功能：

- 节点级开启终端功能
- 浏览器连接远程 shell
- WebSocket 转发输入输出
- 默认关闭
- 操作需要确认

---

## 4. v0.1 详细需求

## 4.1 首页：节点总览

页面路径：

```txt
/
```

首页展示：

顶部统计卡片：

- 节点总数
- 在线节点数
- 离线节点数
- 平均 CPU
- 平均内存
- 平均磁盘

节点列表支持两种视图：

- 卡片视图
- 表格视图

节点卡片内容：

- 节点名称
- 在线 / 离线状态
- 系统类型，例如 linux/amd64
- CPU 使用率
- 内存使用率
- 磁盘使用率
- 上传速度
- 下载速度
- 最后在线时间

需要搜索：

- 按节点名称搜索
- 按 IP 搜索

需要筛选：

- 全部
- 在线
- 离线

点击节点卡片进入节点详情页。

---

## 4.2 节点详情页

页面路径：

```txt
/nodes/:id
```

详情页展示：

基础信息：

- 节点名称
- IP
- 系统
- 架构
- 内核版本
- 运行时间
- Agent 版本
- 在线状态

硬件信息：

- CPU 核心数
- 内存总量
- 磁盘总量

图表区域：

- CPU 使用率曲线
- 内存使用率曲线
- 磁盘使用率曲线
- 网络上传 / 下载曲线

时间范围：

- 1 小时
- 6 小时
- 24 小时
- 7 天

v0.1 中只需要 1 小时和 6 小时即可。指标默认只保留最近 6 小时，可通过 Server 配置文件调整。

---

## 5. Agent 上报数据

Agent 每 3 秒或 5 秒采集一次系统状态，上报给 Server。

推荐上报结构：

```json
{
  "type": "metrics",
  "node_id": "node_xxx",
  "timestamp": 1710000000,
  "system": {
    "hostname": "oracle-sg",
    "os": "linux",
    "arch": "arm64",
    "kernel": "6.1.0",
    "uptime": 123456
  },
  "cpu": {
    "cores": 4,
    "usage": 17.6
  },
  "memory": {
    "total": 25165824000,
    "used": 7784628224,
    "usage": 30.9
  },
  "disk": {
    "total": 210453397504,
    "used": 58823434240,
    "usage": 28.1
  },
  "network": {
    "rx_speed": 10240,
    "tx_speed": 2048,
    "rx_total": 1234567890,
    "tx_total": 987654321
  },
  "load": {
    "load1": 0.2,
    "load5": 0.15,
    "load15": 0.1
  }
}
```

单位要求：

- usage 使用百分比，范围 0 到 100
- 内存、磁盘、流量使用 bytes
- 网络速度使用 bytes/s
- uptime 使用 seconds

---

## 6. Server 数据库设计

使用 SQLite。

指标保留策略：

- 默认保留最近 6 小时的 `node_metrics`
- Server 配置文件可调整保留时间，例如 `1h`、`6h`、`24h`、`7d`
- 默认每 10 分钟执行一次清理
- v0.1 前端只展示 1 小时和 6 小时时间范围

### nodes 表

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hostname TEXT,
  ip TEXT,
  os TEXT,
  arch TEXT,
  kernel TEXT,
  agent_version TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  last_seen_at DATETIME,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
```

### node_metrics 表

```sql
CREATE TABLE node_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  cpu_usage REAL,
  cpu_cores INTEGER,
  memory_total INTEGER,
  memory_used INTEGER,
  memory_usage REAL,
  disk_total INTEGER,
  disk_used INTEGER,
  disk_usage REAL,
  rx_speed INTEGER,
  tx_speed INTEGER,
  rx_total INTEGER,
  tx_total INTEGER,
  load1 REAL,
  load5 REAL,
  load15 REAL,
  created_at DATETIME NOT NULL
);
```

### node_tokens 表

```sql
CREATE TABLE node_tokens (
  node_id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  created_at DATETIME NOT NULL
);
```

`token` 存储为带版本前缀的哈希值，Agent 连接时使用明文 node token 通过 `Authorization: Bearer` 发送。

---

## 7. Server API

### 登录

v0.1 暂时不启用登录门禁，先保证 Dashboard、节点接入和添加主机流程可直接使用。

### 节点

```txt
GET /api/nodes
GET /api/nodes/:id
GET /api/nodes/:id/metrics?range=1h
GET /api/nodes/:id/metrics?range=6h
```

### Agent

Agent 使用 WebSocket 连接：

```txt
GET /api/agent/ws?token=xxx
```

连接成功后：

- Agent 发送 hello 消息
- Server 返回 node_id
- Agent 定时发送 metrics

---

## 8. WebSocket 消息协议

### Agent -> Server: hello

```json
{
  "type": "hello",
  "agent_version": "0.1.0",
  "hostname": "oracle-sg",
  "name": "Oracle",
  "os": "linux",
  "arch": "arm64",
  "kernel": "6.1.0"
}
```

### Server -> Agent: hello_ack

```json
{
  "type": "hello_ack",
  "node_id": "node_abc123",
  "interval": 5
}
```

### Agent -> Server: metrics

使用第 5 节的 metrics 结构。

### Server -> Agent: ping

```json
{
  "type": "ping"
}
```

### Agent -> Server: pong

```json
{
  "type": "pong"
}
```

---

## 9. v0.2 Docker 需求

Agent 检测本机 Docker 是否可用。

如果 Docker 可用，上报容器列表。

容器数据结构：

```json
{
  "id": "abc123",
  "name": "nginx",
  "image": "nginx:latest",
  "state": "running",
  "status": "Up 3 days",
  "ports": ["80:80", "443:443"],
  "created_at": "2024-01-01T00:00:00Z"
}
```

Server API：

```txt
GET  /api/nodes/:id/docker/containers
GET  /api/nodes/:id/docker/containers/:container_id/logs
POST /api/nodes/:id/docker/containers/:container_id/start
POST /api/nodes/:id/docker/containers/:container_id/stop
POST /api/nodes/:id/docker/containers/:container_id/restart
```

前端页面：

- 节点详情页增加 Docker Tab
- 表格显示容器列表
- 每个容器支持查看日志
- 每个容器支持启动 / 停止 / 重启

---

## 10. v0.3 进程需求

Agent 读取进程列表。

进程数据结构：

```json
{
  "pid": 1234,
  "name": "node",
  "username": "root",
  "cpu_usage": 3.2,
  "memory_usage": 5.1,
  "memory_bytes": 123456789,
  "cmdline": "node server.js"
}
```

Server API：

```txt
GET /api/nodes/:id/processes
POST /api/nodes/:id/processes/:pid/kill
```

前端：

- 节点详情页增加 Processes Tab
- 支持搜索
- 支持按 CPU 排序
- 支持按内存排序

Kill 进程功能可以先不做，或者默认隐藏。

---

## 11. v0.4 K8s 需求

K8s 设计重点：

- Server 不保存 kubeconfig
- Agent 读取本机 kubeconfig
- Dashboard 的请求通过 Server 转发给指定 Agent
- Agent 使用 kubeconfig 访问 K8s API

Agent 配置：

```yaml
k8s:
  enabled: true
  kubeconfig: /root/.kube/config
```

前端功能：

- 节点详情页增加 Kubernetes Tab
- 展示当前 context
- 展示 Namespace
- 展示 Nodes
- 展示 Pods
- 展示 Deployments
- 展示 Services
- 支持查看 Pod 日志
- 支持重启 Pod

API：

```txt
GET  /api/nodes/:id/k8s/info
GET  /api/nodes/:id/k8s/namespaces
GET  /api/nodes/:id/k8s/pods?namespace=default
GET  /api/nodes/:id/k8s/deployments?namespace=default
GET  /api/nodes/:id/k8s/services?namespace=default
GET  /api/nodes/:id/k8s/pods/:pod/logs?namespace=default
POST /api/nodes/:id/k8s/pods/:pod/restart?namespace=default
```

第一版 K8s 不需要支持：

- Helm
- CRD
- YAML 编辑
- RBAC 管理
- Ingress 编辑

---

## 12. v0.5 Web Terminal 需求

Web Terminal 默认关闭。

Agent 配置：

```yaml
terminal:
  enabled: false
  shell: /bin/bash
```

Server API：

```txt
POST /api/nodes/:id/terminal/session
WS   /api/nodes/:id/terminal/ws?session_id=xxx
```

要求：

- 用户必须手动开启终端功能
- 终端连接需要鉴权
- 会话超时自动关闭
- 每次开启终端记录日志
- 危险命令不在第一版拦截，后续再做

---

## 13. UI 页面需求

### 首页

包含：

- 顶部导航
- 项目 Logo / 名称
- 刷新按钮
- 主题按钮，后续可做
- 统计卡片
- 搜索框
- 状态筛选
- 卡片视图 / 表格视图切换
- 节点卡片列表

### 节点详情页

包含：

- 返回按钮
- 节点标题
- 在线状态
- 基础信息卡片
- 资源信息卡片
- 时间范围选择
- 指标曲线
- Tabs：Overview / Docker / Processes / Kubernetes / Terminal

v0.1 只实现 Overview。

### Docker Tab

包含：

- 容器列表
- 搜索
- 状态筛选
- 查看日志按钮
- 重启按钮

### Processes Tab

包含：

- 进程表格
- 搜索
- CPU / 内存排序

### Kubernetes Tab

包含：

- Context 信息
- Namespace 选择
- Pod 表格
- Deployment 表格
- Service 表格
- Pod 日志弹窗

---

## 14. UI 风格要求

整体参考：

- 清爽白色背景
- 卡片布局
- 轻微玻璃感
- 圆角 16px 到 24px
- 轻阴影
- 低饱和色
- 指标颜色明确，但不要刺眼

首页节点卡片风格：

- 节点名明显
- 在线状态用绿色小圆点
- CPU / 内存 / 磁盘用进度条
- 网络上下行用小型文本展示
- 卡片 hover 有轻微浮动

不要做成传统后台模板。

---

## 15. 开发顺序

### 第一步

搭建 monorepo：

- server
- agent
- web

### 第二步

实现 Server：

- SQLite 初始化
- 节点表
- 指标表
- WebSocket 接收 Agent
- REST API 查询节点

### 第三步

实现 Agent：

- 读取配置
- 连接 Server
- 发送 hello
- 采集 CPU / 内存 / 磁盘 / 网络
- 定时上报 metrics

### 第四步

实现 Web：

- 首页节点列表
- 节点卡片
- 节点详情页
- 曲线图

### 第五步

完善部署：

- Server Dockerfile
- Agent 安装命令
- README
- 示例截图

---

## 16. README 首屏文案

项目名暂定：

- CoolPanel
- LitePanel
- SelfDash
- NodeNest
- Hostora
- MizuPanel

英文简介：

```txt
A lightweight and beautiful self-hosted server console for personal VPS, Docker, Kubernetes, processes, and terminal management.
```

中文简介：

```txt
一个轻量、清爽、好看的个人自托管服务器控制台，统一监控和管理 VPS、Docker、Kubernetes、进程与终端。
```

README 展示重点：

- 一张首页截图
- 一张节点详情截图
- 一张 Docker 管理截图
- 一条 Agent 安装命令
- 一条 Docker Compose 启动命令

---

## 17. 第一版完成标准

v0.1 完成后必须达到：

- 可以通过 Docker Compose 启动 Server
- 可以在 Linux 机器上启动 Agent
- Agent 能连接 Server
- Server 能显示在线节点
- 能看到 CPU / 内存 / 磁盘 / 网络
- 能看到历史曲线
- 节点离线后能显示离线
- UI 能作为 GitHub README 截图展示

v0.1 不要求：

- Docker 管理
- K8s
- 终端
- 复杂登录
- 告警
- 多用户

