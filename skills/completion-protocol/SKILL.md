---
name: completion-protocol
description: Shared completion workflow protocol for long-running coding tasks with canonical .agent state, one-slice execution, mandatory role dispatch, recovery, and final stop criteria. Use only after the user explicitly enters `/cook` and the Cursor primary agent becomes the completion workflow driver.
---

# Completion Protocol

> **Cursor adapter:** In letscook, the primary agent orchestrates via MCP (`get_workflow_dispatch`, `submit_role_result`) and bundled completion subagents — not Pi `completion_role` / `completion_emit_*` tools. Protocol truth in `.agent/**` and this skill is identical to pi-letscook.

Load this skill only after the user explicitly enters `/cook` and you are operating inside the `completion` workflow as the workflow driver or a completion role.

Do not load or follow this skill from ordinary chat.

This skill defines shared protocol facts only. Role-specific behavior belongs in the dedicated completion agents:

- `completion-bootstrapper`
- `completion-regrounder`
- `completion-implementer`
- `completion-reviewer`
- `completion-auditor`
- `completion-stop-judge`

## Shared Rules

- Current repo truth beats stale notes, stale summaries, and conversation memory.
- `startup-brief.json` is the persistent machine-readable record of the confirmed `/cook` startup intent. It is canonical workflow intake, not the canonical slice plan.
- `startup-brief.json` may include optional `*_hint` fields for an initial slice plus optional verifier-posture fields `verification_truth_mode`, `deterministic_verifier_ready`, `verification_latency`, `verification_noise_risk`, `verifier_gap`, and `recommended_first_slice_kind`, but those fields are advisory startup input only; `completion-regrounder` still owns canonical slice planning and should prefer a `verifier_scaffolding` first slice when deterministic verifier readiness is missing and repo truth does not expose a safer prerequisite.
- `plan.json` is the persistent machine-readable slice backlog. Rebuild it during every re-grounding wave and keep it truthful after every committed slice.
- `state.json` is the persistent machine-readable workflow controller. Keep `current_phase`, `continuation_policy`, `continuation_reason`, `next_mandatory_role`, and `next_mandatory_action` truthful after every transition.
- Every slice in `plan.json` must have non-empty `acceptance_criteria` — concrete, verifiable conditions that define done. A slice without acceptance criteria is invalid and must not be selected.
- Acceptance criteria are immutable after lock except for removing a criterion already satisfied with evidence or adding a missing criterion discovered during implementation.
- If implementation discovers roadmap-level drift — such as invalid slice boundaries, missing prerequisite slices, dependency reordering, or a blocker that changes the current slice contract — the implementer must not silently redesign the plan. It must report the new truth and return control for canonical reconciliation by `completion-regrounder`.
- When that roadmap-level drift can be canonically reconciled without new user input or another unsafe external unblock step, keep `requires_reground = true`, set `next_mandatory_role = completion-regrounder`, and keep `continuation_policy = continue` so the workflow driver auto-dispatches re-grounding instead of stopping.
- During re-ground, evaluate each slice's `acceptance_criteria` against current repo truth and update `status` and `evidence` accordingly.
- A slice may only transition to `done` when every acceptance criterion is satisfied with proof in `evidence`.
- Run exactly one implementation slice at a time.
- A slice is not complete unless it lands as a new commit.
- Before selecting or advancing to the next slice after a committed slice, the tracked and unignored worktree must be clean. If it is not clean, treat that dirty state as a blocker to next-slice progression and reopen or continue the latest slice for reconciliation.
- When that dirty tracked worktree contains changes unrelated to the latest slice or current reconciliation surfaces and those changes can be isolated safely, auto-preserve them with a reversible mechanism such as a named git stash plus a `.agent/current/tmp/dirty-worktree-autostash.json` note, continue the mandatory workflow step, and restore them before handing control back. Ask the user only when overlap, ownership ambiguity, or stash/restore conflicts make automatic isolation unsafe.
- Docs, config, and runbooks must stay truthful to shipped behavior.
- `.agent/verify_completion_stop.sh` is a generated repo-level baseline verifier. Onboarding should create a working version from current repo truth rather than an unconditional failing placeholder.
- The packaged default stop policy is `required_stop_judges: 2` plus `stop_aggregation_policy: "unanimous-current-head-v1"` from package defaults.
- Under `unanimous-current-head-v1`, only current-HEAD `judgment` records from the current stop-wave epoch count. Canonical `state.json current_stop_wave_id` tracks that epoch, may be incremented to restart stop evaluation on the same `HEAD`, and repo-level stop verification must wait until the required current-HEAD judgments for the current epoch are recorded.
- Keep slice-specific proof in repo tests or deterministic checks. Refresh `.agent/verify_completion_stop.sh` only when the repo's top-level verification surfaces change or the verifier becomes stale.
- The workflow topology is flat and primary-driven: the main pi session remains the workflow root and invokes at most one completion role at a time.
- No completion role may invoke another completion role during the normal workflow.
- Completion is a sticky workflow. If canonical state says continuation is required, the workflow root must keep advancing through mandatory roles until canonical state switches to `await_user_input`, `blocked`, `paused`, or `done`.
- `continuation_policy == continue` means the workflow root must not stop after a slice or ask the user whether to continue. It must dispatch the next mandatory role directly.
- `continuation_policy == await_user_input` means the workflow root must ask only for the exact missing input and then stop.
- `continuation_policy == blocked` means the workflow root must report the blocker and stop.
- Reserve `continuation_policy == blocked` for cases where canonical reconciliation cannot proceed safely without user input, conflict resolution, ownership clarification, or another external unblock action. `requires_reground = true` by itself is not a stop condition.
- `continuation_policy == paused` means the user explicitly paused the workflow.
- `continuation_policy == done` means canonical final stop reconciliation is complete and the workflow may stop.
- `/cook park` is available anytime an active workflow exists, including while `continuation_policy = continue`, to record a parked paused posture with `requires_reground = true` and a cleared active-slice handoff before ordinary direct edits; resume still routes through canonical reground.
- When canonical state is stopped (`await_user_input`, `blocked`, or `paused`), rerun `/cook` or `/cook resume` to continue from canonical state, or use `/cook cancel` to close the workflow and disable stale hard locks / auto-resume.
- After canonical state reaches a closed `done` or `cancelled` posture, the extension may delete repo-local `.agent/` before control returns. Treat disappearance of `.agent/current/**` and `.agent/verify_completion_*.sh` after closure as expected cleanup, not as a missing tracked-file anomaly. Do not recreate local helper files merely to narrate final status.
- Use `completion-bootstrapper` only for first-time setup or missing local helper / canonical-state repair.
- Use `completion-regrounder` for canonical re-grounding, slice selection, post-review or post-audit reconciliation, and final stop reconciliation.
- Default scratch space for temporary files is repo-local `.agent/current/tmp/`.
- Do not write scratch artifacts to `/tmp` or `/private/tmp` by default.
- If a tool or platform behavior explicitly requires OS temp, prefer a scoped path such as `$TMPDIR/pi-completion/<repo-name>/` and treat it as disposable.
- Never keep canonical state, required verification evidence, or the only copy of a deliverable exclusively in temp paths.

