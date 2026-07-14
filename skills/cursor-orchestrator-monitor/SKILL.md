---
name: cursor-orchestrator-monitor
description: Monitor an active letscook workflow in Cursor chat using poll tools.
---

# Monitor letscook workflow

Use **after** `start_cook_workflow` succeeds in the same chat.

## What to do

1. Keep the `workspace_root` from the handoff / start response.
2. Poll `poll_workflow_updates({ workspace_root, since_event_id })` when the user asks for status.
3. Post **only meaningful deltas** — role completed, `parked`, `done`, `cancelled`.
4. Use `get_workflow_status({ workspace_root })` when poll returns no events but state is unclear.

## User guidance

| State | Tell the user |
|-------|----------------|
| **workflow_active** | Orchestrator loop is running; dispatch next role via MCP |
| **parked** | Edit on main checkout; call `resume_workflow` to continue |
| **done** | Workflow complete; review branch / open PR from worktree |
| **cancelled** | Workflow closed |

## Rules

- Monitoring is read-only from `.agent/`.
- Stop polling when `project_done` or workflow is cancelled.
- Do not spam chat on empty polls.
