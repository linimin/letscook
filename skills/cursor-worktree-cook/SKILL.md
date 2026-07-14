---
name: cursor-worktree-cook
description: Run letscook /cook inside a Cursor-native /worktree checkout.
---

# Cursor worktree + letscook

Use when starting or continuing a **long letscook workflow** with Cursor's built-in worktree isolation.

Reference: [Cursor Worktrees docs](https://cursor.com/docs/configuration/worktrees)

## User flow

```text
1. Plan mode → Save to workspace (.cursor/plans/*.plan.md)
2. /worktree <short task summary>
3. /cook
4. Confirm handoff → orchestrator loop
5. /apply-worktree → /delete-worktree
```

## Agent steps

### 1. Verify isolation

```text
get_cook_workspace_context()
```

| `ready_for_cook` | Action |
|------------------|--------|
| `false` | Tell user to run `/worktree <summary>` first; stop |
| `true` | Continue with `workspace_root` |

### 2. Resolve workspace

```text
resolve_cook_workspace({ mode: "auto" })
```

Thread **`workspace_root`** through all MCP calls. Use **`main_repo_root`** for plan discovery (`list_cursor_plans` `repo_root`).

### 3. Project setup (one-time per repo)

Add `.cursor/worktrees.json` — see `examples/worktrees.json.example` or `get_cook_workspace_context` → `worktrees_json_example`.

### 4. Handoff + orchestrator

Follow `cursor-handoff` / `cursor-plan-handoff` using the resolved `workspace_root`.

### 5. Finish

```text
finish_cook_workflow({ workspace_root })
```

Guide user: **`/apply-worktree`** then **`/delete-worktree`**.

## Rules

- Never cook on main checkout
- Do not manually `git worktree remove` on `.cursor/worktrees/...` paths
- Plans live under main repo `.cursor/plans/`; pass `main_repo_root` as `repo_root` when inside a worktree
