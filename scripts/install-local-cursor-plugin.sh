#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
TARGET="${1:-$HOME/.cursor/plugins/local/letscook}"

if [[ ! -f "$ROOT/.cursor-plugin/plugin.json" ]]; then
  echo "[install-local-cursor-plugin] missing plugin manifest: $ROOT/.cursor-plugin/plugin.json" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"
rm -rf "$TARGET"

RSYNC_EXCLUDES=(
  --exclude node_modules
  --exclude .git
  --exclude dist
)
if command -v rsync >/dev/null 2>&1; then
  rsync -a "${RSYNC_EXCLUDES[@]}" "$ROOT/" "$TARGET/"
else
  echo "[install-local-cursor-plugin] rsync not found; falling back to cp (slower)" >&2
  mkdir -p "$TARGET"
  cp -R "$ROOT/." "$TARGET/"
  rm -rf "$TARGET/node_modules" "$TARGET/.git"
fi

printf '%s\n' "$TARGET" > "$TARGET/.letscook-package-root"
chmod +x "$TARGET/scripts/start-letscook-mcp.sh"
chmod +x "$TARGET/hooks/cook-subagent-continue.sh" 2>/dev/null || true
chmod +x "$TARGET/hooks/cook-post-mcp-continue.sh" 2>/dev/null || true
chmod +x "$TARGET/hooks/cook-stop-continue.sh" 2>/dev/null || true

echo "[install-local-cursor-plugin] installing npm dependencies..."
npm install --prefix "$TARGET" --no-fund --no-audit

TARGET="$TARGET" node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const target = process.env.TARGET;
const startScript = path.join(target, 'scripts/start-letscook-mcp.sh');
const mcpConfig = {
  mcpServers: {
    letscook: {
      command: 'bash',
      args: [startScript],
      cwd: target,
      env: {},
    },
  },
};

fs.writeFileSync(path.join(target, 'mcp.json'), JSON.stringify(mcpConfig, null, 2) + '\n');
NODE

cat <<EOF
Installed letscook Cursor plugin to: $TARGET

Bundled resources:
  - MCP server: letscook
  - Agents: completion-bootstrapper, completion-regrounder, completion-implementer,
            completion-reviewer, completion-auditor, completion-stop-judge
  - Skills: cursor-worktree-cook, cursor-plan-handoff, cursor-handoff-synthesis, cursor-handoff,
            cook-handoff-boundary, completion-protocol, cursor-orchestrator, cursor-orchestrator-monitor
  - Commands: cook
  - Rule: letscook-prerequisites
  - Hooks: postToolUse + subagentStop + stop sticky-continue (active when plugin is enabled)

Next steps:
1. Reload Cursor (Developer: Reload Window)
2. Open Customize → enable the letscook plugin and letscook MCP server
3. Confirm **Customize → Hooks** lists letscook subagentStop (optional sanity check)

Alternative: import the repo root from Customize (uses .cursor-plugin/marketplace.json)

EOF
