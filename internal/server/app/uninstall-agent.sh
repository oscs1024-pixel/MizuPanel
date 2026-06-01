#!/usr/bin/env bash
set -euo pipefail

DEST_ROOT=""

usage() {
  printf 'Usage: %s [--dest-root PATH]\n' "$0"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dest-root)
      DEST_ROOT="$2"
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

if [ -z "$DEST_ROOT" ] && [ "$(id -u)" -ne 0 ]; then
  printf 'Run as root or pass --dest-root for testing.\n' >&2
  exit 1
fi

INSTALL_DIR="$DEST_ROOT/usr/local/mizupanel"
SERVICE_PATH="$DEST_ROOT/etc/systemd/system/mizupanel-agent.service"

if [ -z "$DEST_ROOT" ]; then
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet mizupanel-agent; then
      systemctl stop mizupanel-agent
    fi
    if systemctl is-enabled --quiet mizupanel-agent 2>/dev/null; then
      systemctl disable mizupanel-agent
    fi
  fi
fi

rm -f "$SERVICE_PATH"
rm -rf "$INSTALL_DIR"

if [ -z "$DEST_ROOT" ]; then
  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload >/dev/null 2>&1 || true
    systemctl reset-failed mizupanel-agent >/dev/null 2>&1 || true
  fi
  if id -u mizupanel-agent >/dev/null 2>&1; then
    userdel mizupanel-agent >/dev/null 2>&1 || true
  fi
fi

printf 'MizuPanel agent uninstalled.\n'
