# letscook

Cursor plugin + MCP orchestrator for long-running, slice-based completion workflows in Cursor.

Install the plugin once; it bundles MCP server, skills, commands, rules, and hooks.

## Install as Cursor plugin

### Option A — local install script (recommended)

```bash
cd ~/dev/letscook
bash ./scripts/install-local-cursor-plugin.sh
```

Installs to `~/.cursor/plugins/local/letscook`, runs `npm install`, and wires `mcp.json` with absolute paths.

### Option B — import from repo

1. Open **Customize** → add/import plugins from folder
2. Select the **letscook repository root** (contains `.cursor-plugin/marketplace.json`)
3. Reload Cursor

On first MCP start, dependencies install automatically.

## After install

1. **Reload Cursor** (Developer: Reload Window)
2. **Customize** → enable **letscook** plugin
3. **Customize** → enable **letscook** MCP server
4. Copy worktree setup into your repo (recommended):
   ```bash
   mkdir -p .cursor
   cp ~/dev/letscook/examples/worktrees.json.example .cursor/worktrees.json
   ```

Hooks (`subagentStop` auto-continue for the orchestrator loop) load automatically from the plugin's `hooks/hooks.json` when letscook is enabled in Customize — no manual copy into your project.

## Workflow

```text
Route A: Plan → Save to workspace → /worktree <task> → /cook → confirm → orchestrator → /apply-worktree → /delete-worktree
Route B: Plan → Save to workspace → /cook → confirm (main isolation gate if needed) → orchestrator → finish on current checkout
```

| Step | What |
|------|------|
| Plan | `.cursor/plans/*.plan.md` — do **not** use Build locally |
| Isolate (optional) | Cursor `/worktree` — recommended for sandboxed edits |
| Cook | `/cook` → `resolve_cook_workspace` → `synthesize_cook_handoff` → `confirm_cook_handoff` → 6-role loop |
| Finish | `finish_cook_workflow` → apply/delete worktree when isolated; else review commits / PR |

## Bundled resources

| Component | Location |
|-----------|----------|
| MCP `letscook` | `mcp.json` + `scripts/start-letscook-mcp.sh` |
| **6 completion agents** | `agents/completion-*.md` |
| Skill `cursor-worktree-cook` | `skills/cursor-worktree-cook/` |
| Skill `cursor-handoff-synthesis` | `skills/cursor-handoff-synthesis/` |
| Skill `cook-handoff-boundary` | `skills/cook-handoff-boundary/` |
| Skill `completion-protocol` | `skills/completion-protocol/` |
| Skill `cursor-handoff` | `skills/cursor-handoff/` |
| Skill `cursor-orchestrator` | `skills/cursor-orchestrator/` |
| Skill `cursor-plan-handoff` | `skills/cursor-plan-handoff/` |
| Command `/cook` | `commands/cook.md` |
| Worktree setup example | `examples/worktrees.json.example` |

## MCP tools

| Tool | Purpose |
|------|---------|
| `get_cook_workspace_context` | Detect main vs Cursor worktree |
| `resolve_cook_workspace` | Pick `workspace_root` for `/cook` |
| `finish_cook_workflow` | Apply/delete guidance when done |
| `prepare_cook_handoff` / `confirm_cook_handoff` / `start_cook_workflow` | Handoff + native confirm UI + scaffold `.agent/` |
| `get_handoff_synthesis_prompt` / `submit_startup_analysis` / `synthesize_cook_handoff` / `validate_cook_handoff` | Startup synthesis (fail-closed) |
| `list_cursor_plans` / `preview_plan_to_cook_handoff` | Plan → synthesis input |
| `get_workflow_dispatch` / `claim_workflow_dispatch` / `submit_role_result` | Orchestrator loop (preflight → claim → Task → submit) |

## Development

```bash
npm install
npm run typecheck
npm test
npm run release-check
npm run start   # MCP stdio (for manual debugging)
```

## Status

**v0.4.0** — main checkout support with `confirm_cook_handoff` isolation gate (`start_on_main` / `defer_worktree`); optional `/worktree` (recommended, not required). Prior: startup synthesis, MCP orchestration, elicitation + AskQuestion confirm.

## License

MIT
