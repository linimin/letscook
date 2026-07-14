#!/usr/bin/env bash
# subagentStop hook: after a completion-role subagent completes, nudge the primary agent
# to continue the letscook orchestrator loop via MCP.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/cook-mcp-parse.mjs" subagent
