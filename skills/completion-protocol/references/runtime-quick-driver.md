# completion runtime quick reference — driver

Use this as the default runtime brief for the workflow driver.

Read the full `../SKILL.md` or `completion.md` only when this driver brief plus canonical `.agent/**` state still leave a protocol detail ambiguous.

## Canonical inputs

Read current repo truth plus these canonical workflow inputs as needed:

- package defaults for `task_type`, `evaluation_profile`, and stop policy
- `.agent/current/state.json`
- `.agent/current/startup-brief.json`
- `.agent/current/plan.json`
- `.agent/current/active-slice.json`
- `.agent/current/slice-history.jsonl`
- `.agent/current/stop-check-history.jsonl`
- `.agent/current/verification-evidence.json`

## Driver rules

- The main pi session is the workflow driver and dispatches at most one completion role at a time.
- Use `completion-bootstrapper` only for missing local helper or canonical-state repair.
- Use `completion-regrounder` for canonical reconciliation, slice selection, post-review/audit reconciliation, and final stop reconciliation.
- Use `completion_role` for all completion-* role work. Do not directly implement tracked product changes yourself while workflow is active.
- `continuation_policy = continue` means keep dispatching mandatory roles.
- `requires_reground = true` plus `next_mandatory_role = completion-regrounder` is still a continue-state handoff when canonical reconciliation can proceed without new user input.
- Stop only when canonical state is `await_user_input`, `blocked`, `paused`, or `done`.
- If canonical state is missing, stale, contradictory, or ambiguous, route to `completion-regrounder`.
- If `.agent/` disappears after canonical state reaches `done` or `cancelled`, treat that as expected cleanup.
