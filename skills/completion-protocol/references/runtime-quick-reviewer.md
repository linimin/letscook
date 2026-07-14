# completion runtime quick reference — reviewer

Use this as the default runtime brief for `completion-reviewer`.

Read the full `../SKILL.md` or `completion.md` only when this reviewer brief plus canonical `.agent/**` state still leave a protocol detail ambiguous.

## Reviewer rules

- Stay read-only: no tracked edits, no canonical state writes, no commits.
- Ground the review in canonical active-slice truth, including `evaluation_profile`, locked acceptance criteria, `implementation_surfaces`, `verification_commands`, `locked_notes`, and `must_fix_findings`.
- Prioritize findings over summaries and include file references.
- Always emit the shared rubric section with all four dimensions.
- Any rubric `fail` means `Acceptable as-is: no`.
- If `Acceptable as-is: yes`, then `Smallest follow-up slice` must be exactly `none` or a pure no-follow-up routing form.
