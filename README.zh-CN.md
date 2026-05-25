<p align="center">
  <img src="assets/mizupanel-banner.svg" alt="MizuPanel banner" width="100%" />
</p>

<p align="center">
  <a href="https://go.dev/"><img alt="Go" src="https://img.shields.io/badge/Go-1.24-00ADD8?logo=go&logoColor=white"></a>
  <a href="https://react.dev/"><img alt="React" src="https://img.shields.io/badge/React-UI-61DAFB?logo=react&logoColor=0F172A"></a>
  <a href="https://vite.dev/"><img alt="Vite" src="https://img.shields.io/badge/Vite-build-646CFF?logo=vite&logoColor=white"></a>
  <a href="https://www.sqlite.org/"><img alt="SQLite" src="https://img.shields.io/badge/SQLite-storage-003B57?logo=sqlite&logoColor=white"></a>
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-monitoring-14B8A6">
  <img alt="Status" src="https://img.shields.io/badge/status-v0.1_preview-F59E0B">
</p>

<p align="center">
  <strong>轻量级自托管服务器监控面板</strong>
</p>

<p align="center">
  <a href="README.md">English</a> · 中文
</p>

---

## 概览

MizuPanel 是一个面向个人服务器和小型服务器集群的轻量级自托管监控面板。它由 Server、Dashboard 和 Agent 组成。Agent 主动通过 WebSocket 连接 Server，并上报 CPU、内存、磁盘、网络和负载指标。

> 注意：当前预览版本暂时没有登录门禁。`/api/install/command` 可以在未认证情况下生成安装 token。公网暴露 MizuPanel 之前，请先恢复最小管理员认证。

## 功能特性

- 多节点服务器列表和节点详情。
- CPU、内存、磁盘、网络和 Load 指标。
- SQLite 本地持久化，默认指标保留 6 小时。
- React + Vite + Tailwind CSS v3 Dashboard。
- Server 托管 Web 静态资源、安装脚本和 Agent 下载文件。
- Agent 主动连接 Server；目标主机不需要暴露 Agent 端口。
- Dashboard 生成 `curl -fsSL` 安装命令。
- 一次性 `install_token` 用于首次注册，长期 `node_token` 用于后续重连。
- Release 包内置 Linux amd64 / arm64 Agent 二进制。

## 架构

```text
Browser Dashboard
      |
      | REST API / static web
      v
MizuPanel Server  <---------------- WebSocket ----------------  MizuPanel Agent
      |                                                        target host
      | SQLite
      v
nodes / metrics / node tokens
```

## Release 包结构

执行 `make build` 后会生成：

```text
dist/mizupanel/
├── mizupanel-server
├── server.example.yaml
├── scripts/
│   └── install-agent.sh
├── systemd/
│   ├── mizupanel-server.service
│   └── mizupanel-agent.service
├── downloads/
│   ├── mizupanel-agent-linux-amd64
│   └── mizupanel-agent-linux-arm64
└── web/
    ├── index.html
    └── assets/
```

## Server 设置

### 1. 准备 release 目录

```bash
make build
cd dist/mizupanel
cp server.example.yaml server.yaml
```

`server.example.yaml` 是版本管理里的配置模板。`server.yaml` 是本机运行时配置，复制出来后可以按实际环境修改，不会影响模板文件。

### 2. 修改 `server.yaml`

```yaml
listen: ":8080" # MizuPanel Server 的 HTTP 监听地址。
database_path: "./data/mizupanel.db" # SQLite 数据库路径，用于保存节点、指标和持久化 node token。
metrics_retention: "6h" # 历史指标保留时间。
cleanup_interval: "10m" # 按保留策略清理历史指标的执行间隔。
public_url: "" # 用于生成 Agent 安装命令的公网面板地址；留空时会从请求 Host 推断。
# agent_token 是可选配置，只在你需要长期 bootstrap token 时设置。
# 推荐优先使用 Dashboard 生成的一次性 install token 添加主机。
# agent_token: "change-this-to-a-random-secret" # 可选的长期 Agent bootstrap token；不要暴露在浏览器或公开文档里。
```

如果 Agent 会从其他机器访问面板，建议设置 `public_url`：

```yaml
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

### 4. 可选：使用 systemd 托管 Server

Release 包包含 `systemd/mizupanel-server.service`。它默认 MizuPanel 安装在 `/opt/mizupanel`，并使用 `/opt/mizupanel/server.yaml`。

```bash
NOLOGIN=$(command -v nologin || printf '%s\n' /usr/sbin/nologin)
getent passwd mizupanel >/dev/null || sudo useradd --system --no-create-home --shell "$NOLOGIN" mizupanel
sudo mkdir -p /opt/mizupanel
sudo cp -R . /opt/mizupanel/
sudo chown -R root:root /opt/mizupanel
sudo chown root:mizupanel /opt/mizupanel/server.yaml
sudo chmod 0640 /opt/mizupanel/server.yaml
sudo mkdir -p /opt/mizupanel/data
sudo chown mizupanel:mizupanel /opt/mizupanel/data
sudo chmod 0750 /opt/mizupanel/data
sudo cp /opt/mizupanel/systemd/mizupanel-server.service /etc/systemd/system/mizupanel-server.service
sudo systemctl daemon-reload
sudo systemctl enable --now mizupanel-server
```

查看日志：

```bash
journalctl -u mizupanel-server -f
```

## Agent 设置

打开 Dashboard，点击 **添加主机**，在目标主机上执行生成的命令。命令形态类似：

```bash
curl -fsSL 'http://你的面板地址:8080/scripts/install-agent.sh' -o install-agent.sh \
  && chmod +x install-agent.sh \
  && sudo ./install-agent.sh \
    --binary-base-url 'http://你的面板地址:8080/downloads' \
    --server-url 'ws://你的面板地址:8080/api/agent/ws' \
    --token 'one-time-install-token' \
    --node-id "$(hostname)" \
    --name "$(hostname)"
```

安装脚本会从 `downloads/` 中选择匹配系统架构的 Agent 文件，然后安装为：

```text
/usr/local/mizupanel/mizupanel-agent
/usr/local/mizupanel/agent.yaml
/etc/systemd/system/mizupanel-agent.service
```

查看 Agent 服务：

```bash
systemctl status mizupanel-agent
journalctl -u mizupanel-agent -f
```

Agent 安装权限：

- `/usr/local/mizupanel` 由 `root:root` 管理。
- `/usr/local/mizupanel/mizupanel-agent` 由 root 拥有并可执行。
- `/usr/local/mizupanel/agent.yaml` 由 `mizupanel-agent:mizupanel-agent` 拥有，权限为 `0600`。
- systemd `ReadWritePaths` 只允许写入 `agent.yaml`，Agent 可以持久化换发后的 `node_token`，但不能替换自己的二进制文件。

## Token 模型

### `install_token`

`install_token` 是一次性 bootstrap token。

- Dashboard 创建添加主机命令时生成。
- 只用于 Agent 首次注册。
- Server 验证成功后会换发长期 `node_token`。
- 不应作为持久凭据使用。

### `node_token`

`node_token` 是每个节点自己的长期 token。

- 首次注册成功后生成。
- Agent 会写入 `/usr/local/mizupanel/agent.yaml`。
- Agent 重启和断线重连时使用。
- Server 端保存的是 token 哈希，不保存明文。
