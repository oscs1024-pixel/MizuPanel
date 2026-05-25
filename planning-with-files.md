# MizuPanel v0.1 文件化计划

## 目标

构建 MizuPanel 第一个可运行 MVP：一个轻量级个人自托管服务器控制台，包含 Go Server、Go Agent、SQLite 持久化，以及 React/Vite/Tailwind 仪表盘。

## 已确认范围

v0.1 包含：

- Server 进程启动后暴露 REST API 和 Agent WebSocket 接入点。
- Agent 主动连接 Server；Agent 不暴露任何端口。
- Agent 发送 `hello` 和周期性指标消息。
- Server 根据 Agent 的 hello 消息创建或更新节点。
- Server 将 CPU、内存、磁盘、网络、负载和带时间戳的指标写入 SQLite。
- Dashboard 展示节点总览、节点详情、最新指标和历史图表。
- 指标保留时间默认 `6h`，并可通过 Server 配置文件调整。
- v0.1 前端时间范围只支持 `1h` 和 `6h`。
- v0.1 暂时不启用登录门禁，优先保证核心监控和添加主机流程可用。
- 添加主机会直接生成 install token 和安装命令。
- 安装命令以 `curl -fsSL` 开头，并从 Server 管理的端点下载安装脚本和 Agent 二进制。
- 安装脚本在目标机器上检测 OS/arch，并下载对应架构的 Agent 二进制。
- Agent 首次注册后使用长期的 per-node token。
- Makefile 构建 Server 二进制、Agent 多架构二进制和发布产物。

v0.1 不包含：

- Docker 管理。
- Kubernetes 管理。
- Web Terminal。
- 多用户权限系统。
- 复杂告警。
- 自动 SSH 安装。
- 安装器下载的 HTTPS、checksum 或签名校验。
- 在 UI 中暴露原始长期 Server token。

## 需求文档更新

实现前需要更新 `selfhost_console_ai_build_doc.md`：

- 将 v0.1 详情页时间范围从 `1h / 24h` 改为 `1h / 6h`。
- 增加 Server 指标保留配置要求。
- 增加默认保留时间：`6h`。
- 增加清理间隔配置，默认 `10m`。
- 记录 v0.1 暂时去掉登录门禁，添加主机可直接生成安装命令。
- 将旧的 `server.yaml` token 占位流程替换为 install-token 和 node-token 语言。
- 增加 Makefile / release artifact 要求。
- 增加 Agent 二进制下载和安装脚本下载要求。

## 部署与安装流程

安装流程应由 Server 驱动，并尽量降低用户操作成本：

1. 用户打开 Dashboard。
2. 用户从筛选工具栏点击 `添加主机`，不要放在顶部导航。
3. Server 为本次添加主机请求创建 install token。
4. 前端渲染完整的多行 `curl -fsSL` 命令。
5. 命令从 Server 下载 `install-agent.sh`。
6. 命令传入 install token 和 Agent 二进制下载基础地址。
7. 安装脚本在目标机器上用 `uname` 检测 OS/arch，并拼出正确的 Agent 二进制 URL 后下载。
8. 安装脚本写入目标机器的 `/usr/local/mizupanel/agent.yaml`。
9. Agent 首次注册后获取 per-node 长期 token，并在后续连接中使用该 token。
10. 已有节点后续可以从 UI 轮换自己的 per-node token。

## 需要创建或修改的文件

### 根目录

- `go.mod` — Go module 定义。
- `go.sum` — Go 依赖锁定文件。
- `.gitignore` — 忽略构建产物、本地配置、数据库文件和前端依赖。
- `planning-with-files.md` — 当前文件化计划。
- `selfhost_console_ai_build_doc.md` — 更新 6h 可配置保留时间和安装流程需求。
- `Makefile` — 构建 Server、Agent 和 release artifacts。

### Server

- `cmd/server/main.go` — Server 入口。
- `internal/server/config/config.go` — 加载 Server 配置和默认值。
- `internal/server/db/db.go` — SQLite 打开和初始化辅助逻辑。
- `internal/server/db/migrations.go` — schema 创建。
- `internal/server/store/nodes.go` — 节点持久化和查询。
- `internal/server/store/metrics.go` — 指标持久化和区间查询。
- `internal/server/retention/cleanup.go` — 按保留时间清理指标。
- `internal/server/agenthub/hub.go` — Agent WebSocket 处理。
- `internal/server/api/routes.go` — HTTP 路由注册。
- `internal/server/api/nodes.go` — 节点和指标 REST handler。
- `internal/server/app/app.go` — HTTP 路由组合、install-token 生成、安装命令和静态资源服务。
- `internal/server/api/routes.go` / `nodes.go` — 节点和指标 REST handler。
- `internal/server/downloads/` — Agent 二进制下载端点或文件服务支持。

### 共享协议

- `internal/protocol/messages.go` — Agent/Server 消息结构和常量。

### Agent

- `cmd/agent/main.go` — Agent 入口。
- `internal/agent/config/config.go` — 加载 Agent 配置和默认值。
- `internal/agent/metrics/collector.go` — 系统指标采集。
- `internal/agent/ws/client.go` — WebSocket 客户端连接和上报循环。

### 前端

