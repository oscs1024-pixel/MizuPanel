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
  <strong>Lightweight self-hosted monitoring for personal servers and small fleets.</strong>
</p>

<p align="center">
  English · <a href="README.zh-CN.md">中文</a>
</p>

---

## Overview

MizuPanel is a lightweight self-hosted server monitoring panel for personal servers and small fleets. The Server serves the Dashboard, REST APIs, Agent WebSocket endpoint, SQLite storage, installer script, and Agent downloads. The Agent runs on each target machine, connects back to the Server, and reports CPU, memory, disk, network, and load metrics.

The current v0.1 preview focuses on the core workflow: **open the Dashboard, generate an add-host install command, connect Agents actively, store metrics, and display them in the UI**.

> Note: the current preview temporarily has no login gate. `/api/install/command` can mint install tokens without authentication. Restore minimal admin authentication before exposing MizuPanel publicly.

## Features

- Multi-node server list and node details.
- CPU, memory, disk, network, and load metrics.
- Local SQLite persistence with 6-hour default retention.
- React + Vite + Tailwind CSS v3 Dashboard.
- Server-hosted web assets, installer script, and Agent downloads.
- Agent actively connects to Server; target hosts do not expose Agent ports.
- Dashboard-generated `curl -fsSL` install command.
- One-time `install_token` for first registration and long-lived `node_token` for reconnects.
- Linux amd64 / arm64 Agent binaries bundled in the release package.

## Architecture

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

The network direction is always Agent to Server. The Server does not need to SSH into target hosts, and target hosts do not need to expose Agent ports.

## Release layout

Run `make build` to create:

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

The installer chooses the correct architecture-specific file from `downloads/`, but installs it on the target host as:

```text
/usr/local/mizupanel/mizupanel-agent
```

The Agent config is colocated at:

```text
/usr/local/mizupanel/agent.yaml
```

## Quick start

### 1. Build the release package

```bash
make build
```

### 2. Prepare Server config

```bash
cd dist/mizupanel
cp server.example.yaml server.yaml
```

Example `server.yaml`:

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

If other machines need to access the panel, set `public_url`:

```yaml
public_url: "http://your-server-ip:8080"
```

### 3. Start Server

```bash
./mizupanel-server -config server.yaml
```

Open:

```text
http://your-server-ip:8080
```

### 4. Add a host

Open the Dashboard, click **Add Host**, and run the generated command on the target host. It looks like:

```bash
curl -fsSL 'http://your-panel-host:8080/scripts/install-agent.sh' -o install-agent.sh \
  && chmod +x install-agent.sh \
  && sudo ./install-agent.sh \
    --binary-base-url 'http://your-panel-host:8080/downloads' \
    --server-url 'ws://your-panel-host:8080/api/agent/ws' \
    --token 'one-time-install-token' \
    --node-id "$(hostname)" \
    --name "$(hostname)"
```

After installation, the target host contains:

```text
/usr/local/mizupanel/mizupanel-agent
/usr/local/mizupanel/agent.yaml
/etc/systemd/system/mizupanel-agent.service
```

Check the service:

```bash
systemctl status mizupanel-agent
```

## Token model

### `install_token`

`install_token` is a one-time bootstrap token.

- Generated when the Dashboard creates an add-host command.
- Used only for the first Agent registration.
- Exchanged by the Server for a long-lived `node_token`.
- Not intended as a persistent credential.

### `node_token`

`node_token` is a long-lived per-node token.

- Generated after successful first registration.
- Persisted by the Agent into `/usr/local/mizupanel/agent.yaml`.
- Used for Agent restarts and reconnects.
- Stored on the Server side as a hash, not plaintext.

## Agent install layout and permissions

Target host layout:

```text
/usr/local/mizupanel/
├── mizupanel-agent
└── agent.yaml
```

Permission model:

- `/usr/local/mizupanel` is managed by `root:root`.
- `/usr/local/mizupanel/mizupanel-agent` is root-owned and executable.
- `/usr/local/mizupanel/agent.yaml` is owned by `mizupanel-agent:mizupanel-agent` with `0600` permissions.
- systemd `ReadWritePaths` is limited to `agent.yaml` so the Agent can persist the exchanged `node_token` without being able to replace its own binary.

## Config files

Server config: `server.example.yaml`

```yaml
listen: ":8080"
database_path: "./data/mizupanel.db"
metrics_retention: "6h"
cleanup_interval: "10m"
public_url: ""
# agent_token: "change-this-to-a-random-secret"
```

Agent config is generated by the installer and usually does not need to be created manually:

```yaml
server_url: "ws://your-panel-host:8080/api/agent/ws"
token: "node-token-after-registration"
node_id: "oracle-sg-01"
name: "Oracle SG"
interval: "5s"
```

## Development commands

```bash
# Go tests
go test ./...

# Frontend tests
npm --prefix web test

# Frontend dev server
npm --prefix web run dev

# Build release package
make build

# Clean build artifacts
make clean
```

## Current scope

v0.1 focuses on basic monitoring:

- Server + Agent + Dashboard.
- Node registration and metrics ingestion.
- 1h / 6h history ranges.
- Dashboard-generated Agent install command.

Not included yet:

- Docker management.
- Kubernetes management.
- Web Terminal.
- SSH password-based installation.
- Multi-user permission system.

SSH-assisted installation can be added later, but v0.1 should avoid storing SSH passwords or private keys.
