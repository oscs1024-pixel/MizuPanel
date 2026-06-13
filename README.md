<p align="center">
  <img src="assets/mizupanel-banner.svg" alt="MizuPanel banner" width="100%" />
</p>

<p align="center">
  <a href="https://go.dev/"><img alt="Go" src="https://img.shields.io/badge/Go-1.24-00ADD8?logo=go&logoColor=white"></a>
  <a href="https://react.dev/"><img alt="React" src="https://img.shields.io/badge/React-UI-61DAFB?logo=react&logoColor=0F172A"></a>
  <a href="https://vite.dev/"><img alt="Vite" src="https://img.shields.io/badge/Vite-build-646CFF?logo=vite&logoColor=white"></a>
  <a href="https://www.sqlite.org/"><img alt="SQLite" src="https://img.shields.io/badge/SQLite-storage-003B57?logo=sqlite&logoColor=white"></a>
  <a href="https://www.docker.com/"><img alt="Docker" src="https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white"></a>
  <a href="https://www.mysql.com/"><img alt="MySQL" src="https://img.shields.io/badge/MySQL-optional-4479A1?logo=mysql&logoColor=white"></a>
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-monitoring-14B8A6">
  <img alt="Status" src="https://img.shields.io/badge/status-v0.1_preview-F59E0B">
</p>

<p align="center">
  <strong>轻量级自托管服务器监控面板</strong>
</p>

<p align="center">
  中文 · <a href="README.en.md">English</a>
</p>

---

## 概览

MizuPanel 是一个面向个人服务器和小型服务器集群的轻量级自托管监控面板。它由 Server、Dashboard 和 Agent 组成。Agent 主动通过 WebSocket 连接 Server，并上报 CPU、内存、磁盘、网络和负载指标。

默认情况下 Dashboard 不需要登录即可访问。如果需要保护 Dashboard，可以在配置文件或环境变量中启用管理员认证：

```yaml
security:
  admin:
    enabled: true
    username: admin
    password: your-secret-password
    session_ttl: 24h
```

或通过环境变量：

```bash
MIZUPANEL_AUTH_ENABLED=true
MIZUPANEL_ADMIN_USERNAME=admin
MIZUPANEL_ADMIN_PASSWORD=your-secret-password
MIZUPANEL_SESSION_TTL=24h
```

启用后，Dashboard 所有敏感 API（节点管理、系统设置、Agent 安装）都需要先登录。Agent WebSocket 连接不受影响。

## 功能特性

核心功能：

- 多节点服务器列表和节点详情。
- CPU、内存、磁盘、网络和 Load 指标。
- 历史指标查询，默认指标保留 6 小时。
- Dashboard 生成 Linux 和 Windows Agent 安装命令。
- Agent 主动连接 Server；目标主机不需要暴露 Agent 端口。

技术栈与部署：

- React + Vite + Tailwind CSS v3 Dashboard。
- Server 托管 Web 静态资源、安装脚本和 Agent 下载文件。
- SQLite 本地持久化，可选 MySQL 存储。
- Docker Compose 部署，默认使用 SQLite。
- 一次性 `install_token` 用于首次注册，长期 `node_token` 用于后续重连。
- Release 包内置 Linux amd64 / arm64 和 Windows amd64 Agent 二进制。

## 架构

<p align="center">
  <img src="assets/mizupanel-architecture.svg" alt="MizuPanel architecture diagram" width="100%" />
</p>

## 界面预览

| Dashboard | 历史记录 |
| --- | --- |
| <img src="assets/screenshots/dashboard.png" alt="MizuPanel Dashboard" width="100%" /> | <img src="assets/screenshots/history.png" alt="指标历史记录" width="100%" /> |

| 系统设置 | 添加主机 |
| --- | --- |
| <img src="assets/screenshots/settings.png" alt="系统设置" width="100%" /> | <img src="assets/screenshots/add-host.png" alt="添加主机" width="100%" /> |

| Web 终端 |
| --- |
| <img src="assets/screenshots/terminal.png" alt="Web 终端" width="100%" /> |

## Docker 快速启动

Docker 是目前最简单的运行方式。默认 Compose 使用 SQLite，所以一条命令即可启动：

```bash
docker compose up -d
```

打开 Dashboard：

```text
http://127.0.0.1:8080
```

默认情况下 Compose 只绑定 `127.0.0.1`。你自己在服务器或局域网使用时，可以显式开放：

```bash
MIZUPANEL_BIND_ADDR=0.0.0.0 docker compose up -d
```

然后打开：

```text
http://你的服务器IP:8080
```

SQLite 模式使用 `docker/server.sqlite.yaml`，镜像构建时会把它复制为容器内的 `/app/server.yaml`。运行数据会持久化到：

```text
./data/mizupanel.db
```

常用命令：

```bash
docker compose logs -f
docker compose down
```

### Docker 使用 MySQL

MySQL Compose 使用 `docker/server.mysql.yaml`，启动时会挂载到容器内的 `/app/server.yaml`。先通过环境变量设置数据库信息：

