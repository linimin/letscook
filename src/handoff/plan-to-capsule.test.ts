import assert from "node:assert/strict";
import { test } from "node:test";
import {
	parseCursorPlanFile,
	planToCookHandoffDraft,
	rankCursorPlans,
	resolveCursorPlan,
	scorePlanAgainstHint,
	suggestCookSlugFromPlan,
} from "./plan-to-capsule.ts";
import { validateCookHandoffSchema } from "./capsule.ts";
import { asStringArray } from "../control-plane/state.ts";

const SAMPLE_PLAN = `---
name: Auth Redirect Fix
overview: Add login redirect handling with focused tests in auth module
todos:
  - id: a1b2c3d4-0001-4000-8000-000000000001
    content: Update src/auth/redirect.ts to preserve return URL
    status: pending
  - id: a1b2c3d4-0001-4000-8000-000000000002
    content: Add tests/auth/redirect.test.ts coverage
    status: pending
isProject: false
---

## Scope

- \`src/auth/\`
- \`tests/auth/\`

## Acceptance

- Redirect tests pass
- Existing login flow unchanged

## Risks

- Edge cases when return URL is external
`;

test("parseCursorPlanFile reads frontmatter and body", () => {
	const plan = parseCursorPlanFile(SAMPLE_PLAN, "/tmp/auth.plan.md");
	assert.equal(plan.name, "Auth Redirect Fix");
	assert.equal(plan.overview, "Add login redirect handling with focused tests in auth module");
	assert.equal(plan.todos.length, 2);
	assert.match(plan.body, /## Scope/);
});

test("planToCookHandoffDraft maps plan into startable capsule", () => {
	const plan = parseCursorPlanFile(SAMPLE_PLAN, "/tmp/auth.plan.md");
	const draft = planToCookHandoffDraft(plan);
	const schema = validateCookHandoffSchema(draft.capsule);
	assert.equal(schema.ok, true);
	assert.equal(draft.capsule.source, "primary_agent");
	assert.ok(asStringArray(draft.capsule.scope).includes("src/auth/"));
	assert.ok(asStringArray(draft.capsule.acceptance).some((item: string) => /redirect tests pass/i.test(item)));
	assert.equal(draft.gaps.length, 0);
});

test("suggestCookSlugFromPlan slugifies plan title", () => {
	const plan = parseCursorPlanFile(SAMPLE_PLAN, "/tmp/auth.plan.md");
	const suggestion = suggestCookSlugFromPlan(plan);
	assert.equal(suggestion.slug, "auth-redirect-fix");
	assert.equal(suggestion.branch, "cook/auth-redirect-fix");
});

test("plan_hint ranks matching plan above unrelated plan", () => {
	const authPlan = {
		path: "/repo/.cursor/plans/auth-redirect-fix.plan.md",
		name: "Auth Redirect Fix",
		overview: "Add login redirect handling with focused tests in auth module",
		modified_at: "2026-07-10T00:00:00.000Z",
		todo_total: 2,
		todo_pending: 2,
		is_project: false,
	};
	const apiPlan = {
		path: "/repo/.cursor/plans/api-refactor.plan.md",
		name: "API Refactor",
		overview: "Restructure public REST handlers",
		modified_at: "2026-07-14T00:00:00.000Z",
		todo_total: 4,
		todo_pending: 4,
		is_project: false,
	};
	const ranked = rankCursorPlans([apiPlan, authPlan], "login redirect auth module");
	assert.equal(ranked[0]?.name, "Auth Redirect Fix");
	const resolution = resolveCursorPlan({
		plans: [apiPlan, authPlan],
		planHint: "login redirect auth module",
	});
	assert.equal(resolution.status, "resolved");
	if (resolution.status === "resolved") {
		assert.equal(resolution.method, "plan_hint");
		assert.match(resolution.path, /auth-redirect-fix/);
	}
});

test("ambiguous plan_hint requires disambiguation", () => {
	const plans = [
		{
			path: "/repo/.cursor/plans/auth-login.plan.md",
			name: "Auth Login",
			overview: "Improve login form validation",
			modified_at: "2026-07-14T00:00:00.000Z",
			todo_total: 1,
			todo_pending: 1,
			is_project: false,
		},
		{
			path: "/repo/.cursor/plans/auth-redirect.plan.md",
			name: "Auth Redirect",
			overview: "Improve login redirect handling",
			modified_at: "2026-07-13T00:00:00.000Z",
			todo_total: 1,
			todo_pending: 1,
			is_project: false,
		},
	];
	const resolution = resolveCursorPlan({ plans, planHint: "auth" });
	assert.equal(resolution.status, "needs_disambiguation");
});

test("scorePlanAgainstHint matches plan title tokens", () => {
	const scored = scorePlanAgainstHint(
		{
			path: "/repo/.cursor/plans/auth-redirect-fix.plan.md",
			name: "Auth Redirect Fix",
			overview: "Add login redirect handling",
			modified_at: "2026-07-10T00:00:00.000Z",
			todo_total: 0,
			todo_pending: 0,
			is_project: false,
		},
		"redirect fix",
	);
	assert.ok(scored.score >= 6);
});