- `web/package.json` — 前端脚本和依赖。
- `web/vite.config.ts` — Vite 配置。
- `web/tsconfig.json` — TypeScript 配置。
- `web/tailwind.config.js` — Tailwind 配置。
- `web/postcss.config.js` — PostCSS 配置。
- `web/index.html` — Vite HTML 入口。
- `web/src/main.tsx` — React 入口。
- `web/src/App.tsx` — 路由和页面外壳。
- `web/src/api/client.ts` — REST API client。
- `web/src/types.ts` — 前端 API 类型。
- `web/src/pages/NodeList.tsx` — Dashboard 节点总览。
- `web/src/pages/NodeDetail.tsx` — 节点详情和图表。
- `web/src/components/MetricCard.tsx` — 可复用指标摘要卡片。
- `web/src/components/MetricsChart.tsx` — 折线图组件。

### 部署产物

- `server.example.yaml` — Server 配置示例。
- `agent.example.yaml` — Agent 配置示例。
- `scripts/install-agent.sh` — 安装脚本。
- `systemd/mizupanel-agent.service` — systemd service unit。

## TDD 检查点

实现尽量按 test-first 推进。

1. 配置测试先于配置实现：
   - Server 默认值包含监听地址、SQLite 路径、`6h` 保留时间、`10m` 清理间隔。
   - 文件配置可覆盖默认值。
   - 非法保留时间返回错误。

2. 安装流程测试先于 handler 实现：
   - Dashboard 无需登录即可进入。
   - 用户可以直接创建 install token。
   - 生成的安装命令包含 `curl -fsSL`、install token 和二进制基础下载地址。
   - 关闭安装面板后焦点回到打开它的按钮。

3. 数据库 / store 测试先于持久化实现：
   - migrations 创建所需表。
   - 节点 upsert 可以创建和更新已有节点。
   - 指标插入和区间查询可用。
   - 清理逻辑只删除超过保留时间的行。

4. 协议测试先于 WebSocket 实现：
   - `hello`、`hello_ack` 和 `metrics` JSON 消息 marshal/unmarshal 正确。

5. API 测试先于 handler 实现：
   - 初始 `GET /api/nodes` 返回空列表。
   - 节点列表返回最新状态和最新指标。
   - `GET /api/nodes/:id/metrics?range=1h` 可用。
   - 非法 range 被拒绝。
   - 安装脚本和二进制下载端点可从同一个 Server 访问。

6. Agent 测试先于 client/collector 实现：
   - Agent 配置默认值和覆盖值可用。
   - WebSocket client 在测试 Server 中先发送 hello，再发送 metrics。
   - Agent 写入 Server 返回的 per-node token。

7. 构建产物测试先于 release packaging：
   - Make target 可以编译 Server 和 Agent 二进制。
   - release artifact 布局符合文档中的 `dist/` 输出。

8. 前端验证：
   - `npm run build` 通过。
   - 浏览器手动验证 Dashboard、节点详情、空状态、添加主机命令流和 `1h/6h` 选择器。

## 实现阶段

### Phase 1：需求和骨架

- 更新需求文档中的 `6h` 可配置保留时间。
- 初始化 Go module。
- 增加初始 Server、Agent 和共享协议包布局。
- 增加 Makefile 和 release artifact 布局。

### Phase 2：Server 配置和 SQLite

- 实现 Server 配置和默认值。
- v0.1 暂时不启用登录 / session 门禁。
- 实现 SQLite schema 和 repository 层。
- 实现 retention cleanup。

### Phase 3：Agent 协议和 WebSocket 接入

- 实现协议结构。
- 实现 Server WebSocket endpoint。
- 实现节点注册、install-token 交换和指标写入。

### Phase 4：Agent 指标上报

- 实现 Agent 配置。
- 实现系统指标采集。
- 实现 WebSocket 连接循环和周期上报。
- 首次注册后持久化 per-node token。

### Phase 5：REST API 和安装 / 下载端点

- 实现节点列表、节点详情和指标历史 API。
- 实现 install-token 和安装命令生成。
- 实现安装脚本下载和 Agent 二进制下载端点。
- v0.1 只支持 `1h` 和 `6h`。

### Phase 6：Web Dashboard

- 构建 React/Vite/Tailwind 应用。
- 实现总览页。
- 实现节点详情页。
- 实现图表和空 / 离线状态。
- 实现无登录添加主机流程。

### Phase 7：Packaging

- 增加 `server`、`agent` 和 release artifacts 的 Makefile target。
- 确保配置示例和 systemd unit 被包含到 release layout。

### Phase 8：验证

- 运行 Go tests。
- 构建前端。
- 本地运行 Server 和 Agent。
- 打开 Dashboard，确认节点出现并且图表持续填充。
- 验证添加主机命令生成和关闭 / 重开行为。

## 验证命令

```bash
go test ./...
go run ./cmd/server
go run ./cmd/agent
cd web && npm install && npm run build
make build
```

## 风险

- token 处理容易过度复杂；保持 install-token 和 node-token 职责分离。
- WebSocket 重连可能造成重复节点或过期节点状态；通过稳定 node identity 和 node upsert 缓解。
- retention cleanup 失败会导致 SQLite 增长；通过测试覆盖 cleanup，并默认 `6h` 保留。
- release artifacts 可能和文档漂移；Makefile 输出和 `dist/` 布局要保持明确。
- UI 如果赶工会显得通用模板化；优先保证总览和详情页达到参考图质量，而不是提前做未来功能。
