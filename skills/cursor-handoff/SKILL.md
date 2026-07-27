---
name: cursor-handoff
description: Prepare a cook_handoff for a Cursor-native workflow via letscook MCP.
---

# Cursor handoff (letscook MCP)

Use when planning is done in Cursor and the user wants a long-running completion workflow **without Pi**.

Optional **`cursor-worktree-cook`**: use Cursor `/worktree` when sandbox isolation is preferred.

If the user saved a **Plan mode** `.plan.md`, use **`cursor-plan-handoff`** first for plan mapping, then **`cursor-handoff-synthesis`** before prepare.

## What to do

1. `get_cook_workspace_context` — must be `ready_for_cook: true` (inside git)
2. `resolve_cook_workspace({ mode: "auto" })` — get `workspace_root`
3. **`cursor-handoff-synthesis`**: `synthesize_cook_handoff` (or `get_handoff_synthesis_prompt` → `submit_startup_analysis`)
4. `prepare_cook_handoff` with that `workspace_root` and the **synthesized** capsule
5. **Confirm handoff** (see below)
6. Switch to `cursor-orchestrator` for the dispatch loop
7. On completion, `finish_cook_workflow` — apply/delete worktree when isolated; otherwise review commits on current checkout

## Handoff confirmation UI

After `prepare_cook_handoff`, always call:

```text
confirm_cook_handoff({ workspace_root })
```

### Path A — MCP elicitation (preferred)

When Cursor supports MCP form elicitation, `confirm_cook_handoff` blocks and shows a **native form**.

**Isolated checkout (worktree or feature branch worktree):**
- **Start cook workflow**
- **Cancel handoff**
- **Edit handoff or plan first**

**Main checkout** (`isolation_confirm_required: true`):
- **Start on this checkout (main)** → `start_on_main`
- **Create worktree first** → `defer_worktree` (cancels pending handoff; guide `/worktree` then `/cook`)
- **Cancel handoff**
- **Edit handoff or plan first**

If the user chooses **Start** / **Start on main**, the tool scaffolds `.agent/` (`confirmed: true`).

### Path B — AskQuestion fallback

If the response includes `elicitation_unavailable: true` or `user_action_required: "ask_question"`:

1. Show `confirmation_brief` in chat (optional; it is also embedded in `ask_question`)
2. **Must** call **`AskQuestion`** with the returned `ask_question` payload
3. Map the user's choice — **record confirmation first**, then start:
   - `start` → `confirm_cook_handoff({ workspace_root, skip_elicitation: true, confirmation_action: "start" })` then `start_cook_workflow({ workspace_root, confirmation_id, action: "start" })`
   - `start_on_main` → `confirm_cook_handoff({ workspace_root, skip_elicitation: true, confirmation_action: "start_on_main" })` then `start_cook_workflow({ workspace_root, confirmation_id, action: "start", isolation_choice: "main_checkout_acknowledged" })`
   - `defer_worktree` → `confirm_cook_handoff({ workspace_root, skip_elicitation: true, confirmation_action: "defer_worktree" })`
   - `cancel` → `start_cook_workflow({ workspace_root, action: "cancel" })`
   - `edit` → stop; revise capsule/plan, then `prepare_cook_handoff` again

When `confirm_cook_handoff` returns `action: "defer_worktree"` and `user_action_required: "run_worktree_first"`, follow `next_steps` — do not call `start_cook_workflow`.

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
