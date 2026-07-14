# completion

`completion` is a repo-local control-plane protocol for long-running completion work.

## Local Helper Files

- `.agent/verify_completion_stop.sh`
- `.agent/verify_completion_control_plane.sh`

These helper files are generated local convenience entrypoints, not tracked repo-contract files.

## Ignored Canonical Execution State

- `.agent/current/state.json`
- `.agent/current/startup-brief.json`
- `.agent/current/plan.json`
- `.agent/current/active-slice.json`
- `.agent/current/slice-history.jsonl`
- `.agent/current/stop-check-history.jsonl`
- `.agent/current/verification-evidence.json`
- `.agent/current/*.log`

## Canonical Inputs

Read these when making completion decisions:

- package defaults for task_type, evaluation_profile, and stop policy
- `.agent/current/state.json`
- `.agent/current/startup-brief.json`
- `.agent/current/plan.json`
- `.agent/current/active-slice.json`
- `.agent/current/slice-history.jsonl`
- `.agent/current/stop-check-history.jsonl`
- `.agent/current/verification-evidence.json`

Optional context:

- `.agent/backlog.md`
- `.agent/handoff.md`
- `.agent/compact.md`

## Structured Verification Evidence

`.agent/current/verification-evidence.json` stays additive and legacy-tolerant. Keep top-level `summary` as the terse prose fallback, but when structured evidence is present, roles should read and update:

- `evidence_quality`
- `command_results`
- `acceptance_coverage`
- `flake_signals`
- `open_gaps`
- `basis_regression_required`, `basis_regression_status`, `basis_regression_reason`, and `basis_regression_artifact_paths`

Use repo-relative artifact paths only. Prefer concise summaries and the canonical artifact path over raw command output.

Run basis regression selectively for eligible bugfix/regression slices. Use `bash scripts/run-basis-regression-check.sh` to rerun a current-HEAD verifier in a disposable worktree at `basis_commit`, recording `failed_on_basis`, `passed_on_basis`, `not_run`, or `not_applicable` with `basis_regression_required` and `basis_regression_reason`. Do not treat `not_run` or `not_applicable` as implicit passes.

## Scratch Space

- Use repo-local `.agent/current/tmp/` as the default completion scratch space.
- Keep `.agent/current/tmp/` ignored in `.gitignore` with other non-contract `.agent/*` artifacts.
- Avoid `/tmp` or `/private/tmp` unless a tool requires OS temp.
- When OS temp is required, prefer `$TMPDIR/pi-completion/<repo-name>/`.
- Do not keep canonical state, required verification evidence, or the only copy of a deliverable only in scratch.

## Fixed Profile Schema

```json
{
  "schema_version": 1,
  "protocol_id": "completion",
  "project_name": "<repo-name>",
  "required_stop_judges": 2,
  "stop_aggregation_policy": "unanimous-current-head-v1",
  "priority_policy_id": "completion-default",
  "task_type": "completion-workflow",
  "evaluation_profile": "completion-rubric-v1",
  "docs_surfaces": ["README.md", "docs/"]
}
```

## Fixed State Model

`state.json` carries the authoritative summary.

Required fields:

- `schema_version`
- `mission_anchor`
- `task_type`
- `evaluation_profile`
- `current_phase`
- `continuation_policy`
- `continuation_reason`
- `project_done`
- `requires_reground`
- `slices_since_last_reground`
- `remaining_release_blockers`
- `remaining_high_value_gaps`
- `unsatisfied_contract_ids`
- `release_blocker_ids`
- `next_mandatory_action`
- `next_mandatory_role`
- `remaining_stop_judges`
- `current_stop_wave_id`
- `last_reground_at`
- `last_auditor_verdict`
- `contract_status`
- `latest_completed_slice`
- `latest_verified_slice`

`continuation_policy` must be one of:

- `continue`
- `await_user_input`
- `blocked`
- `paused`
- `done`

`next_mandatory_role` must be one of:

- `completion-bootstrapper`
- `completion-regrounder`
- `completion-implementer`
- `completion-reviewer`
- `completion-auditor`
- `completion-stop-judge`
- `null`

`current_phase` must be one of:

- `reground`
- `implement`
- `post_commit_review`
- `post_commit_audit`
- `post_commit_reconcile`
- `stop_wave`
- `awaiting_user`
- `blocked`
- `done`

Rules:

