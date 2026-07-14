# completion runtime quick reference — regrounder

Use this as the default runtime brief for `completion-regrounder`.

Read the full `../SKILL.md` or `completion.md` only when this regrounder brief plus canonical `.agent/**` state still leave a protocol detail ambiguous.

## Canonical inputs

Read current repo truth plus these workflow inputs:

- `.agent/current/state.json`
- `.agent/current/startup-brief.json`
- `.agent/current/plan.json`
- `.agent/current/active-slice.json`
- `.agent/current/slice-history.jsonl`
- `.agent/current/stop-check-history.jsonl`
- `.agent/current/verification-evidence.json`

## Regrounder rules

- Reconcile canonical `.agent/current/plan.json`, `.agent/current/active-slice.json`, and `.agent/current/state.json` against repo truth.
- `startup-brief.json` is mission-level intake, not a canonical selected slice.
- Optional startup verifier-posture fields are advisory only; prefer a `verifier_scaffolding` first slice when deterministic verifier readiness is missing and repo truth does not expose a safer prerequisite.
- Revalidate every slice's `acceptance_criteria`; reopen any `done` slice whose criteria no longer hold.
- If canonical state is ambiguous, stale, contradictory, or recovery requires it, keep routing through `completion-regrounder` rather than guessing.
- When implementer-raised roadmap drift arrives as `requires_reground = true` with `continuation_policy = continue`, treat that as a normal auto-chained reconciliation entrypoint; switch to `blocked` only if canonical reconciliation still cannot proceed safely without external unblock action.
- Manage `current_stop_wave_id` truthfully when stop evaluation restarts on the same HEAD.
- If unrelated dirty tracked files can be isolated safely, auto-preserve them with a reversible stash-plus-note flow under `.agent/current/tmp/dirty-worktree-autostash.json`.
- If overlap or stash/restore risk makes isolation unsafe, reopen or continue the latest slice and route back to `completion-implementer`.
- Do not edit tracked product files or create commits.
