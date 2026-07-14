---
name: cursor-orchestrator
description: Run a Cursor-native completion workflow via letscook MCP with subagents and canonical .agent/ state.
---

# Cursor-native completion workflow (letscook MCP)

Use when the user wants a pi-letscook-style long-running workflow **without Pi**.

## Loop (primary agent)

1. `ensure_cook_worktree` → `prepare_cook_handoff` → confirm → `start_cook_workflow`
2. `get_workflow_dispatch({ workspace_root })`
3. If `dispatch_allowed`, launch a **Task subagent** with:
   - `system_context` + `task_prompt` from dispatch
   - subagent type from `subagent_type`
4. `submit_role_result({ workspace_root, role, raw_output })`
5. Repeat from step 2 until `workflow_closed` or user parks/cancels
6. Monitor with `poll_workflow_updates` when asked

## Rules

- Always thread the same `workspace_root` (cook worktree path).
- Never guess `next_mandatory_role`; always use MCP dispatch/submit responses.
- After `park_workflow`, stop dispatching until `resume_workflow`.
- Evaluator roles (reviewer, auditor, stop-judge) must stay read-only.

## Optional hook pairing

Configure `subagentStop` to return `followup_message` prompting the primary agent to call `get_workflow_dispatch` again. Set `loop_limit` high enough for multi-slice workflows.
