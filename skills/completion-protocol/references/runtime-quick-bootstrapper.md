# completion runtime quick reference — bootstrapper

Use this as the default runtime brief for `completion-bootstrapper`.

Read the full `../SKILL.md` or `completion.md` only when this bootstrapper brief plus canonical `.agent/**` state still leave a protocol detail ambiguous.

## Canonical inputs

Read current repo truth plus these bootstrap surfaces as needed:

- package defaults for `task_type`, `evaluation_profile`, and stop policy
- `.agent/current/state.json`
- `.agent/current/plan.json`
- `.agent/current/active-slice.json`
- `.agent/current/startup-brief.json`

## Bootstrapper rules

- Repair or create local helper surfaces under `.agent/**` and `.gitignore` only.
- Preserve any existing truthful canonical execution state.
- Initialize missing or invalid canonical execution-state files only when repair is required for a truthful handoff.
- Do not edit tracked product, docs, config, or test files outside `.gitignore`.
- Do not create commits or append slice-history / stop-check records.
- Stop after truthful bootstrap or repair and hand off to `completion-regrounder`.
