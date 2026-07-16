# Changelog

## 0.4.0

- Allow `/cook` on main checkout; `resolve_cook_workspace` no longer fails for main worktrees.
- Add `isolation_status` and `isolation_confirm_required` to `get_cook_workspace_context` / `resolve_cook_workspace`.
- Add main-checkout isolation gate in `confirm_cook_handoff` with `start_on_main`, `defer_worktree`, `cancel`, and `edit`.
- `defer_worktree` cancels the pending handoff and returns `user_action_required: run_worktree_first`.
- Record `isolation_choice: main_checkout_acknowledged` in `startup-brief.json` when starting on main.
- Update finish guidance for main checkout (no `/apply-worktree` path).
- Cursor `/worktree` is recommended for sandbox isolation, not required.

## 0.3.0

- pi-letscook protocol parity: startup synthesis, confirmation layout, mandatory dispatch, rubric transcription, control-plane defaults, and `release-check` gate.
- Cursor-specific: `/worktree`, MCP orchestration, elicitation + AskQuestion confirm.
