---
name: cursor-handoff
description: Prepare a cook_handoff for a Cursor-native workflow via letscook MCP inside a Cursor /worktree checkout.
---

# Cursor handoff (letscook MCP + worktree)

Use when planning is done in Cursor and the user wants a long-running completion workflow **without Pi**.

Requires **`cursor-worktree-cook`**: user must run Cursor `/worktree` before `/cook`.

If the user saved a **Plan mode** `.plan.md`, use **`cursor-plan-handoff`** first, then continue here.

## What to do

1. `get_cook_workspace_context` — must be `ready_for_cook: true`
2. `resolve_cook_workspace({ mode: "auto" })` — get `workspace_root`
3. `prepare_cook_handoff` with that `workspace_root` and a valid `cook_handoff` capsule
4. **Confirm handoff** (see below)
5. Switch to `cursor-orchestrator` for the dispatch loop
6. On completion, `finish_cook_workflow` → guide `/apply-worktree` and `/delete-worktree`

## Handoff confirmation UI

After `prepare_cook_handoff`, always call:

```text
confirm_cook_handoff({ workspace_root })
```

### Path A — MCP elicitation (preferred)

When Cursor supports MCP form elicitation, `confirm_cook_handoff` blocks and shows a **native form** with:

- **Start cook workflow**
- **Cancel handoff**
- **Edit handoff or plan first**

If the user chooses **Start**, the tool confirms and scaffolds `.agent/` in one step (`confirmed: true`).

### Path B — AskQuestion fallback

If the response includes `elicitation_unavailable: true` or `user_action_required: "ask_question"`:

1. Show `confirmation_brief` in chat (optional; it is also embedded in `ask_question`)
2. **Must** call **`AskQuestion`** with the returned `ask_question` payload
3. Map the user's choice:
   - `start` → `start_cook_workflow({ workspace_root, confirmation_id, action: "start" })`
   - `cancel` → `start_cook_workflow({ workspace_root, action: "cancel" })`
   - `edit` → stop; revise capsule/plan, then `prepare_cook_handoff` again

Do **not** wait for free-text "Start" from the user. Always use `confirm_cook_handoff` and, when needed, `AskQuestion`.

Optional preview-only step (no UI): `preview_cook_handoff_confirmation` — use only if you need the layout before calling `confirm_cook_handoff`.

## Required JSON shape

See `get_cook_handoff_schema` or:

```json
{
  "kind": "cook_handoff",
  "source": "primary_agent",
  "captured_at": "<ISO-8601>",
  "mission": "<concise implementation mission>",
  "scope": ["..."],
  "constraints": ["..."],
  "acceptance": ["..."],
  "handoff_kind": "implementation_workflow_handoff",
  "task_type": "completion-workflow",
  "evaluation_profile": "completion-rubric-v1",
  "why_cook_now": "<why workflow mode helps>"
}
```

## Rules

- Thread the same `workspace_root` through prepare → start → orchestrator → monitor → finish
- `handoff_kind` must be `implementation_workflow_handoff`
- Mission must be concrete and repo-change oriented
- Never cook on main checkout
