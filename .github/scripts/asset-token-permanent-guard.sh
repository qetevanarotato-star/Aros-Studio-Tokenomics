#!/usr/bin/env bash
# asset-token-permanent-guard — Amendment 1: asset token does not die with the process.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
fail=0

if ! grep -q 'The asset token is \*\*permanent\*\*' docs/AST-CORE-CANON.md \
  && ! grep -qi 'asset token is permanent' docs/AST-CORE-CANON.md; then
  echo "::error::canon must ratify permanent asset token (Amendment 1)."
  fail=1
fi

close_fn="$(sed -n '/async close(processId/,/async abort(/p' src/processing/process.service.ts)"
if echo "$close_fn" | grep -qE '\.burn\(|token\.burn'; then
  echo "::error::ProcessService.close must not burn the asset token."
  echo "$close_fn"
  fail=1
fi

if ! grep -q 'assetTokenExtinguished: false' src/processing/process.service.ts; then
  echo "::error::process_close payload must set assetTokenExtinguished: false."
  fail=1
fi

hits="$(grep -RInE 'burnOnProcessClose|extinguishAssetToken|expireAssetToken' src --include='*.ts' || true)"
if [ -n "$hits" ]; then
  echo "::error::forbidden extinguish-on-close identifiers in src:"
  echo "$hits"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "asset-token-permanent-guard FAILED"
  exit 1
fi
echo "asset-token-permanent-guard: OK."
exit 0
