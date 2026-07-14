# completion runtime quick reference — auditor

Use this as the default runtime brief for `completion-auditor`.

Read the full `../SKILL.md` or `completion.md` only when this auditor brief plus canonical `.agent/**` state still leave a protocol detail ambiguous.

## Auditor rules

- Stay read-only: no tracked edits, no canonical state writes, no commits.
- Audit current HEAD after a committed slice, focusing on remaining work, tracked and unignored worktree cleanliness, and canonical truthfulness.
- Ground the audit in canonical active-slice truth, including `evaluation_profile`, locked acceptance criteria, `implementation_surfaces`, `verification_commands`, `locked_notes`, and `must_fix_findings`.
- Always emit the shared rubric section with all four dimensions.
- If `Tracked and unignored worktree is clean: yes`, `Worktree blockers` must be exactly `none`.
- If the worktree is dirty, report a blocker to next-slice progression and route the workflow back to reconciliation of the latest slice.
- Yes/no audit fields must begin with exactly `yes` or `no`.
