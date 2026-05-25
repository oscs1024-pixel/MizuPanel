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
  <strong>轻量、自托管、多节点服务器监控面板</strong>
</p>

<p align="center">
  <a href="README.md">English</a> · 中文
</p>

---

## 概览

MizuPanel 是一个面向个人自托管用户的轻量服务器监控面板。Server 负责提供 Dashboard、REST API、Agent WebSocket 接入、SQLite 数据存储和 Agent 安装文件分发；Agent 安装在目标机器上，主动连接 Server，上报 CPU、内存、磁盘、网络和负载数据。

当前 v0.1 目标是先把核心使用流程跑通：**Dashboard 直接打开、添加主机生成安装命令、Agent 主动接入、指标入库并展示**。

> 注意：当前预览版本暂时移除了登录门禁，`/api/install/command` 可直接生成 install token。真正公网发布前建议恢复最小管理员认证。

## 功能特性

- 多节点服务器列表和节点详情。
- CPU、内存、磁盘、网络、Load 指标采集。
- SQLite 本地持久化，默认指标保留 6 小时。
- React + Vite + Tailwind CSS v3 Dashboard。
- Server 内置静态前端、安装脚本和 Agent 下载接口。
- Agent 主动连接 Server，不需要在目标机器暴露端口。
- Dashboard 一键生成 `curl -fsSL` 安装命令。
- 一次性 `install_token` 首次注册，长期 `node_token` 后续重连。
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

Agent 的网络方向是：**Agent 主动连接 Server**。Server 不需要 SSH 到目标机器，目标机器也不需要开放 Agent 端口。

## Release 包结构

执行 `make build` 后会生成：

```text
dist/mizupanel/
├── mizupanel-server
├── server.example.yaml
├── scripts/
│   └── install-agent.sh
├── downloads/
│   ├── mizupanel-agent-linux-amd64
│   └── mizupanel-agent-linux-arm64
└── web/
    ├── index.html
    └── assets/
```

目标机器下载时会按系统架构选择 `downloads/mizupanel-agent-linux-amd64` 或 `downloads/mizupanel-agent-linux-arm64`，但安装到目标机器后统一命名为：

```text
/usr/local/mizupanel/mizupanel-agent
```

配置文件也放在同一个目录：

```text
/usr/local/mizupanel/agent.yaml
```

## 快速开始

### 1. 构建发布包

```bash
make build
```

### 2. 准备 Server 配置

```bash
cd dist/mizupanel
cp server.example.yaml server.yaml
```

`server.yaml` 示例：

```yaml
listen: ":8080"
database_path: "./data/mizupanel.db"
metrics_retention: "6h"
cleanup_interval: "10m"
public_url: ""
# agent_token is optional and should only be set if you need a long-lived bootstrap token.
# Prefer the Dashboard-generated one-time install token flow for adding hosts.
# agent_token: "change-this-to-a-random-secret"
```

如果面板会被其他机器访问，建议设置 `public_url`：

```yaml
public_url: "http://你的服务器IP:8080"
```

### 3. 启动 Server

```bash
./mizupanel-server -config server.yaml
```

然后访问：

```text
http://你的服务器IP:8080
```

### 4. 添加主机

打开 Dashboard，点击“添加主机”，复制生成的命令到目标机器执行。命令形态类似：

```bash
curl -fsSL 'http://你的面板地址:8080/scripts/install-agent.sh' -o install-agent.sh \
  && chmod +x install-agent.sh \
  && sudo ./install-agent.sh \
    --binary-base-url 'http://你的面板地址:8080/downloads' \
    --server-url 'ws://你的面板地址:8080/api/agent/ws' \
    --token '一次性install_token' \
    --node-id "$(hostname)" \
    --name "$(hostname)"
```

安装完成后，目标机器上会有：

```text
/usr/local/mizupanel/mizupanel-agent
/usr/local/mizupanel/agent.yaml
/etc/systemd/system/mizupanel-agent.service
```

服务会自动启动并设置开机自启：

```bash
systemctl status mizupanel-agent
```

## Token 说明

### `install_token`

`install_token` 是首次安装使用的一次性 token。

- Dashboard 点击“添加主机”时生成。
- 只用于 Agent 首次注册。
- Server 验证成功后会换发长期 `node_token`。
- 不建议把它当成长期凭据使用。

### `node_token`

`node_token` 是每个节点自己的长期连接 token。

- Server 在首次注册成功后生成。
- Agent 收到后写回 `/usr/local/mizupanel/agent.yaml`。
- 后续 Agent 重启、断线重连都使用 `node_token`。
- Server 端持久化保存的是 token 哈希，不保存明文 node token。

## Agent 安装目录与权限

目标机器安装布局：

```text
/usr/local/mizupanel/
├── mizupanel-agent
└── agent.yaml
```

权限策略：

- `/usr/local/mizupanel`：`root:root` 管理。
- `/usr/local/mizupanel/mizupanel-agent`：`root:root`，可执行。
- `/usr/local/mizupanel/agent.yaml`：`mizupanel-agent:mizupanel-agent`，`0600`。
- systemd `ReadWritePaths` 只允许写 `agent.yaml`，用于保存换发后的 `node_token`。

## 配置文件

Server 配置：`server.example.yaml`

```yaml
listen: ":8080"
database_path: "./data/mizupanel.db"
metrics_retention: "6h"
cleanup_interval: "10m"
public_url: ""
# agent_token: "change-this-to-a-random-secret"
```

Agent 配置由安装脚本自动生成，通常不需要手动创建：

```yaml
server_url: "ws://your-panel-host:8080/api/agent/ws"
token: "node-token-after-registration"
node_id: "oracle-sg-01"
name: "Oracle SG"
interval: "5s"
```

## 开发命令

```bash
# Go 测试
go test ./...

# 前端测试
npm --prefix web test

# 前端开发服务器
npm --prefix web run dev

# 构建 release 包
make build

# 清理构建产物
make clean
```

## 当前范围

v0.1 当前聚焦基础监控能力：

- Server + Agent + Dashboard。
- 节点注册和指标上报。
- 最近 1 小时 / 6 小时历史曲线。
- Dashboard 生成 Agent 安装命令。

暂不包含：

- Docker 管理。
- Kubernetes 管理。
- Web Terminal。
- SSH 密码托管安装。
- 多用户权限系统。

SSH 自动安装后续可以作为增强功能，但不建议 v0.1 默认保存 SSH 密码或私钥。
