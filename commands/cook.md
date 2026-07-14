---
name: cook
description: Start a letscook completion workflow from a saved Cursor plan or a chat handoff
---

# /cook

Start a **letscook** completion workflow inside a **Cursor `/worktree` checkout** + six-role orchestrator.

## Prerequisites

Run **`/worktree <task summary>`** in this chat **before** `/cook`. Cook does not run on the main checkout.

```text
Plan mode → Save to workspace → /worktree <task> → /cook
```

## Steps

1. **`get_cook_workspace_context`** — must show `ready_for_cook: true`
2. **Plan path** (optional): follow **`cursor-plan-handoff`** with `plan_hint` from recent chat
3. **`resolve_cook_workspace({ mode: "auto" })`**
4. **`cursor-handoff-synthesis`**: `synthesize_cook_handoff` → **`prepare_cook_handoff`** → **`confirm_cook_handoff`** → orchestrator loop
5. Follow **`cursor-orchestrator`** for the dispatch loop
6. **`finish_cook_workflow`** → **`/apply-worktree`** → **`/delete-worktree`**

Do **not** press Plan **Build locally**.

## Chat handoff (no plan file)

Same as above: `/worktree` first, then **`cursor-handoff`** with resolved `workspace_root`.

Do not implement product changes during handoff preparation.
