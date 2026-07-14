#!/usr/bin/env bash
# stop: if workflow is still active, auto-submit a follow-up user message to keep the driver loop going.
set -euo pipefail
input="$(cat)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf '%s' "$input" | node "$SCRIPT_DIR/cook-mcp-parse.mjs" stop
