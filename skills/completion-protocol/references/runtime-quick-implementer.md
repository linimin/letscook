# completion runtime quick reference — implementer

Use this as the default runtime brief for `completion-implementer`.

Read the full `../SKILL.md` or `completion.md` only when this implementer brief plus canonical `.agent/**` state still leave a protocol detail ambiguous.

## Canonical inputs

Read these canonical inputs before acting:

- `.agent/current/state.json`
- `.agent/current/plan.json`
- `.agent/current/active-slice.json`
- `.agent/current/verification-evidence.json`

## Implementer rules

- For selected, in-progress, committed, or done slices, `.agent/current/active-slice.json` is the canonical implementation contract.
- Stop and report a blocker instead of guessing if required handoff fields are missing, stale, or ambiguous.
- Confirm `.agent/current/active-slice.json` stays in parity with `.agent/current/plan.json` before implementation.
- Implement exactly one selected slice end to end, including deterministic proof and the commit.
- A canonically selected slice may be `verifier_scaffolding`; implement that additive verifier/readiness plumbing like any other real slice instead of waiting for a broader product change.
- Only this role edits tracked product files for the slice and appends exactly one `implemented` record after the commit.
- If unrelated dirty tracked files can be isolated safely, auto-preserve them with a reversible stash-plus-note flow under `.agent/current/tmp/dirty-worktree-autostash.json`.
- If roadmap-level drift appears, report it and hand control back to `completion-regrounder` instead of redesigning the plan silently.
- When that drift can be reconciled canonically without new user input, keep `requires_reground = true`, set `next_mandatory_role = completion-regrounder`, and keep `continuation_policy = continue` so the driver auto-dispatches re-grounding.
- Use `continuation_policy = blocked` only when canonical reconciliation cannot proceed safely without user input or another external unblock step.
