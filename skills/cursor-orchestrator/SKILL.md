---
name: cursor-orchestrator
description: Run a Cursor-native completion workflow via letscook MCP with bundled completion agents and canonical .agent/ state.
---

# Cursor-native completion workflow (letscook MCP)

Use when the user wants a pi-letscook-style long-running workflow **without Pi**.

## Bundled agents (plugin installs all six)

| Agent | Role |
|-------|------|
| `completion-bootstrapper` | Scaffold `.agent/` helpers |
| `completion-regrounder` | Reconcile plan / slice / state |
| `completion-implementer` | Implement one slice + commit |
| `completion-reviewer` | Read-only slice review |
| `completion-auditor` | Read-only project audit |
| `completion-stop-judge` | Read-only stop verdict |

## Loop (primary agent)

1. `resolve_cook_workspace({ mode: "auto" })` → `synthesize_cook_handoff` → `prepare_cook_handoff` → `confirm_cook_handoff` → orchestrator loop
2. Load **`completion-protocol`** skill while orchestrating; follow mandatory dispatch from `get_workflow_dispatch`
3. `get_workflow_dispatch({ workspace_root })`
4. If `dispatch_allowed`, **invoke the bundled agent** named `cursor_agent`:
   - Use Task / subagent delegation targeting that agent name
   - Include `system_context` + `task_prompt` from dispatch
5. `submit_role_result({ workspace_root, role, raw_output })` with the agent's full final report
6. Repeat from step 3 until `workflow_closed` or user parks/cancels
7. `finish_cook_workflow` → guide `/apply-worktree` and `/delete-worktree`
8. Use `cursor-orchestrator-monitor` when the user asks for status

## Rules

- Always thread the same `workspace_root` (Cursor worktree checkout).
- Never guess `next_mandatory_role`; always use MCP dispatch/submit responses.
- When `driver_continue: true` or `continuation_policy: continue`, **do not end your turn** or ask the user whether to continue — dispatch the next role immediately.
- Dispatch the **named bundled agent** (`cursor_agent`), not a generic assistant.
- Evaluator agents (reviewer, auditor, stop-judge) must stay read-only.

## Hook pairing (auto-continue)

Plugin hooks provide three layers:

| Hook | When | Effect |
|------|------|--------|
| `postToolUse` (MCP) | After `submit_role_result` / `get_workflow_dispatch` | Injects **same-turn** sticky-continue context |
| `subagentStop` | After Task subagent completes | Auto `followup_message` to submit + dispatch next |
| `stop` | After primary agent turn ends | Auto user message if workflow still active |

Verify in **Customize → Hooks**. `loop_limit` is `null` (no cap) for cook continue hooks.
