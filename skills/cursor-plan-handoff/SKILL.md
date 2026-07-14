---
name: cursor-plan-handoff
description: Convert a saved Cursor Plan mode .plan.md into a cook_handoff capsule, then continue through cursor-handoff instead of Plan Build.
---

# Cursor plan → handoff

Use when the user finished **Plan mode**, saved the plan to the workspace, and wants **letscook** to execute it instead of clicking **Build locally**.

## Do not use Plan Build

Plan **Build locally** runs Cursor's one-shot agent loop. This skill keeps the plan as the source of truth but routes execution through letscook's six-role workflow, cook worktree, and `.agent/` state.

## When to apply

- User says: "用 letscook 執行這份 plan", "execute plan with letscook", `/cook`
- A `.cursor/plans/*.plan.md` exists (user clicked **Save to workspace** in Plan mode)
- User explicitly chose **not** to press Build locally

## Workflow

### 1. Locate the plan from chat context

MCP cannot read chat directly. The **primary agent** must summarize recent discussion into `plan_hint` and pass it to MCP.

**Build `plan_hint` before any preview call** — combine the last few relevant turns:

- Plan title or feature name the user discussed (e.g. "Auth Redirect Fix", "API refactor")
- Key nouns from Plan mode Q&A (modules, files, goals)
- User's latest `/cook` message if it names the task
- Do **not** include unrelated older topics

If a `.plan.md` file is **open in the editor**, also pass `open_plan_path` with its absolute or workspace-relative path.

```text
preview_plan_to_cook_handoff({
  repo_root,
  plan_hint: "<short summary from recent chat>",
  open_plan_path?: "<.plan.md if open>"
})
```

Optional dry run:

```text
list_cursor_plans({ repo_root, plan_hint })
```

**Resolution order (MCP):**

1. `plan_path` — explicit user/agent choice
2. `open_plan_path` — editor-open `.plan.md`
3. `plan_hint` — rank plans by name / overview / filename token overlap
4. Single workspace plan — auto-pick
5. Multiple plans, weak/no match → `needs_disambiguation` — call **`AskQuestion`** to pick `plan_path` (do not free-text guess)

Never silently pick "newest plan" when multiple plans exist and chat context is ambiguous.

### 2. Preview the handoff mapping

```text
preview_plan_to_cook_handoff({ plan_path?, open_plan_path?, plan_hint?, repo_root, overrides? })
```

Show in chat:

- `plan_name`, `plan_overview`, `todo_summary`
- `capsule` (mission, scope, acceptance, constraints)
- `mapping_notes` and `gaps` (if any)
- `suggested_slug` / `suggested_branch`

If `gaps` is non-empty, fix with `overrides` or ask the user to edit the plan, then re-preview. Do **not** prepare until synthesis succeeds.

### 3. Synthesize (required — plan is input only)

Pass the preview `capsule` as `plan_capsule` to synthesis; it is **not** the final handoff:

```text
synthesize_cook_handoff({
  workspace_root,
  plan_capsule: <capsule from preview>,
  discussion_summary: "<plan_hint + chat summary>",
  inline_intent?: "<text after /cook>"
})
```

If `fail_closed` or `startable: false`, clarify and rerun. Follow **`cursor-handoff-synthesis`**.

### 4. Hand off to letscook (existing flow)

Read **`cursor-worktree-cook`** if not already in a Cursor worktree.

Follow `cursor-handoff`:

1. `resolve_cook_workspace({ mode: "auto" })` — use Cursor `/worktree` checkout (`workspace_root`)
2. `prepare_cook_handoff({ workspace_root, capsule })` — use capsule from preview (plus any overrides)
3. `confirm_cook_handoff({ workspace_root })` — MCP elicitation form or `AskQuestion` fallback (see `cursor-handoff`)
4. If `confirmed: true`, switch to `cursor-orchestrator` (+ `cursor-orchestrator-monitor` when asked)
5. If fallback was used and user chose **Start**, call `start_cook_workflow`

Thread the same `workspace_root` through the entire loop.

## Mapping rules (preview_plan_to_cook_handoff)

| cook_handoff field | Source in plan |
|--------------------|----------------|
| `mission` | `overview`, else first body paragraph, else `name` |
| `scope` | `## Scope` / `## Files` bullets, backtick paths in body/todos, else `<repo>` |
| `acceptance` | pending todos + `## Acceptance` / `## Verification` / `## Test plan` |
| `constraints` | `## Constraints`, else default minimal-change rule |
| `non_goals` | `## Non-goals` / `## Out of scope` |
| `risks` | `## Risks` |
| `notes` | plan path, pending todo summary |
| `source` | `cursor_plan` |
| `why_cook_now` | fixed: plan reviewed; letscook adds review/audit/stop gates |

Improve mapping quality by editing the plan markdown before preview:

```markdown
## Scope
- `src/feature/`

## Acceptance
- Tests pass for X
```

## Rules

- Do not implement product code during plan conversion — only MCP handoff prep.
- Do not call `start_cook_workflow` until the user confirms via MCP elicitation or `AskQuestion`.
- If `preview_plan_to_cook_handoff` returns `needs_disambiguation`, call **`AskQuestion`** with plan candidates before continuing.
- Plans only under `.cursor/plans/` are workspace-scoped. Global plans in `~/.cursor/plans` are not startable until saved to the workspace.
- After workflow starts, treat the saved `.plan.md` as reference; canonical progress lives under `.agent/` in the cook worktree.
