#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
PACKAGE_ROOT_FILE="$PACKAGE_ROOT/.letscook-package-root"

if [[ -f "$PACKAGE_ROOT_FILE" ]]; then
  PACKAGE_ROOT="$(cd "$(cat "$PACKAGE_ROOT_FILE")" && pwd -P)"
fi

if [[ ! -f "$PACKAGE_ROOT/package.json" ]] || [[ ! -f "$PACKAGE_ROOT/src/server.ts" ]]; then
  echo "[letscook-mcp] could not resolve letscook package root from: $PACKAGE_ROOT" >&2
  echo "[letscook-mcp] re-run: bash ./scripts/install-local-cursor-plugin.sh from the letscook repo" >&2
  echo "[letscook-mcp] or import this repo root in Customize (.cursor-plugin/marketplace.json)" >&2
  exit 1
fi

cd "$PACKAGE_ROOT"

if [[ ! -d node_modules ]]; then
  echo "[letscook-mcp] installing dependencies (first run)..." >&2
  npm install --no-fund --no-audit
fi

exec npx tsx src/server.ts
