#!/usr/bin/env bash
set -euo pipefail

DEST_ROOT=""
BINARY=""
BINARY_URL=""
BINARY_BASE_URL=""
SERVER_URL=""
TOKEN=""
NODE_ID=""
NAME=""
INTERVAL="5s"

usage() {
  printf 'Usage: %s (--binary PATH | --binary-url URL | --binary-base-url URL) --server-url URL --token TOKEN --node-id ID --name NAME [--interval 5s]\n' "$0"
}

quote_yaml() {
  local value=${1//\\/\\\\}
  value=${value//\"/\\\"}
  printf '"%s"' "$value"
}

binary_target() {
  local os arch
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  arch=$(uname -m)
  case "$arch" in
    x86_64|amd64)
      arch="amd64"
      ;;
    aarch64|arm64)
      arch="arm64"
      ;;
    *)
      printf 'Unsupported architecture: %s\n' "$arch" >&2
      exit 1
      ;;
  esac
  case "$os" in
    linux)
      ;;
    *)
      printf 'Unsupported OS: %s\n' "$os" >&2
      exit 1
      ;;
  esac
  printf 'mizupanel-agent-%s-%s' "$os" "$arch"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dest-root)
      DEST_ROOT="$2"
      shift 2
      ;;
    --binary)
      BINARY="$2"
      shift 2
      ;;
    --binary-url)
      BINARY_URL="$2"
      shift 2
      ;;
    --binary-base-url)
      BINARY_BASE_URL="$2"
      shift 2
      ;;
    --server-url)
      SERVER_URL="$2"
      shift 2
      ;;
    --token)
      TOKEN="$2"
      shift 2
      ;;
    --node-id)
      NODE_ID="$2"
      shift 2
      ;;
    --name)
      NAME="$2"
      shift 2
      ;;
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -z "$SERVER_URL" ] || [ -z "$TOKEN" ] || [ -z "$NODE_ID" ] || [ -z "$NAME" ]; then
  usage >&2
  exit 1
fi
if [ -z "$BINARY" ] && [ -z "$BINARY_URL" ] && [ -z "$BINARY_BASE_URL" ]; then
  usage >&2
  exit 1
fi
BINARY_SOURCE_COUNT=0
[ -n "$BINARY" ] && BINARY_SOURCE_COUNT=$((BINARY_SOURCE_COUNT + 1))
[ -n "$BINARY_URL" ] && BINARY_SOURCE_COUNT=$((BINARY_SOURCE_COUNT + 1))
[ -n "$BINARY_BASE_URL" ] && BINARY_SOURCE_COUNT=$((BINARY_SOURCE_COUNT + 1))
if [ "$BINARY_SOURCE_COUNT" -ne 1 ]; then
  printf 'Pass only one of --binary, --binary-url, or --binary-base-url.\n' >&2
  exit 1
fi
if [ -n "$BINARY" ] && [ ! -f "$BINARY" ]; then
  printf 'Agent binary not found: %s\n' "$BINARY" >&2
  exit 1
fi
if [ -n "$BINARY_BASE_URL" ]; then
  BINARY_URL="${BINARY_BASE_URL%/}/$(binary_target)"
fi
if [ -z "$DEST_ROOT" ] && [ "$(id -u)" -ne 0 ]; then
  printf 'Run as root or pass --dest-root for testing.\n' >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SERVICE_TEMPLATE="$SCRIPT_DIR/../systemd/mizupanel-agent.service"
ETC_DIR="$DEST_ROOT/etc/mizupanel"
BIN_DIR="$DEST_ROOT/opt/mizupanel/bin"
SYSTEMD_DIR="$DEST_ROOT/etc/systemd/system"

if [ -z "$DEST_ROOT" ] && ! id -u mizupanel-agent >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin mizupanel-agent
fi

install -d -m 0755 "$BIN_DIR" "$SYSTEMD_DIR"
install -d -m 0750 "$ETC_DIR"
if [ -n "$BINARY_URL" ]; then
  BINARY_TMP=$(mktemp "$BIN_DIR/mizupanel-agent.XXXXXX")
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$BINARY_URL" -o "$BINARY_TMP"
  else
    wget -qO "$BINARY_TMP" "$BINARY_URL"
  fi
  install -m 0755 "$BINARY_TMP" "$BIN_DIR/mizupanel-agent"
  rm -f "$BINARY_TMP"
else
  install -m 0755 "$BINARY" "$BIN_DIR/mizupanel-agent"
fi

CONFIG_TMP=$(mktemp "$ETC_DIR/agent.yaml.XXXXXX")
chmod 0600 "$CONFIG_TMP"
{
  printf 'server_url: '
  quote_yaml "$SERVER_URL"
  printf '\n'
  printf 'token: '
  quote_yaml "$TOKEN"
  printf '\n'
  printf 'node_id: '
  quote_yaml "$NODE_ID"
  printf '\n'
  printf 'name: '
  quote_yaml "$NAME"
  printf '\n'
  printf 'interval: '
  quote_yaml "$INTERVAL"
  printf '\n'
} > "$CONFIG_TMP"
install -m 0600 "$CONFIG_TMP" "$ETC_DIR/agent.yaml"
rm -f "$CONFIG_TMP"

if [ -z "$DEST_ROOT" ]; then
  chown mizupanel-agent:mizupanel-agent "$ETC_DIR" "$ETC_DIR/agent.yaml"
fi

if [ -f "$SERVICE_TEMPLATE" ]; then
  install -m 0644 "$SERVICE_TEMPLATE" "$SYSTEMD_DIR/mizupanel-agent.service"
else
  cat > "$SYSTEMD_DIR/mizupanel-agent.service" <<'SERVICE'
[Unit]
Description=MizuPanel Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/opt/mizupanel/bin/mizupanel-agent -config /etc/mizupanel/agent.yaml
Restart=always
RestartSec=5s
User=mizupanel-agent
Group=mizupanel-agent
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/etc/mizupanel

[Install]
WantedBy=multi-user.target
SERVICE
fi

if [ -z "$DEST_ROOT" ]; then
  systemctl daemon-reload
  systemctl enable --now mizupanel-agent
fi

printf 'MizuPanel agent installed. Config: %s\n' "$ETC_DIR/agent.yaml"
