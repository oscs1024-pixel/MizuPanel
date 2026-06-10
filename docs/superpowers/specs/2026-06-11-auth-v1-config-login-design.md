# Auth v1 配置管理员登录设计文档

## 背景

MizuPanel 当前已经具备节点监控、历史指标、安装命令生成、SSH 安装/卸载、Web 终端、文件管理、节点重启和 Agent 管理能力。面板不再只是只读监控页面，已经包含多项高权限运维入口。

当前预览版本没有登录门禁，`README.md` 也明确提示 `/api/install/command` 可以在未认证情况下生成安装 token。继续扩展 Agent 在线升级、服务管理、告警等能力前，需要先补上一个适合自用部署的最小管理员登录。

本版本采用配置文件明文管理员账号密码方案。项目当前定位是自用、小规模服务器管理，因此 Auth v1 不引入数据库用户表、密码哈希、首次初始化页面、多用户或 RBAC，优先解决“面板和敏感 API 不裸露”的问题。

## 目标

- 支持通过 `server.yaml` 配置管理员用户名和密码。
- 支持通过环境变量覆盖管理员登录配置，方便 Docker 和脚本部署。
- 新增登录、退出和会话状态 API。
- 前端启动时能判断当前是否需要登录、是否已登录。
- 登录成功后使用 HttpOnly session cookie 访问 Dashboard。
- 当认证开启时，保护 Dashboard 使用的敏感 API。
- 保持 Agent 自身注册、重连、WebSocket 上报逻辑不受 Dashboard 登录 cookie 影响。
- 自用范围内尽量保持实现简单、可理解、易维护。

## 非目标

- 不做首次初始化页面。
- 不做数据库用户表。
- 不做密码哈希或密文配置。
- 不做多管理员账号。
- 不做角色权限、RBAC、团队协作权限。
- 不做 OAuth、OIDC、2FA。
- 不做审计日志。
- 不做登录失败限流。
- 不做跨 Server 重启持久 session；Server 重启后重新登录可以接受。
- 不改变 Agent 的 install token / node token 认证模型。

## 配置设计

在 `server.yaml` 的 `security` 下新增 `admin` 配置：

```yaml
security:
  admin:
    enabled: true
    username: "admin"
    password: "your-password"
    session_ttl: "24h"
```

选择放在 `security.admin` 下，而不是新增顶层 `auth`，是为了延续现有 `security.agent_token` 的结构，避免安全相关配置分散。

### 默认值

```yaml
security:
  admin:
    enabled: false
    username: "admin"
    password: ""
    session_ttl: "24h"
```

默认不启用认证，避免升级已有本地部署后突然无法访问。用户需要显式设置：

```yaml
security:
  admin:
    enabled: true
    username: "admin"
    password: "自定义密码"
```

如果 `enabled: true` 但 `password` 为空，Server 启动应失败并输出明确错误，避免误以为空密码登录可用。

### 环境变量覆盖

支持以下环境变量：

```bash
MIZUPANEL_AUTH_ENABLED=true
MIZUPANEL_ADMIN_USERNAME=admin
MIZUPANEL_ADMIN_PASSWORD=your-password
MIZUPANEL_SESSION_TTL=24h
```

优先级：

```text
环境变量 > 配置文件 > 默认值
```

这让 Docker Compose 可以不修改配置文件，直接通过环境变量开启认证。

### 示例配置更新

需要同步更新：

- `server.example.yaml`
- `docker/server.sqlite.yaml`
- `docker/server.mysql.yaml`
- 如 release 包里有生成或复制的示例配置，也需要保持一致。

示例中不放真实密码，只保留注释：

```yaml
security:
  admin:
    enabled: false
    username: "admin"
    password: "" # Set this and enable admin auth before exposing MizuPanel beyond localhost.
    session_ttl: "24h"
```

## 后端认证设计

### 配置结构

`internal/server/config.Config` 增加：

```go
type AdminAuthConfig struct {
    Enabled    bool
    Username   string
    Password   string
    SessionTTL time.Duration
}
```

