#!/usr/bin/env bash
# postToolUse: after letscook MCP dispatch/submit, inject sticky-continue context in the same agent turn.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/cook-mcp-parse.mjs" post
