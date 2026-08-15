#!/usr/bin/env bash
# Dual business pilot: Bank of Georgia + Mercury as AST institutions + OPS.
# Writes gitignored secrets only — never commit tokens / never paste bank passwords.
#
# Usage:
#   bash scripts/setup-bog-mercury-pilot.sh
#   bash scripts/setup-bog-mercury-pilot.sh --random
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${AST_SECRETS_DIR:-$ROOT/data}"
OUT_FILE="${AST_INSTITUTION_SECRETS_FILE:-$OUT_DIR/institution-secrets.json}"
CREDS_FILE="$OUT_DIR/institution-credentials.txt"

mkdir -p "$OUT_DIR"
gen() { openssl rand -hex 20; }

BOG_T="${AST_BOG_SALT:-}"
MERCURY_T="${AST_MERCURY_SALT:-}"
OPS_T="${AST_OPS_SALT:-ops}"
RANDOM_SALT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --random) RANDOM_SALT=1; shift ;;
    -h|--help)
      sed -n '1,12p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ "$RANDOM_SALT" == "1" ]] || [[ -z "$BOG_T" ]]; then
  BOG_T="$(gen)"
fi
if [[ "$RANDOM_SALT" == "1" ]] || [[ -z "$MERCURY_T" ]]; then
  MERCURY_T="$(gen)"
fi
if [[ "$RANDOM_SALT" == "1" ]]; then
  OPS_T="$(gen)"
fi

python3 - <<PY
import json
path = r"""$OUT_FILE"""
data = [
  {
    "institutionId": "BOG",
    "displayName": "Bank of Georgia (Business)",
    "token": """$BOG_T""",
    "allowlisted": True,
    "role": "institution",
  },
  {
    "institutionId": "MERCURY",
    "displayName": "Mercury (Business)",
    "token": """$MERCURY_T""",
    "allowlisted": True,
    "role": "institution",
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
  echo "# BOG + Mercury dual pilot — $(date -u +%Y-%m-%dT%H:%M:%SZ) — DO NOT COMMIT"
  echo "# NOT bank login passwords — AST portal salts only"
  echo ""
  echo "BOG      (issuer/party)  login=BOG      salt=$BOG_T"
  echo "MERCURY  (issuer/party)  login=MERCURY  salt=$MERCURY_T"
  echo "OPS      (operator)      login=OPS      salt=$OPS_T  → /ops"
  echo ""
  echo "Test plan: docs/portal/BOG-MERCURY-DUAL-TEST.md"
  echo "Restart edge after this file changes."
  echo "  bash scripts/home-down.sh && bash scripts/home-up.sh"
  echo ""
  echo "Sandbox fiat label (optional): X-Sandbox-Secret=sandbox-dev-secret"
} | tee "$CREDS_FILE"

chmod 600 "$CREDS_FILE" 2>/dev/null || true
echo "Wrote $CREDS_FILE (open this file for salts — do not paste into chat)"
