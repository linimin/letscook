import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { normalizeCookHandoffCapsule, validateCookHandoffSchema } from "./handoff/capsule.ts";
import { getWorkflowDispatch, submitRoleResult } from "./orchestrator/dispatch.ts";
import { scaffoldWorkflowFromHandoff } from "./control-plane/state.ts";

test("handoff schema validates minimal capsule", () => {
	const capsule = normalizeCookHandoffCapsule({
		mission: "Add login redirect handling and tests",
		scope: ["src/auth/"],
		acceptance: ["redirect tests pass"],
	});
	const result = validateCookHandoffSchema(capsule);
	assert.equal(result.ok, true);
});

test("workflow scaffold and dispatch regrounder first", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-test-"));
	try {
		const capsule = normalizeCookHandoffCapsule({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		await scaffoldWorkflowFromHandoff(root, capsule, "test-project");
		const dispatch = await getWorkflowDispatch(root);
		assert.equal(dispatch.dispatch_allowed, true);
		assert.equal(dispatch.role, "completion-regrounder");
		const submitted = await submitRoleResult({
			workspace_root: root,
			role: "completion-regrounder",
			raw_output: "role: completion-regrounder\nverdict: ok\nsummary: selected slice auth-redirect",
		});
		assert.equal(submitted.ok, true);
		assert.equal(submitted.next_mandatory_role, "completion-implementer");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