1. `continuation_policy == continue` means the workflow root must keep advancing and must not stop after a slice to ask whether to continue.
2. `requires_reground == true` with `next_mandatory_role == completion-regrounder` still belongs under `continuation_policy == continue` when canonical reconciliation can proceed without new user input or another unsafe external unblock step.
3. `continuation_policy == await_user_input` means the workflow root must ask only for the exact missing input and then stop.
4. `continuation_policy == blocked` means the workflow root must report the blocker and stop.
5. Reserve `continuation_policy == blocked` for cases where canonical reconciliation cannot proceed safely without user input, conflict resolution, ownership clarification, or another external unblock action.
6. `continuation_policy == paused` means the user explicitly paused the workflow.
7. `continuation_policy == done` means canonical final stop reconciliation is complete and the workflow may stop.
8. `/cook park` is available anytime an active workflow exists, including while `continuation_policy = continue`, to record a parked paused posture with `requires_reground = true` and a cleared active-slice handoff before ordinary direct edits; resume still routes through canonical reground.
9. When canonical state is stopped (`await_user_input`, `blocked`, or `paused`), rerun `/cook` or `/cook resume` to continue from canonical state, or use `/cook cancel` to close the workflow and disable stale hard locks / auto-resume.

After a workflow reaches a closed `done` or `cancelled` posture, extension cleanup may remove the entire `.agent/` directory before control returns. Treat disappearance of `.agent/current/**` and `.agent/verify_completion_*.sh` after closure as expected cleanup, not as a missing tracked-file anomaly, and do not recreate local helper files merely to narrate final status.

`startup-brief.json` carries the confirmed `/cook` startup intake.

Rules:

1. Treat mission, scope, constraints, acceptance, risks, and notes there as workflow-level intent, not as a preselected active slice.
2. Optional `*_hint` fields plus optional verifier-posture fields `verification_truth_mode`, `deterministic_verifier_ready`, `verification_latency`, `verification_noise_risk`, `verifier_gap`, and `recommended_first_slice_kind` are advisory startup input only.
3. When deterministic verifier readiness is missing and repo truth does not reveal a safer prerequisite, `completion-regrounder` should prefer a `verifier_scaffolding` first slice.

`plan.json` carries the ordered persistent slice backlog.

Required fields:

- `schema_version`
- `mission_anchor`
- `task_type`
- `evaluation_profile`
- `last_reground_at`
- `plan_basis`
- `candidate_slices`

Each `candidate_slices[]` entry must include:

- `slice_id`
- `goal`
- `acceptance_criteria`
- `contract_ids`
- `priority`
- `status` where status is one of `planned`, `selected`, `in_progress`, `blocked`, `done`, `cancelled`
- `why_now`
- `blocked_on`
- `evidence`

### Acceptance Criteria Contract

`acceptance_criteria` is a non-empty list of concrete, verifiable conditions that define when a slice is done.

Rules:

1. Set at re-ground time. Every slice in `candidate_slices` must have `acceptance_criteria`. A slice with empty `acceptance_criteria` is invalid.
2. Immutable after lock. Re-ground waves must not weaken, replace, or silently drop `acceptance_criteria`. The only allowed mutations are:
   - removing a criterion because repo truth already satisfies it, with `evidence` updated to prove it
   - adding a criterion discovered during implementation that was missing from the original assessment
3. Done requires all satisfied. A slice may only transition to `done` when every acceptance criterion is satisfied and `evidence` contains the proof for each one.
4. Re-ground validation. During re-ground, the current slice backlog must be revalidated against repo truth. A slice previously marked `done` whose criteria no longer hold must be reopened.
5. Clean handoff before next slice. After a committed slice is reviewed and audited, the tracked and unignored worktree must be clean before the next slice is selected.
6. Dirty-worktree auto-reconcile. If tracked worktree dirt is unrelated to the latest slice or current reconciliation surfaces and can be isolated safely, the workflow should auto-preserve it with a reversible mechanism such as a named git stash plus a `.agent/current/tmp/dirty-worktree-autostash.json` note, continue the mandatory workflow step, and restore it before handing control back. Ask the user only when overlap, ownership ambiguity, or stash/restore conflicts make automatic isolation unsafe.

`active-slice.json` carries one current slice cursor.

Required base fields:

- `schema_version`
- `mission_anchor`
- `task_type`
- `evaluation_profile`
- `status`
- `slice_id`
- `goal`
- `contract_ids`
- `acceptance_criteria`
- `blocked_on`
- `locked_notes`
- `must_fix_findings`
- `implementation_surfaces`
- `verification_commands`
- `basis_commit`
- `remaining_contract_ids_before`
- `release_blocker_count_before`
- `high_value_gap_count_before`

