---
name: cursor-worktree-cook
description: Run letscook /cook with optional Cursor /worktree isolation.
---

# Cursor worktree + letscook

Use when starting or continuing a **long letscook workflow**, with or without Cursor worktree isolation.

Reference: [Cursor Worktrees docs](https://cursor.com/docs/configuration/worktrees)

## User flow

```text
Route A (isolated, recommended for risky work):
  Plan mode → Save to workspace → /worktree <short task summary> → /cook → confirm → orchestrator
  Finish: /apply-worktree → /delete-worktree

Route B (direct on current checkout):
  Plan mode → Save to workspace → /cook → confirm (main isolation gate if on main) → orchestrator
  Finish: review commits / push / PR on current branch
```

## Agent steps

### 1. Verify workspace

```text
get_cook_workspace_context()
```

| `ready_for_cook` | Action |
|------------------|--------|
| `false` | Not in git — stop; open a git repository |
| `true` | Continue with `workspace_root` |

When `isolation_confirm_required: true`, warn that confirm will ask for an explicit main-checkout decision. Suggest `/worktree` when the task is high-risk or multi-slice.

### 2. Resolve workspace

```text
resolve_cook_workspace({ mode: "auto" })
```

Thread **`workspace_root`** through all MCP calls. Use **`main_repo_root`** for plan discovery (`list_cursor_plans` `repo_root`).

### 3. Project setup (one-time per repo, for Route A)

Add `.cursor/worktrees.json` — see `examples/worktrees.json.example` or `get_cook_workspace_context` → `worktrees_json_example`.

### 4. Handoff + orchestrator

Follow `cursor-handoff` / `cursor-plan-handoff` using the resolved `workspace_root`.

### 5. Finish

```text
finish_cook_workflow({ workspace_root })
```

- **Cursor worktree**: guide `/apply-worktree` then `/delete-worktree`
- **Main or other checkout**: guide commit review / push / PR; no apply-worktree step

## Rules

- Do not manually `git worktree remove` on `.cursor/worktrees/...` paths
- Plans live under main repo `.cursor/plans/`; pass `main_repo_root` as `repo_root` when inside a worktree
- Do not put `implement` verbs in `/worktree` if you only want isolation — Cursor treats the rest of the chat as the task
