#!/usr/bin/env bash
# Phase B/D local: issuer + counterparty + holder + operator accounts.
# Writes gitignored data/institution-secrets.json — never commit tokens.
#
# Usage: bash scripts/setup-two-sided-pilot.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${AST_SECRETS_DIR:-$ROOT/data}"
OUT_FILE="${AST_INSTITUTION_SECRETS_FILE:-$OUT_DIR/institution-secrets.json}"
CREDS_FILE="$OUT_DIR/institution-credentials.txt"

mkdir -p "$OUT_DIR"

gen() { openssl rand -hex 16; }

PILOT_T="${AST_PILOT_SALT:-pilot}"
COUNTER_T="${AST_COUNTER_SALT:-counter}"
HOLDER_T="${AST_HOLDER_SALT:-holder}"
OPS_T="${AST_OPS_SALT:-ops}"

# Optional --random to force random tokens
if [[ "${1:-}" == "--random" ]]; then
  PILOT_T="$(gen)"
  COUNTER_T="$(gen)"
  HOLDER_T="$(gen)"
  OPS_T="$(gen)"
fi

python3 - <<PY
import json
path = r"""$OUT_FILE"""
data = [
  {
    "institutionId": "PILOT",
    "displayName": "Pilot Issuer",
    "token": """$PILOT_T""",
    "allowlisted": True,
    "role": "institution",
  },
  {
    "institutionId": "COUNTER",
    "displayName": "Counterparty Registry",
    "token": """$COUNTER_T""",
    "allowlisted": True,
    "role": "counterparty",
  },
  {
    "institutionId": "HOLDER1",
    "displayName": "Holder Pilot",
    "token": """$HOLDER_T""",
    "allowlisted": True,
    "role": "holder",
  },
  {
    "institutionId": "OPS",
    "displayName": "AST Operator",
    "token": """$OPS_T""",
    "allowlisted": True,
    "role": "operator",
  },
]
with open(path, "w", encoding="utf-8") as f:
  json.dump(data, f, indent=2)
  f.write("\n")
print(path)
PY

chmod 600 "$OUT_FILE" 2>/dev/null || true

{
  echo "# Two-sided pilot secrets — $(date -u +%Y-%m-%dT%H:%M:%SZ) — DO NOT COMMIT"
  echo ""
  echo "PILOT   (issuer)       login=PILOT    salt=$PILOT_T"
  echo "COUNTER (counterparty) login=COUNTER  salt=$COUNTER_T"
  echo "HOLDER1 (holder)       login=HOLDER1  salt=$HOLDER_T   (set holderId=HOLDER1 on process)"
  echo "OPS     (operator)     login=OPS      salt=$OPS_T      → /ops control plane"
  echo ""
  echo "After write: restart portal edge so accounts reload."
  echo "  bash scripts/home-down.sh && bash scripts/home-up.sh"
  echo "  # or kill edge PID and start:dev again"
  echo ""
  echo "Bank sandbox secret (local default): sandbox-dev-secret"
  echo "  curl -X POST http://127.0.0.1:3100/v1/sandbox/bank/webhook \\"
  echo "    -H 'Content-Type: application/json' -H 'X-Sandbox-Secret: sandbox-dev-secret' \\"
  echo "    -d '{\"processId\":\"AST-…\",\"reference\":\"PAY-1\",\"status\":\"settled\"}'"
} | tee "$CREDS_FILE"

chmod 600 "$CREDS_FILE" 2>/dev/null || true
echo "Wrote $CREDS_FILE"
