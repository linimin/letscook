---
name: cursor-orchestrator-monitor
description: Monitor an active letscook workflow in Cursor chat using poll tools.
---

# Monitor letscook workflow

Use **after** `start_cook_workflow` succeeds in the same chat.

## What to do

1. Keep the `workspace_root` from the handoff / start response.
2. Poll `poll_workflow_updates({ workspace_root, since_event_id })` when the user asks for status.
3. Post **only meaningful deltas** — role completed, `dispatch_claimed`, `parked`, `done`, `cancelled`.
4. Use `get_workflow_status({ workspace_root })` when poll returns no events but state is unclear.

## User guidance

| State | Tell the user |
|-------|----------------|
| **workflow_active** | Orchestrator driver continues the loop; monitor does **not** dispatch |
| **dispatch_in_flight set** | A completion-role Task is running; wait for submit |
| **parked** | Edit on main checkout; call `resume_workflow` to continue |
| **done** | Workflow complete; review branch / open PR from worktree |
| **cancelled** | Workflow closed |

## Rules

- Monitoring is **read-only** from `.agent/` and MCP poll/status tools.
- **Never** call `claim_workflow_dispatch`, `get_workflow_dispatch` to launch work, or open a Task/subagent.
- Do not interpret poll results as “you should dispatch role X” — report status only; the orchestrator driver owns dispatch.
- **Stale / duplicate events**: if an event’s role is already in `slice-history.jsonl` for the current slice, or `since_event_id` is behind `last_event_id`, report the delta without suggesting re-dispatch.
- Stop polling when `project_done` or workflow is cancelled.
- Do not spam chat on empty polls.