When `status` is `selected`, `in_progress`, `committed`, or `done`, `active-slice.json` must also carry the exact implementer handoff snapshot so `completion-implementer` can resume after compaction without asking the user to resend the original caller payload.

Required exact handoff fields:

- `acceptance_criteria`
- `priority`
- `why_now`
- `blocked_on`
- `locked_notes`
- `must_fix_findings`
- `implementation_surfaces`
- `verification_commands`
- `basis_commit`
- `remaining_contract_ids_before`
- `release_blocker_count_before`
- `high_value_gap_count_before`

Field meaning:

- `implementation_surfaces` — the repo files or surfaces this slice is expected to update or keep in parity, so implementers can resume on the right scope after compaction.
- `verification_commands` — the focused and broader deterministic checks expected before the slice is committed.

Allowed `status` values:

- `idle`
- `selected`
- `in_progress`
- `committed`
- `done`

`slice-history.jsonl` is append-only and only accepts:

- `implemented`
- `reviewed`
- `audited`
- `accepted`
- `reopened`

Minimum record shape:

- `schema_version`
- `type`
- `recorded_at`
- `slice_id`
- `commit_sha`
- `head_sha`

`stop-check-history.jsonl` is append-only and only accepts:

- `judgment`

Minimum record shape:

- `schema_version`
- `type`
- `recorded_at`
- `head_sha`
- `stop_wave_id`
- `can_stop`
- `blocker_count`
- `high_value_gap_count`

Empty history files are legal.

## Final Stop Aggregation Policy

The packaged default stop policy is:

- `required_stop_judges: 2`
- `stop_aggregation_policy: "unanimous-current-head-v1"`

Policy meaning:

- `state.json current_stop_wave_id` is the current stop-wave epoch for the current mission and may be incremented to restart stop evaluation on the same `HEAD`
- count only `judgment` records whose `head_sha` matches the current `HEAD` and whose `stop_wave_id` matches `state.json current_stop_wave_id`
- require at least two valid current-HEAD judgments for the current stop-wave epoch before repo-level stop verification may run
- fail closed if any current-HEAD judgment in the current stop-wave epoch has `can_stop = false`
- fail closed if a current-HEAD judgment in the current stop-wave epoch is malformed or carries non-zero blocker/high-value-gap counts
- rerun `bash .agent/verify_completion_stop.sh` only after the required current-HEAD judgments for the current stop-wave epoch are faithfully recorded, then hand final reconciliation back to `completion-regrounder`

## Structured Evaluation Rubric Foundation

`completion-reviewer`, `completion-auditor`, and `completion-stop-judge` must emit rubric-backed evaluations using the same shared dimension names and verdict semantics.

The shared rubric foundation now sits alongside canonical `task_type` and `evaluation_profile` signaling in package defaults plus runtime `.agent/current/state.json`, `.agent/current/plan.json`, and `.agent/current/active-slice.json`. That signaling is routing metadata only; later slices may still add stricter profile-aware rubric-output enforcement.

Required rubric section:

- `Rubric:`
- `- Contract coverage: pass|concern|fail - ...`
- `- Correctness risk: pass|concern|fail - ...`
- `- Verification evidence: pass|concern|fail - ...`
- `- Docs/state parity: pass|concern|fail - ...`

Use the dimension names and verdict words exactly as written above.

Dimension meaning:

- `Contract coverage` — whether the slice or current HEAD satisfies the locked acceptance criteria and role-specific workflow obligations.
- `Correctness risk` — whether regressions, blocking defects, safety issues, or closure risks are still evident in current repo truth.
- `Verification evidence` — whether tests, deterministic proof, and rerun verification are strong enough for the role's decision.
- `Docs/state parity` — whether docs, config, runbooks, and canonical `.agent` state stay truthful to shipped behavior for the role's scope.

Verdict semantics:

- `pass` — no material issue remains for that dimension in the role's current decision.
- `concern` — a real caveat or remaining gap exists, but it does not by itself force rejection or `NO-STOP`; explain the follow-up plainly.
- `fail` — a blocking issue or contradictory truth exists and the role's final verdict must not be positive.

Decision alignment rules:

- Reviewer: any `fail` means `Acceptable as-is` must be `no`.
- Auditor: use `concern` or `fail` to explain why the project is not yet done and whether canonical backlog/state remain truthful.
- Stop judge: any `fail` means `Can the project stop now` must be `no`.

Always include all four rubric lines, even when every dimension is `pass`.

## One-Slice Lifecycle

