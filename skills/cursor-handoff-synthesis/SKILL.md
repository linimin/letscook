---
name: cursor-handoff-synthesis
description: Run startup synthesis before prepare_cook_handoff in Cursor /cook flows. Load when entering /cook and before writing a handoff capsule.
---

# Cursor Handoff Synthesis

Load this skill when the user enters `/cook` and you need a startable `cook_handoff`.

## Mandatory flow

1. Call `resolve_cook_workspace` (or confirm `workspace_root` from context).
2. Call `get_handoff_synthesis_prompt` with:
   - `discussion_summary` — concise summary of recent chat mission/scope/acceptance
   - `inline_intent` — text after `/cook` if present
   - `workflow_context_lines` — optional `.agent` snapshot lines
3. Execute the returned `analyst_prompt` and produce exactly one JSON object matching `completion.startup.analysis.v1`.
4. Call **either**:
   - `submit_startup_analysis({ structured_analysis })`, or
   - `synthesize_cook_handoff({ structured_analysis, discussion_summary, inline_intent })`
5. If synthesis returns `fail_closed` or `startable: false`, clarify mission in chat and **do not** call `prepare_cook_handoff`.
6. When `startable: true`, call `prepare_cook_handoff({ workspace_root, capsule })` with the synthesized capsule, then `confirm_cook_handoff`.

## Verdicts (fail-closed)

| Verdict | Action |
|---------|--------|
| `startable` | Proceed to prepare + confirm |
| `needs_clarification` | Ask user; rerun synthesis |
| `planning_only` | Stay in planning; do not start workflow |
| `not_repo_change` | Ordinary chat; do not `/cook` |
| `unsafe` | Stop; explain risk |

## Rules

- **Never** call `prepare_cook_handoff` before successful synthesis.
- Plan mapping (`preview_plan_to_cook_handoff`) is synthesis **input** only (`plan_capsule`), not a bypass.
- Preview capsules from earlier turns are advisory unless same-entry validation passes.
- Use full confirmation layout (`confirmation_layout_text`) when presenting the startup brief.