## Primary Driver Contract

When `completion-protocol` is loaded by the main pi session, that session becomes the workflow driver only.

The workflow driver may:

- read current repo truth and canonical `.agent` state
- update canonical `.agent/**` state truthfully when needed for handoff
- choose which completion role to invoke next according to the mandatory dispatch table below
- summarize or compare role outputs for the user
- append canonical `.agent/current/slice-history.jsonl` records, but only as a faithful transcription of actual completion-role outputs
- append canonical `.agent/current/stop-check-history.jsonl` `judgment` records during the final stop wave, but only as a faithful transcription of actual `completion-stop-judge` outputs

The workflow driver must not, while completion is active and a slice is selected or in progress:

- directly edit non-`.agent/**` tracked product, docs, config, or test files for that slice
- directly create the slice commit
- directly mark a slice implemented, accepted, reopened, reviewed, audited, or judged without the corresponding role output
- bypass the completion roles for convenience
- hand control back to the user between slices merely to ask whether to continue when `continuation_policy == continue`

If the workflow driver detects that the next mandatory action belongs to a completion role, it must invoke that role rather than doing the slice work itself.

## Mandatory Dispatch Table

1. If repo-local `.agent/**` helper surfaces or canonical execution-state scaffolding are missing and truthful onboarding or repair is required, invoke `completion-bootstrapper`.
2. If canonical `.agent` execution state is missing, invalid, contradictory, stale, or ambiguous after compaction or recovery, invoke `completion-regrounder`.
3. If no slice is selected, invoke `completion-regrounder` to reconcile `.agent/current/plan.json` and return the next exact handoff payload.
4. If a slice is `selected` or `in_progress` and no new slice commit exists yet, invoke `completion-implementer`.
5. If the latest committed slice lacks a review result, invoke `completion-reviewer`.
6. If the latest committed slice lacks an audit result, invoke `completion-auditor`.
7. If review or audit have returned and canonical reconciliation is needed, invoke `completion-regrounder`. `completion-regrounder` must not select or hand off a next slice while the latest committed slice leaves the tracked and unignored worktree dirty; instead it must reopen or continue that latest slice for reconciliation.
8. If all planned slices are done and final closure is being evaluated, invoke the required `completion-stop-judge` sessions directly.
9. After each required current-HEAD `completion-stop-judge` result for the current `current_stop_wave_id` is faithfully recorded, rerun `bash .agent/verify_completion_stop.sh` and invoke `completion-regrounder` for final stop reconciliation.

