---
name: cursor-orchestrator
description: Run a Cursor-native completion workflow via letscook MCP with bundled completion agents and canonical .agent/ state.
---

# Cursor-native completion workflow (letscook MCP)

Use when the user wants a long-running, slice-based completion workflow in Cursor.

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
2. Load **`completion-protocol`** skill while orchestrating; follow mandatory dispatch from MCP
3. `get_workflow_dispatch({ workspace_root })` — **preflight only** (does not claim)
4. **Preflight gate** — all must pass before claim:
   - `dispatch.in_flight` is null, or `reason` indicates stale in-flight was cleared
   - `dispatch.head_sha` matches `git rev-parse HEAD` in `workspace_root`
   - `slice-history.jsonl` has no successful record for the same `dispatch_key`
   - `.agent/current/state.json` `next_mandatory_role` still equals `dispatch.role`
5. `claim_workflow_dispatch({ workspace_root })` — **only** MCP call that authorizes a Task
6. Invoke **one** Task whose `subagent_type` is `dispatch.subagent_type` (the bundled agent name, such as `completion-reviewer`). Pass `system_context` + `task_prompt` from the claim response. Do not use `generalPurpose`.
7. `submit_role_result({ workspace_root, role, raw_output, dispatch_key })` — `dispatch_key` must match the active claim; clears `dispatch_in_flight`
8. Repeat from step 3 until `workflow_closed` or user parks/cancels
9. `finish_cook_workflow` → guide `/apply-worktree` and `/delete-worktree`
10. Use `cursor-orchestrator-monitor` when the user asks for status (monitor never dispatches)

## Dispatch safety

- **One dispatch key** = `(role, active_slice_id, git HEAD)`. At most one in-flight Task per key.
- **Same turn dedup**: after claim + Task dispatch, ignore duplicate hook nudges until `submit_role_result` completes.
- **Stale hook notifications**: if slice-history already recorded the role for this `dispatch_key`, or `next_mandatory_role` changed → re-read canonical state; do not claim or dispatch again.
- **Background Tasks count as in-flight** (`run_in_background: true`). Ending your turn while waiting is OK; opening a second Task is not.

### Stall recovery

1. Check `dispatch.in_flight` and whether the prior Task is still running.
2. Do **not** open a second Task because hooks repeated a continue message.
3. Only when the prior implementer Task **failed or terminated**, the slice is still `selected` or `in_progress`, and HEAD is unchanged:
   - `claim_workflow_dispatch({ workspace_root, force: true })`
4. Otherwise wait for submit or user intervention.

## Rules

- Always thread the same `workspace_root` (Cursor worktree checkout).
- Never guess `next_mandatory_role`; always use MCP dispatch/submit responses.
- When `driver_continue: true` after **submit**, preflight + claim the next role without asking the user — but never skip claim.
- Dispatch the **named bundled agent**: Task `subagent_type` is `dispatch.cursor_agent` / `dispatch.subagent_type`. `subagentStop` only matches those `completion-*` names.
- Evaluator agents (reviewer, auditor, stop-judge) must stay read-only.
- Never call `claim_workflow_dispatch` twice for the same `dispatch_key` without an intervening `submit_role_result`.

## Hook pairing (auto-continue)

Plugin hooks provide three layers:

| Hook | When | Effect | Must not |
|------|------|--------|----------|
| `postToolUse` (MCP) | After `submit_role_result` with `driver_continue` | Same-turn nudge: preflight → claim → dispatch | Nudge on `get_workflow_dispatch` alone; claim while `dispatch_in_flight` set |
| `subagentStop` | After Task subagent completes | Remind to `submit_role_result` only | Dispatch next role or second claim before submit |
| `stop` | After primary agent turn ends | Followup only when no `dispatch_in_flight` | Followup while subagent still running / awaiting submit |

Verify in **Customize → Hooks**. `loop_limit` is `null` (no cap) for cook continue hooks.