```bash
export MIZUPANEL_MYSQL_DATABASE=mizupanel
export MIZUPANEL_MYSQL_USERNAME=mizupanel
export MIZUPANEL_MYSQL_PASSWORD='换成你的数据库密码'
export MIZUPANEL_MYSQL_ROOT_PASSWORD='换成你的Root密码'
```

启动 MySQL 版本：

```bash
docker compose -f docker-compose.mysql.yml up -d
```

如果需要让服务器 IP 或局域网访问，显式开放绑定地址：

```bash
MIZUPANEL_BIND_ADDR=0.0.0.0 docker compose -f docker-compose.mysql.yml up -d
```

MySQL 数据保存在 Docker volume：

```text
mizupanel_mizupanel-mysql-data
```

停止但保留数据：

```bash
docker compose -f docker-compose.mysql.yml down
```

停止并删除 MySQL 数据 volume：

```bash
docker compose -f docker-compose.mysql.yml down -v
```

## Release 包结构

按 Server 所在机器架构选择对应的发布包目标：

```bash
make package-linux-amd64 # x86_64 / amd64 服务器
make package-linux-arm64 # ARM64 / aarch64 服务器
```

`make build`、`make package` 和 `make build-x86` 会构建 amd64 包；`make build-arm` 会构建 arm64 包。

选中的目标会生成对应 release 目录和压缩包：

```text
dist/
├── mizupanel-linux-amd64/
├── mizupanel-linux-amd64.tar.gz
├── mizupanel-linux-arm64/
└── mizupanel-linux-arm64.tar.gz
```

每个解压后的包都包含：

```text
mizupanel-linux-amd64/
├── mizupanel-server
├── server.example.yaml
├── data/
├── scripts/
│   ├── install-agent.sh
│   ├── install-agent.ps1
│   ├── uninstall-agent.sh
│   └── uninstall-agent.ps1
├── systemd/
│   ├── mizupanel-server.service
│   └── mizupanel-agent.service
├── downloads/
│   ├── mizupanel-agent-linux-amd64
│   ├── mizupanel-agent-linux-arm64
│   └── mizupanel-agent-windows-amd64.exe
└── web/
    ├── index.html
    └── assets/
```

Server 使用 CGO SQLite，所以 arm64 Server 包需要 arm64 C 交叉编译器，例如 `aarch64-linux-gnu-gcc`。Debian/Ubuntu 可以通过 `sudo apt install gcc-aarch64-linux-gnu` 安装。

## 发布包部署

### 1. 准备 release 目录

```bash
make build
tar -xzf dist/mizupanel-linux-amd64.tar.gz
cd mizupanel-linux-amd64
cp server.example.yaml server.yaml
```

arm64 服务器请执行 `make package-linux-arm64` 并改用 `mizupanel-linux-arm64.tar.gz`。`server.example.yaml` 是版本管理里的配置模板。`server.yaml` 是本机运行时配置，复制出来后可以按实际环境修改，不会影响模板文件。发布包已包含 `data/` 目录，默认数据库路径会写入 `./data/mizupanel.db`。

### 2. 修改 `server.yaml`

```yaml
server:
  listen: ":8080" # MizuPanel Server 的 HTTP 监听地址。
  public_url: "" # 用于生成 Agent 安装命令的公网面板地址；留空时会从请求 Host 推断。
  enable_terminal: true # 启用浏览器终端路由；Linux Agent 仍需 features.terminal: true。

storage:
  driver: "sqlite" # sqlite | mysql，默认使用 SQLite。
  database_path: "./data/mizupanel.db" # 旧版 SQLite 路径配置，保留兼容。
  sqlite:
    path: "./data/mizupanel.db"
  mysql:
    host: "127.0.0.1"
    port: 3306
    username: "mizupanel"
    password: ""
    database: "mizupanel"

metrics:
  retention: "6h" # 历史指标保留时间。
  cleanup_interval: "10m" # 按保留策略清理历史指标的执行间隔。

security:
  # agent_token 是可选配置，只在你需要长期 bootstrap token 时设置。
  # 推荐优先使用 Dashboard 生成的一次性 install token 添加主机。
  # agent_token: "change-this-to-a-random-secret" # 可选的长期 Agent bootstrap token；不要暴露在浏览器或公开文档里。
```

如果 Agent 会从其他机器访问面板，建议设置 `public_url`：

```yaml
server:
  public_url: "http://你的服务器IP:8080"
```

### 3. 直接启动 Server

```bash
./mizupanel-server -config server.yaml
```

打开：

```text
http://你的服务器IP:8080
```

### 4. 可选：使用 systemd 托管

Release 包内置 `systemd/mizupanel-server.service` 示例，适合安装到 `/opt/mizupanel` 后托管运行；按实际路径调整 service 文件后执行 `systemctl enable --now mizupanel-server` 即可。

## Agent 设置

打开 Dashboard，点击 **添加主机**。Linux 主机可以选择 **SSH 自动安装**，由 Server 一次性使用你输入的 root SSH 凭据完成安装；也可以选择 **手动命令安装**，复制命令到目标机器执行。SSH 凭据不会保存到数据库、不会回显，也不会写入日志。