The workflow driver must not substitute itself for any mandatory dispatch target above.

## Canonical Files

Local helper files:

- `.agent/verify_completion_stop.sh`
- `.agent/verify_completion_control_plane.sh`

These helper files are generated local convenience entrypoints, not tracked repo-contract files. After a workflow reaches a closed `done` or `cancelled` posture, extension cleanup may remove the entire `.agent/` directory as expected closeout behavior.

Ignored canonical execution-state files:

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

Optional context only:

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

Use repo-relative artifact paths only. Prefer concise field summaries plus the canonical artifact path over dumping raw command output into prompts or reports.

Run basis regression selectively for eligible bugfix or regression slices. Use `bash scripts/run-basis-regression-check.sh` to rerun a current-HEAD verification command in a disposable temp worktree at the locked `basis_commit`, and record the truthful result as `failed_on_basis`, `passed_on_basis`, `not_run`, or `not_applicable` together with `basis_regression_required` and `basis_regression_reason`. Do not treat `not_run` or `not_applicable` as implicit passes.

## Scratch Space

- Use `.agent/current/tmp/` for repo-local temporary files created during completion work.
- `.agent/current/tmp/` is scratch space only. Do not treat it as canonical state or durable handoff storage.
- Keep `.agent/current/tmp/` ignored in `.gitignore` alongside other non-contract `.agent/*` execution artifacts.
- Use OS temp only when a tool explicitly requires it, and prefer `$TMPDIR/pi-completion/<repo-name>/` over broad `/tmp` usage.

## Compaction And Recovery

Canonical truth remains in `.agent/**`.

After context compaction, suspected memory loss, stalled-role recovery, or any ambiguous completion state, the workflow driver must re-read:

- `.agent/current/state.json`
- `.agent/current/plan.json`
- `.agent/current/active-slice.json`
- `.agent/current/verification-evidence.json`

The workflow driver must invoke `completion-regrounder` before continuing whenever any of the following is true:

- `requires_reground` is `true`
- `requires_reground` is unknown because canonical state is missing or unreadable
- `next_mandatory_action` is missing, unknown, or ambiguous
- `active-slice.json` does not match `.agent/current/plan.json`
- acceptance criteria for the selected or active slice are missing or unclear
- the exact implementer handoff snapshot in `.agent/current/active-slice.json` is missing, stale, or contradictory

The exact implementer handoff now includes implementation-scope surfaces and expected verification commands in addition to the locked slice goal, acceptance, notes, and before-slice counters.

At workflow start, treat `.agent/current/startup-brief.json` as the confirmed intent anchor that regrounding must reconcile against current repo truth before selecting slices. Mission, scope, constraints, acceptance, risks, and notes there are workflow-level startup intent. Optional `*_hint` fields plus optional verifier-posture fields `verification_truth_mode`, `deterministic_verifier_ready`, `verification_latency`, `verification_noise_risk`, `verifier_gap`, and `recommended_first_slice_kind` are advisory startup input only, not a preselected active-slice contract. When deterministic verifier readiness is missing and repo truth does not expose a safer prerequisite, regrounding should prefer a `verifier_scaffolding` first slice.

The workflow driver must not continue implementation, review, audit, or stop evaluation from compacted conversation memory alone.

After compaction or recovery, `completion-implementer` must also re-read canonical `.agent/current/state.json`, `.agent/current/plan.json`, `.agent/current/active-slice.json`, and `.agent/current/verification-evidence.json` before resuming work. If `.agent/current/active-slice.json` still contains a truthful exact handoff snapshot, continue from canonical state rather than asking the user to resend the original caller payload.

## Shared Report Header

All completion reports must begin with:

- `MISSION ANCHOR: ...`
- `Remaining contract IDs: ...`

If a role-specific fixed format uses before/after wording, keep the same mission-anchor first line and then follow that role's exact format.

## Structured Evaluation Rubric Foundation

`completion-reviewer`, `completion-auditor`, and `completion-stop-judge` must emit rubric-backed evaluations using the same shared dimension names and verdict semantics.

The shared rubric foundation now sits alongside canonical `task_type` and `evaluation_profile` signaling in the control plane. That signaling is routing metadata only; later slices may still add stricter profile-aware rubric-output enforcement.

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

## References

For normal runtime loading, prefer the role-specific bundled runtime brief first. Read the fuller protocol reference only when that brief plus canonical `.agent/**` state still leave a detail ambiguous:

- `references/runtime-quick-driver.md`
- `references/runtime-quick-bootstrapper.md`
- `references/runtime-quick-regrounder.md`
- `references/runtime-quick-implementer.md`
- `references/runtime-quick-reviewer.md`
- `references/runtime-quick-auditor.md`
- `references/runtime-quick-stop-judge.md`
- `references/runtime-quick.md`
- `references/completion.md`
