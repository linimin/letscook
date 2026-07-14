# letscook

Cursor-native completion workflow orchestrator for the [pi-letscook](https://github.com/linimin/pi-letscook) protocol — **no Pi required**.

Pi remains optional for teams that want the full extension host. **letscook** targets Cursor primary agent + subagents + MCP:

- **Handoff**: worktree, `cook_handoff` capsule, chat confirmation
- **Orchestrator**: `.agent/current/**` state machine, role dispatch, transcript recording
- **Monitoring**: workflow event polling

## Architecture

```text
Cursor primary agent
  → letscook MCP (deterministic brain)
  → Task subagents (6 completion roles)
  → submit_role_result → next dispatch
```

Compatible `.agent/` layout with pi-letscook so workflows can be inspected with the same protocol mental model.

## Quick start

```bash
cd ~/dev/letscook
npm install
```

Wire MCP in Cursor (adjust `cwd`):

```json
{
  "mcpServers": {
    "letscook": {
      "command": "npm",
      "args": ["run", "start"],
      "cwd": "/Users/you/dev/letscook"
    }
  }
}
```

Copy `skills/cursor-orchestrator/` to `.cursor/skills/` in your project.

## MCP tools

| Tool | Purpose |
|------|---------|
| `ensure_cook_worktree` | Create `.worktrees/cook-<slug>/` |
| `prepare_cook_handoff` | Write handoff + sidecar |
| `start_cook_workflow` | Scaffold `.agent/` (no Pi spawn) |
| `get_workflow_dispatch` | Next role + prompts for subagent |
| `submit_role_result` | Record output + advance state |
| `get_workflow_status` / `poll_workflow_updates` | Monitor |
| `park_workflow` / `resume_workflow` / `cancel_workflow` | Controls |

## End-to-end flow

1. Plan in Cursor on main checkout
2. `ensure_cook_worktree` + `prepare_cook_handoff` on worktree
3. User confirms → `start_cook_workflow`
4. Loop: `get_workflow_dispatch` → Task subagent → `submit_role_result`
5. `poll_workflow_updates` for status in chat

## Status

**v0.1 scaffold** — dispatch transitions are simplified vs full pi-letscook `release-check` parity. Structured emit validation and verifier integration are planned next.

## Development

```bash
npm run typecheck
npm test
```

## License

MIT
