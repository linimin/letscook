# completion runtime quick reference

Use this as the shared runtime overview. For normal runtime loading, prefer the role-specific quick refs (`runtime-quick-driver.md`, `runtime-quick-bootstrapper.md`, `runtime-quick-regrounder.md`, `runtime-quick-implementer.md`, `runtime-quick-reviewer.md`, `runtime-quick-auditor.md`, and `runtime-quick-stop-judge.md`).

Read the full `../SKILL.md` or `completion.md` only when the chosen quick reference plus canonical `.agent/**` state still leave a protocol detail ambiguous.

## Canonical truth

Read current repo truth plus these canonical workflow inputs as needed:

- package defaults for `task_type`, `evaluation_profile`, and stop policy
- `.agent/current/state.json`
- `.agent/current/startup-brief.json`
- `.agent/current/plan.json`
- `.agent/current/active-slice.json`
- `.agent/current/slice-history.jsonl`
- `.agent/current/stop-check-history.jsonl`
- `.agent/current/verification-evidence.json`

## Shared runtime rules

- Current repo truth beats stale notes, summaries, or conversation memory.
- `startup-brief.json` is canonical startup intake, not the canonical slice plan.
- `plan.json` is the canonical slice backlog.
- For selected, in-progress, committed, or done slices, `active-slice.json` is the canonical implementation contract.
- If canonical state is missing, stale, contradictory, or ambiguous, route to `completion-regrounder`.
- Run exactly one implementation slice at a time, and a slice is not complete until it lands as a new commit.
- Before next-slice progression after a committed slice, the tracked and unignored worktree must be clean. Auto-preserve unrelated dirt when it can be isolated safely.

## Driver and role boundaries

- The main pi session is the workflow driver and dispatches at most one completion role at a time.
- Completion roles do not invoke other completion roles.
- `completion-bootstrapper` is only for missing local helper or canonical-state repair.
- `completion-regrounder` owns canonical reconciliation, slice selection, post-review/audit reconciliation, and final stop reconciliation.
- `completion-implementer` owns exactly one selected slice end to end, including the commit.
- `completion-reviewer`, `completion-auditor`, and `completion-stop-judge` are read-only.

## Continuation and recovery

- `continuation_policy = continue` means the driver keeps dispatching mandatory roles.
- `requires_reground = true` with `next_mandatory_role = completion-regrounder` still belongs under `continuation_policy = continue` when canonical reconciliation can proceed safely without new user input.
- `await_user_input` means ask only for the exact missing input and then stop.
- `blocked` means report the blocker and stop; reserve it for cases that still need user input or another external unblock step.
- `paused` means the user explicitly paused the workflow.
- `done` means final reconciliation is complete.
- `/cook park` is available anytime an active workflow exists, including while `continuation_policy = continue`; resume still routes through canonical reground.
- Stopped workflows resume with `/cook` or `/cook resume`; `/cook cancel` closes the workflow.
- After compaction or any ambiguous state, re-read canonical `.agent/current/*.json*` inputs before continuing.
- Enter `completion-regrounder` whenever `requires_reground` is true or unknown, the next mandatory action is ambiguous, or the active-slice contract drifts from the plan.

## Stop-wave and cleanup reminders

- Under `unanimous-current-head-v1`, only current-HEAD stop-judge records from the current `current_stop_wave_id` count.
- `.agent/verify_completion_*.sh` are local convenience entrypoints, not tracked repo-contract files.
- If `.agent/` disappears after canonical state reaches `done` or `cancelled`, treat that as expected cleanup.
