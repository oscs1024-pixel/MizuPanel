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
  <strong>Lightweight self-hosted server monitoring</strong>
</p>

<p align="center">
  English · <a href="README.zh-CN.md">中文</a>
</p>

---

## Overview

MizuPanel is a lightweight self-hosted server monitoring panel for personal servers and small fleets. It is composed of a Server, a Dashboard, and Agents. Agents actively connect to the Server over WebSocket and report CPU, memory, disk, network, and load metrics.

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

## Release layout

Run `make build` to create:

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

## Server setup

### 1. Prepare the release directory

```bash
make build
cd dist/mizupanel
cp server.example.yaml server.yaml
```

`server.example.yaml` is the versioned template. `server.yaml` is your local runtime config, so you can edit it without changing the template.

### 2. Edit `server.yaml`

```yaml
listen: ":8080" # HTTP listen address for the MizuPanel Server.
database_path: "./data/mizupanel.db" # SQLite database path for nodes, metrics, and persisted node tokens.
metrics_retention: "6h" # How long historical metrics are kept before cleanup.
cleanup_interval: "10m" # How often the retention cleanup job runs.
public_url: "" # Public panel URL used to generate Agent install commands; leave empty to infer from the request host.
# agent_token is optional and should only be set if you need a long-lived bootstrap token.
# Prefer the Dashboard-generated one-time install token flow for adding hosts.
# agent_token: "change-this-to-a-random-secret" # Optional long-lived Agent bootstrap token; avoid exposing it in browsers or public docs.
```

Set `public_url` if Agents will access the panel from another machine:

```yaml
public_url: "http://your-server-ip:8080"
```

### 3. Start Server directly

```bash
./mizupanel-server -config server.yaml
```

Open:

```text
http://your-server-ip:8080
```

### 4. Optional: run Server with systemd

The release package includes `systemd/mizupanel-server.service`. It assumes MizuPanel is installed at `/opt/mizupanel` and uses `/opt/mizupanel/server.yaml`.

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

Check logs:

```bash
journalctl -u mizupanel-server -f
```

## Agent setup

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

The installer selects the correct file from `downloads/`, then installs the Agent as:

```text
/usr/local/mizupanel/mizupanel-agent
/usr/local/mizupanel/agent.yaml
/etc/systemd/system/mizupanel-agent.service
```

Check the Agent service:

```bash
systemctl status mizupanel-agent
journalctl -u mizupanel-agent -f
```

Agent install permissions:

- `/usr/local/mizupanel` is managed by `root:root`.
- `/usr/local/mizupanel/mizupanel-agent` is root-owned and executable.
- `/usr/local/mizupanel/agent.yaml` is owned by `mizupanel-agent:mizupanel-agent` with `0600` permissions.
- systemd `ReadWritePaths` is limited to `agent.yaml` so the Agent can persist the exchanged `node_token` without being able to replace its own binary.

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
