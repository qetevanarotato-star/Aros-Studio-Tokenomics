#!/usr/bin/env bash
# HTTPS public URL for Portal EDGE (:3100) so Framer (HTTPS) can login.
# Usage: bash scripts/framer-api-tunnel.sh
# Prerequisite: edge already up (bash scripts/home-up.sh)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${AST_HOME_LOG_DIR:-$ROOT/.home-run}"
mkdir -p "$LOG_DIR"
EDGE_LOCAL="${AST_FRAMER_EDGE_URL:-http://127.0.0.1:3100}"

if ! curl -sf "${EDGE_LOCAL}/v1/health" >/dev/null 2>&1; then
  echo "ERROR: Portal edge not up at ${EDGE_LOCAL}"
  echo "  Run first:  cd $ROOT && bash scripts/home-up.sh"
  exit 1
fi

CF="$(command -v cloudflared 2>/dev/null || true)"
if [[ -z "$CF" && -x "$LOG_DIR/bin/cloudflared" ]]; then CF="$LOG_DIR/bin/cloudflared"; fi
if [[ -z "$CF" ]]; then
  echo "ERROR: cloudflared missing"
  exit 1
fi

if [[ -f "$LOG_DIR/edge-tunnel.pid" ]]; then
  old="$(cat "$LOG_DIR/edge-tunnel.pid" || true)"
  if [[ -n "${old:-}" ]] && kill -0 "$old" 2>/dev/null; then
    kill "$old" 2>/dev/null || true
  fi
  rm -f "$LOG_DIR/edge-tunnel.pid"
fi

: >"$LOG_DIR/edge-tunnel.log"
nohup "$CF" tunnel --url "$EDGE_LOCAL" --no-autoupdate >"$LOG_DIR/edge-tunnel.log" 2>&1 &
echo $! >"$LOG_DIR/edge-tunnel.pid"

PUBLIC=""
for i in $(seq 1 50); do
  PUBLIC="$(grep -a -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare.com' "$LOG_DIR/edge-tunnel.log" 2>/dev/null | head -1 || true)"
  [[ -n "$PUBLIC" ]] && break
  sleep 0.4
done

if [[ -z "$PUBLIC" ]]; then
  echo "Tunnel started but URL not ready. tail -f $LOG_DIR/edge-tunnel.log"
  exit 1
fi

echo "$PUBLIC" >"$LOG_DIR/edge-public-url.txt"
echo ""
echo "============================================"
echo "  FRAMER API (put this as API base on site):"
echo "  $PUBLIC"
echo "============================================"
echo "  Login: pilot"
echo "  Salt:  pilot"
echo "  Keep this Mac awake + home-up running."
echo "  Stop tunnel: kill \$(cat $LOG_DIR/edge-tunnel.pid)"
echo ""