`Config` 增加：

```go
AdminAuth AdminAuthConfig
```

配置加载需要覆盖：

- YAML `security.admin.enabled`
- YAML `security.admin.username`
- YAML `security.admin.password`
- YAML `security.admin.session_ttl`
- 环境变量覆盖
- `session_ttl` 解析错误
- `enabled=true` 且 password 为空的错误

### Session 存储

Auth v1 使用内存 session store：

```text
random token -> username, expires_at
```

特点：

- token 使用加密安全随机数生成。
- cookie 保存明文随机 token。
- Server 端只保存在内存 map 中。
- Server 重启后 session 丢失，需要重新登录。
- 过期 session 在访问时清理，也可以在写入/读取时顺手清理。

Auth v1 不需要数据库迁移。

### Cookie

登录成功后设置：

```text
mizupanel_session=<random-token>
HttpOnly
SameSite=Lax
Path=/
Max-Age=<session_ttl>
```

`Secure` 策略：

- 如果请求是 HTTPS，则设置 `Secure`。
- 如果是 HTTP 本地/内网访问，不强制 `Secure`，避免自用部署无法登录。

退出登录时：

- 删除内存 session。
- 设置同名 cookie 过期。

### API

新增认证 API：

```text
GET  /api/auth/session
POST /api/auth/login
POST /api/auth/logout
```

#### `GET /api/auth/session`

用途：前端启动时判断认证状态。

认证关闭时返回：

```json
{
  "auth_enabled": false,
  "authenticated": true,
  "username": ""
}
```

认证开启且已登录：

```json
{
  "auth_enabled": true,
  "authenticated": true,
  "username": "admin"
}
```

认证开启但未登录：

```json
{
  "auth_enabled": true,
  "authenticated": false,
  "username": ""
}
```

#### `POST /api/auth/login`

请求：

```json
{
  "username": "admin",
  "password": "your-password"
}
```

行为：

- 认证关闭时可以返回当前已认证状态，不创建 session。
- 认证开启时，用户名和密码必须与配置完全匹配。
- 登录成功创建 session cookie。
- 登录失败返回 `401`。

成功响应：

```json
{
  "authenticated": true,
  "username": "admin"
}
```

失败响应：

```json
{
  "error": "invalid username or password"
}
```

#### `POST /api/auth/logout`

行为：

- 删除当前 session。
- 清除 cookie。
- 即使未登录也返回成功，方便前端幂等调用。

响应：

```json
{
  "ok": true
}
```

## API 保护范围

当 `security.admin.enabled = true` 时，除公开端点外，其余 Dashboard API 默认需要登录。

### 公开端点

- 前端静态资源。
- `GET /api/auth/session`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- Agent 注册、Agent WebSocket、Agent 上报相关端点，继续使用 install token / node token。
- 安装脚本和 Agent 二进制下载端点是否公开保持现状；生成安装 token 的 API 必须保护。

### 受保护端点

至少包括：

- 节点列表、节点删除。
- 指标历史查询。
- 系统设置读取和修改。
- 安装命令生成。
- SSH 安装/卸载。
- Web 终端 session 创建。
- 容器 exec session 创建。
- 文件管理。
- 节点重启。
- Agent 管理 status/restart/logs。
- 进程信息和 Docker 容器信息。

未登录访问受保护 API 返回：

```http
401 Unauthorized
```

```json
{
  "error": "authentication required"
}
```

## 前端体验设计

### 启动流程

`App` 初始化时调用：

```text
GET /api/auth/session
```

然后按状态渲染：

1. `auth_enabled=false`：直接进入 Dashboard。
2. `auth_enabled=true` 且 `authenticated=true`：进入 Dashboard。
3. `auth_enabled=true` 且 `authenticated=false`：显示登录页。
4. session 请求失败：显示可重试错误，不直接进入 Dashboard。

### 登录页

登录页保持轻量：

