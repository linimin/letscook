# completion runtime quick reference — stop judge

Use this as the default runtime brief for `completion-stop-judge`.

Read the full `../SKILL.md` or `completion.md` only when this stop-judge brief plus canonical `.agent/**` state still leave a protocol detail ambiguous.

## Stop-judge rules

- Stay read-only: no tracked edits, no canonical state writes, no commits.
- Judge current HEAD truth only.
- Ground the decision in canonical active-slice truth, `evaluation_profile`, verification evidence, and `.agent/current/plan.json` / `.agent/current/state.json` stop-wave state.
- The workflow driver records the verdict into `.agent/current/stop-check-history.jsonl` for the current `.agent/current/state.json current_stop_wave_id` epoch.
- You may return `Can the project stop now: yes` only when plan truth, docs parity, verification evidence, clean worktree, and open-gap counts all support current-HEAD closure.
- `bash .agent/verify_completion_stop.sh` may still be pending only because the current wave's required current-HEAD judgment records are not yet present; any other verifier failure is `no`.
- Always emit the shared rubric section with all four dimensions.
- Any rubric `fail` means `Can the project stop now: no`.