Linux 安装默认按自用 root 运维模式执行，会自动启用节点终端和 Docker 容器监控。第一版 SSH 自动安装/卸载只支持 Linux root 用户，不支持 sudo 和 Windows。Linux 手动安装/卸载命令也要求在 root shell 中执行。

<details>
<summary>Linux 安装命令示例</summary>

```bash
curl -fsSL 'http://你的面板地址:8080/scripts/install-agent.sh' -o install-agent.sh \
  && chmod +x install-agent.sh \
  && ./install-agent.sh \
    --binary-base-url 'http://你的面板地址:8080/downloads' \
    --server-url 'ws://你的面板地址:8080/api/agent/ws' \
    --token 'one-time-install-token' \
    --mode 'ops' \
    --node-id "$(hostname)" \
    --name "$(hostname)" \
    --enable-docker \
    --enable-terminal
```

</details>

<details>
<summary>Windows 安装命令示例</summary>

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "`$ErrorActionPreference='Stop'; `$script = Join-Path `$env:TEMP ('mizupanel-install-' + [guid]::NewGuid().ToString() + '.ps1'); Invoke-WebRequest -Uri 'http://你的面板地址:8080/scripts/install-agent.ps1' -UseBasicParsing -OutFile `$script -ErrorAction Stop; & `$script `
    -BinaryBaseUrl 'http://你的面板地址:8080/downloads' `
    -ServerUrl 'ws://你的面板地址:8080/api/agent/ws' `
    -Token 'one-time-install-token' `
    -NodeId `$env:COMPUTERNAME `
    -Name `$env:COMPUTERNAME"
```

</details>

Linux 安装脚本会从 `downloads/` 中选择匹配系统架构的 Agent 文件，然后安装为：

```text
/usr/local/mizupanel/mizupanel-agent
/usr/local/mizupanel/agent.yaml
/etc/systemd/system/mizupanel-agent.service
```

查看 Linux Agent 服务：

```bash
systemctl status mizupanel-agent
journalctl -u mizupanel-agent -f
```

Linux Agent 安装权限：

- `/usr/local/mizupanel` 由 `root:root` 管理。
- `/usr/local/mizupanel/mizupanel-agent` 由 root 拥有并可执行。
- `/usr/local/mizupanel/agent.yaml` 由 `mizupanel-agent:mizupanel-agent` 拥有，权限为 `0600`。
- systemd `ReadWritePaths` 只允许写入 `agent.yaml`，Agent 可以持久化换发后的 `node_token`，但不能替换自己的二进制文件。

Windows 安装脚本会下载 `mizupanel-agent-windows-amd64.exe`，安装为 `C:\Program Files\MizuPanel\mizupanel-agent.exe`，写入 `C:\Program Files\MizuPanel\agent.yaml`，并注册 `mizupanel-agent` Windows Service。

卸载 Linux Agent：

```bash
curl -fsSL 'http://你的面板地址:8080/scripts/uninstall-agent.sh' -o uninstall-agent.sh \
  && chmod +x uninstall-agent.sh \
  && ./uninstall-agent.sh
```

卸载 Windows Agent 需要在管理员 PowerShell 中执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "`$ErrorActionPreference='Stop'; `$script = Join-Path `$env:TEMP ('mizupanel-uninstall-' + [guid]::NewGuid().ToString() + '.ps1'); Invoke-WebRequest -Uri 'http://你的面板地址:8080/scripts/uninstall-agent.ps1' -UseBasicParsing -OutFile `$script -ErrorAction Stop; & `$script"
```

卸载会停止并删除 Agent 服务，同时删除 Agent 安装目录；不会删除 Server 数据库里的节点记录或历史指标。

生成的 Agent 配置使用分块 YAML：

```yaml
server:
  url: "ws://你的面板地址:8080/api/agent/ws"
  token: "one-time-install-token"

node:
  id: "oracle-sg-01"
  name: "Oracle SG"

runtime:
  interval: "5s"
  mode: "ops"

features:
  docker: true
  terminal: true
```

## Token 模型

| Token           | 生命周期           | 谁生成                                     | 存放位置                              | 用途                  |
| --------------- | ------------------ | ------------------------------------------ | ------------------------------------- | --------------------- |
| `install_token` | 一次性             | Dashboard 创建添加主机命令时由 Server 生成 | 不持久化给 Agent                      | 只用于 Agent 首次注册 |
| `node_token`    | 长期，每个节点独立 | Server 在首次注册成功后换发                | Agent 本机配置文件；Server 端保存哈希 | Agent 重启和断线重连  |

注册流程：

```text
Dashboard 生成 install_token
        ↓
Agent 首次注册
        ↓
Server 验证 install_token
        ↓
Server 换发 node_token
        ↓
Agent 后续使用 node_token 重连
```

`install_token` 不应作为持久凭据使用；`node_token` 在 Server 端只保存哈希，不保存明文。

## 致谢

感谢 Linux.do 社区的反馈、讨论和启发。

<p align="center">
  <a href="https://linux.do/"><img alt="Linux.do community" src="https://img.shields.io/badge/Linux.do-community-0ea5e9?style=for-the-badge"></a>
</p>