- MizuPanel 标识。
- 用户名输入框，默认值 `admin`。
- 密码输入框。
- 登录按钮。
- 登录失败提示。

登录成功后：

- 更新前端 session 状态。
- 加载 Dashboard 数据。

### 退出入口

Dashboard 顶部或设置区域显示：

```text
admin · 退出登录
```

点击退出：

- 调用 `POST /api/auth/logout`。
- 清空前端 session 状态。
- 回到登录页。

如果认证关闭，不显示登录用户和退出入口。

### API 401 处理

前端 API client 如果收到 `401`：

- 继续读取 JSON `{ error }`，保持现有错误透传能力。
- App 层将 session 状态置为未登录。
- 显示登录页，并提示：`登录已过期，请重新登录`。

为了避免每个页面重复处理，推荐在 App 传入 API client 或统一 request 层保留错误信息，再由 App 捕获认证错误。

## 错误处理

- `enabled=true` 且密码为空：Server 启动失败，提示配置 `security.admin.password` 或 `MIZUPANEL_ADMIN_PASSWORD`。
- `session_ttl` 解析失败：Server 启动失败，提示合法示例，例如 `24h`。
- 登录失败：返回 `401 invalid username or password`。
- 未登录访问受保护 API：返回 `401 authentication required`。
- session 过期：返回 `401 authentication required`，前端提示重新登录。
- 退出登录失败或 session 不存在：仍返回成功，保证幂等。

## 测试设计

### 后端配置测试

- 默认认证关闭，默认用户名 `admin`，默认 session TTL 为 `24h`。
- YAML 能开启认证并读取用户名、密码、TTL。
- 环境变量能覆盖 YAML。
- `enabled=true` 且密码为空时返回配置错误。
- 非法 `session_ttl` 返回配置错误。

### 后端 API / 中间件测试

- 认证关闭时，受保护 API 保持可访问。
- 认证开启且未登录时，受保护 API 返回 `401`。
- 登录成功会设置 HttpOnly cookie。
- 登录失败返回 `401`。
- 已登录 session 可以访问受保护 API。
- logout 后同一 cookie 无法继续访问受保护 API。
- session 过期后返回 `401`。
- Agent 注册/WebSocket/token 相关端点不被 Dashboard cookie 中间件误拦截。

### 前端测试

- 认证关闭时直接显示 Dashboard。
- 认证开启且未登录时显示登录页。
- 输入正确账号密码后调用 login，并显示 Dashboard。
- 登录失败时显示错误。
- 已登录时显示退出入口。
- 点击退出后回到登录页。
- Dashboard API 返回 `401` 时回到登录页并显示过期提示。

## 安全与自用边界

本设计承认并接受以下自用取舍：

- 管理员密码可以明文写在配置文件或环境变量里。
- 不做密码哈希和数据库用户。
- 不做登录失败限流。
- 不做 CSRF token。
- 不做多用户权限隔离。

同时保留必要底线：

- 未登录用户不能调用 Dashboard 敏感 API。
- session cookie 必须是 HttpOnly。
- session token 必须使用安全随机数。
- 登录失败不能返回“用户名不存在”或“密码错误”的区分信息。
- 配置中的密码不应通过任何 API 返回到浏览器。
- 日志中不打印管理员密码。

## 实施顺序建议

1. 扩展 Server 配置结构和示例配置。
2. 新增后端 Auth service / session store / middleware。
3. 接入 API 路由保护，明确公开端点白名单。
4. 新增 auth API client 类型和方法。
5. 新增前端登录页、session 启动流程和退出入口。
6. 补充 401 统一处理。
7. 更新 README 中“当前没有登录门禁”的提示。
8. 更新 CHANGELOG。
9. 跑 Go 测试、前端测试、前端 build 和 diff check。

## 未决事项

没有必须阻塞实现的未决事项。Auth v1 按配置文件明文管理员账号密码方案执行。后续如果需要更强安全模型，可以在 Auth v2 中增加数据库用户、密码哈希、首次初始化或多用户权限。