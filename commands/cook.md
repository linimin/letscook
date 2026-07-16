---
name: cook
description: Start a letscook completion workflow from a saved Cursor plan or a chat handoff
---

# /cook

Start a **letscook** completion workflow with the six-role orchestrator.

## Prerequisites

You need a **git repository**. Isolated worktrees are **optional but recommended**.

```text
Route A (isolated): Plan mode → Save to workspace → /worktree <task> → /cook
Route B (direct):   Plan mode → Save to workspace → /cook
```

On **main checkout**, `confirm_cook_handoff` shows an extra isolation gate (`start_on_main` vs `defer_worktree`).

## Steps

1. **`get_cook_workspace_context`** — must show `ready_for_cook: true` (inside git)
2. **Plan path** (optional): follow **`cursor-plan-handoff`** with `plan_hint` from recent chat
3. **`resolve_cook_workspace({ mode: "auto" })`**
4. **`cursor-handoff-synthesis`**: `synthesize_cook_handoff` → **`prepare_cook_handoff`** → **`confirm_cook_handoff`** → orchestrator loop
5. Follow **`cursor-orchestrator`** for the dispatch loop
6. **`finish_cook_workflow`** — use `/apply-worktree` + `/delete-worktree` when in a Cursor worktree; otherwise review commits on the current checkout

Do **not** press Plan **Build locally**.

## Chat handoff (no plan file)

Same as above: **`cursor-handoff`** with resolved `workspace_root`. Use `/worktree` first only when you want sandbox isolation.

Do not implement product changes during handoff preparation.