1. Re-ground from current repo truth.
2. Choose exactly one highest-value slice.
3. Mark that slice in canonical state.
4. Implement the smallest correct tracked-file change.
5. Add tests or deterministic proof that satisfy one or more `acceptance_criteria`.
6. Run focused verification first, then broader verification if needed.
7. Commit.
8. Update canonical state and append one `implemented` record.
9. Run read-only review and audit.
10. Confirm the tracked and unignored worktree is clean before selecting the next slice.
11. Append `reviewed`, `audited`, and `accepted` or `reopened`.
12. Repeat until the stop wave concludes the repo may stop.

## Workflow Topology

The workflow topology is mandatory and flat:

1. The main pi session stays the workflow root.
2. The main pi session invokes at most one completion role at a time.
3. `completion-bootstrapper` is used only for first-time setup or missing local helper / canonical-state repair.
4. `completion-regrounder` is the mandatory role for canonical `.agent` reconciliation, slice selection, post-review or post-audit reconciliation, and final stop reconciliation.
5. `completion-implementer`, `completion-reviewer`, `completion-auditor`, and `completion-stop-judge` are sibling roles invoked directly by the workflow root.
6. No completion role may invoke another completion role during the normal workflow.

## Primary Workflow Driver Contract

The main pi session may:

- read repo truth and canonical `.agent` state
- update canonical `.agent/**` state truthfully for handoff
- invoke the correct completion role according to the mandatory dispatch table
- append canonical history records as a faithful transcription of actual role outputs

It must not, while a slice is selected or in progress:

- directly edit non-`.agent/**` tracked product/docs/config/test files for that slice
- directly create the slice commit
- directly claim review/audit/acceptance/judgment outcomes without the corresponding role output
- bypass mandatory completion-role dispatch for convenience
- hand control back to the user between slices merely to ask whether to continue when `continuation_policy == continue`

## Mandatory Dispatch Table

1. If repo-local `.agent/**` helper surfaces or canonical execution-state scaffolding are missing and truthful onboarding or repair is required, invoke `completion-bootstrapper`.
2. If canonical `.agent` execution state is missing, stale, invalid, contradictory, or ambiguous after compaction or recovery, invoke `completion-regrounder` first.
3. If no slice is selected, invoke `completion-regrounder` to reconcile `.agent/current/plan.json` and return the next exact handoff payload.
4. If a slice is `selected` or `in_progress` and no new commit exists for it yet, invoke `completion-implementer`.
5. If the latest committed slice lacks review, invoke `completion-reviewer`.
6. If the latest committed slice lacks audit, invoke `completion-auditor`.
7. If canonical reconciliation is needed after review or audit, invoke `completion-regrounder`.
8. If all slices are done and final closure is under evaluation, invoke the required `completion-stop-judge` sessions directly.
9. After the required current-HEAD judgments are recorded, rerun `bash .agent/verify_completion_stop.sh` and invoke `completion-regrounder` for final stop reconciliation.

## Compaction And Recovery

After context compaction, suspected memory loss, stalled-role recovery, or any ambiguous completion state, the workflow root must re-read:

- `.agent/current/state.json`
- `.agent/current/startup-brief.json`
- `.agent/current/plan.json`
- `.agent/current/active-slice.json`
- `.agent/current/verification-evidence.json`

The workflow root must invoke `completion-regrounder` before continuing whenever any of the following is true:

- `requires_reground` is `true`
- `requires_reground` is unknown because canonical state is missing or unreadable
- `next_mandatory_action` is missing, unknown, or ambiguous
- `active-slice.json` does not match `.agent/current/plan.json`
- acceptance criteria for the selected or active slice are missing or unclear
- the exact implementer handoff snapshot in `.agent/current/active-slice.json` is missing, stale, or contradictory

The workflow root must not continue implementation, review, audit, or stop evaluation from compacted conversation memory alone.

After compaction or recovery, `completion-implementer` must also re-read canonical `.agent/current/state.json`, `.agent/current/plan.json`, `.agent/current/active-slice.json`, and `.agent/current/verification-evidence.json` before resuming work. If `.agent/current/active-slice.json` still contains a truthful exact handoff snapshot, continue from canonical state rather than asking the user to resend the original caller payload.

## Default Priority Policy

`completion-default` ranks candidate slices in this order:

1. shipped behavior versus docs/config mismatch
2. safety, security, data-loss, fail-open, or fail-closed critical behavior
3. startup, install, migration, or restart critical path
4. operator emergency, rollback, or recovery path
5. normal primary lifecycle path
6. docs/config/runbook parity
7. regression depth
8. final closure and hygiene
