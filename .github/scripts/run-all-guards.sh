#!/usr/bin/env bash
# run-all-guards — single entry for local + CI matrix (layers architecture).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
fail=0

SCRIPTS=(
  canon-gate.sh
  ast-philosophy-guard.sh
  token-protocol-guard.sh
  asset-token-permanent-guard.sh
  no-bypass-pot-nodechain.sh
  pot-criteria-guard.sh
  no-all-seeing-eye-executive-guard.sh
  component-docs-guard.sh
  domain-invariants-guard.sh
  layout-scaffold-guard.sh
  # require-canon-update.sh is PR-diff sensitive; run only when BASE is set
)

for s in "${SCRIPTS[@]}"; do
  echo "======== $s ========"
  if ! bash ".github/scripts/$s"; then
    fail=1
  fi
done

if [ -n "${GITHUB_BASE_REF:-}" ] || [ -n "${BASE_REF:-}" ]; then
  echo "======== require-canon-update.sh ========"
  if ! bash .github/scripts/require-canon-update.sh; then
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "run-all-guards: FAILED"
  exit 1
fi
echo "run-all-guards: ALL OK"
exit 0
