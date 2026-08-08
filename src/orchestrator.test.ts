import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { normalizeCookHandoffCapsule, validateCookHandoffSchema } from "./handoff/capsule.ts";
import {
	claimWorkflowDispatch,
	cancelWorkflow,
	getWorkflowDispatch,
	parkWorkflow,
	resumeWorkflow,
	submitRoleResult,
} from "./orchestrator/dispatch.ts";
import { buildDispatchKeyForContext } from "./orchestrator/dispatch-key.ts";
import { scaffoldWorkflowFromHandoff, updateWorkflowState } from "./control-plane/state.ts";
import { cleanupClosedWorkflow } from "./control-plane/cleanup.ts";
import type { WorkflowDispatch, WorkflowSnapshot } from "./types.ts";

function git(cwd: string, ...args: string[]) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
	}
	return result.stdout.trim();
}

async function makeGitWorkflowRoot(): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-test-"));
	git(root, "init");
	git(root, "config", "user.email", "test@example.com");
	git(root, "config", "user.name", "Test User");
	await writeFile(path.join(root, "README.md"), "# test\n", "utf8");
	git(root, "add", "README.md");
	git(root, "commit", "-m", "init");
	return root;
}

async function scaffoldTestWorkflow(root: string) {
	const capsule = normalizeCookHandoffCapsule({
		mission: "Add login redirect handling and tests",
		scope: ["src/auth/"],
		acceptance: ["redirect tests pass"],
	});
	await scaffoldWorkflowFromHandoff(root, capsule, "test-project");
}

function dispatchKeyFromClaim(claim: Awaited<ReturnType<typeof claimWorkflowDispatch>>): string {
	const key = claim.dispatch_key;
	assert.equal(typeof key, "string");
	return key as string;
}

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
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		const dispatch = await getWorkflowDispatch(root);
		assert.equal(dispatch.dispatch_allowed, true);
		assert.equal(dispatch.driver_continue, false);
		assert.equal(dispatch.claim_required, true);
		assert.equal(dispatch.role, "completion-regrounder");
		assert.equal(dispatch.claim_required, true);
		assert.ok(dispatch.dispatch_key);
		const claim = await claimWorkflowDispatch({ workspace_root: root });
		const claimedDispatch = claim.dispatch as WorkflowDispatch;
		assert.equal(claimedDispatch.dispatch_allowed, true);
		assert.equal(claimedDispatch.reason, "dispatch_claimed");
		assert.equal(claimedDispatch.dispatch_key, claim.dispatch_key);
		const submitted = await submitRoleResult({
			workspace_root: root,
			role: "completion-regrounder",
			raw_output: "role: completion-regrounder\nverdict: ok\nsummary: selected slice auth-redirect",
			dispatch_key: dispatchKeyFromClaim(claim),
		});
		assert.equal(submitted.ok, true);
		assert.equal(submitted.next_mandatory_role, "completion-implementer");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("claim blocks duplicate dispatch for same dispatch key", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		const claim1 = await claimWorkflowDispatch({ workspace_root: root });
		assert.equal(claim1.ok, true);
		assert.equal(claim1.reason, "dispatch_claimed");

		const dispatch = await getWorkflowDispatch(root);
		assert.equal(dispatch.dispatch_allowed, false);
		assert.equal(dispatch.reason, "role_in_flight");

		const claim2 = await claimWorkflowDispatch({ workspace_root: root });
		assert.equal(claim2.ok, false);
		assert.equal(claim2.reason, "role_in_flight");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("submit clears in-flight and allows next claim", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		const claim = await claimWorkflowDispatch({ workspace_root: root });
		await submitRoleResult({
			workspace_root: root,
			role: "completion-regrounder",
			raw_output: "role: completion-regrounder\nverdict: ok\nsummary: selected slice auth-redirect",
			dispatch_key: dispatchKeyFromClaim(claim),
		});

		const dispatch = await getWorkflowDispatch(root);
		assert.equal(dispatch.role, "completion-implementer");
		assert.equal(dispatch.dispatch_allowed, true);

		const nextClaim = await claimWorkflowDispatch({ workspace_root: root });
		assert.equal(nextClaim.ok, true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("submit without claim is rejected", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		await assert.rejects(
			() =>
				submitRoleResult({
					workspace_root: root,
					role: "completion-regrounder",
					raw_output: "role: completion-regrounder\nverdict: ok\nsummary: noop",
				}),
			/dispatch not claimed/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("failed submit keeps dispatch in-flight", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		const claim = await claimWorkflowDispatch({ workspace_root: root });
		await assert.rejects(
			() =>
				submitRoleResult({
					workspace_root: root,
					role: "completion-regrounder",
					raw_output: "too short",
					dispatch_key: dispatchKeyFromClaim(claim),
				}),
			/transcription|too short/,
		);
		const dispatch = await getWorkflowDispatch(root);
		assert.equal(dispatch.reason, "role_in_flight");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("non-implementer in-flight survives head drift on preflight", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		await claimWorkflowDispatch({ workspace_root: root });
		await writeFile(path.join(root, "head-drift.txt"), "drift\n", "utf8");
		git(root, "add", "head-drift.txt");
		git(root, "commit", "-m", "external head drift");
		const dispatch = await getWorkflowDispatch(root);
		assert.equal(dispatch.reason, "role_in_flight");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("stop-judge dispatch keys use profile required_stop_judges", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		const { loadWorkflowSnapshot } = await import("./control-plane/state.ts");
		const snapshot = await loadWorkflowSnapshot(root);
		assert(snapshot);
		assert.equal(snapshot.profile.required_stop_judges, 2);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("stop-judge dispatch keys differ per remaining judge slot", () => {
	const snapshot = {
		state: { current_stop_wave_id: 1, remaining_stop_judges: 2 },
		profile: { required_stop_judges: 2 },
	} as unknown as WorkflowSnapshot;
	const first = buildDispatchKeyForContext("completion-stop-judge", null, "abc123", snapshot);
	const afterFirst = buildDispatchKeyForContext(
		"completion-stop-judge",
		null,
		"abc123",
		{
			...snapshot,
			state: { ...snapshot.state, remaining_stop_judges: 1 },
		} as unknown as WorkflowSnapshot,
	);
	assert.notEqual(first, afterFirst);
});

test("force reclaim clears stale non-implementer in-flight without head drift is rejected", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		await claimWorkflowDispatch({ workspace_root: root });
		const reclaimed = await claimWorkflowDispatch({ workspace_root: root, force: true });
		assert.equal(reclaimed.ok, false);
		assert.equal(reclaimed.reason, "force_redispatch_not_allowed");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("force reclaim clears stale non-implementer in-flight after head drift", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		await claimWorkflowDispatch({ workspace_root: root });
		await writeFile(path.join(root, "head-drift.txt"), "drift\n", "utf8");
		git(root, "add", "head-drift.txt");
		git(root, "commit", "-m", "external head drift");
		const reclaimed = await claimWorkflowDispatch({ workspace_root: root, force: true });
		assert.equal(reclaimed.ok, true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("stale submit rejected after force reclaim", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		const first = await claimWorkflowDispatch({ workspace_root: root });
		const staleKey = dispatchKeyFromClaim(first);
		await writeFile(path.join(root, "head-drift.txt"), "drift\n", "utf8");
		git(root, "add", "head-drift.txt");
		git(root, "commit", "-m", "external head drift");
		await claimWorkflowDispatch({ workspace_root: root, force: true });
		await assert.rejects(
			() =>
				submitRoleResult({
					workspace_root: root,
					role: "completion-regrounder",
					raw_output: "role: completion-regrounder\nverdict: ok\nsummary: stale output",
					dispatch_key: staleKey,
				}),
			/dispatch_key mismatch/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("non-implementer submit survives head change while in-flight", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		const claim = await claimWorkflowDispatch({ workspace_root: root });
		const dispatchKey = dispatchKeyFromClaim(claim);
		await writeFile(path.join(root, "head-drift.txt"), "drift\n", "utf8");
		git(root, "add", "head-drift.txt");
		git(root, "commit", "-m", "background head drift");
		const submitted = await submitRoleResult({
			workspace_root: root,
			role: "completion-regrounder",
			raw_output: "role: completion-regrounder\nverdict: ok\nsummary: selected slice auth-redirect",
			dispatch_key: dispatchKey,
		});
		assert.equal(submitted.ok, true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("implementer in-flight survives head change before submit", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		const regrounderClaim = await claimWorkflowDispatch({ workspace_root: root });
		await submitRoleResult({
			workspace_root: root,
			role: "completion-regrounder",
			raw_output: "role: completion-regrounder\nverdict: ok\nsummary: selected slice auth-redirect",
			dispatch_key: dispatchKeyFromClaim(regrounderClaim),
		});
		await claimWorkflowDispatch({ workspace_root: root });
		await writeFile(path.join(root, "slice.txt"), "work\n", "utf8");
		git(root, "add", "slice.txt");
		git(root, "commit", "-m", "slice work");
		const dispatch = await getWorkflowDispatch(root);
		assert.equal(dispatch.reason, "role_in_flight");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("park rejects while dispatch is in flight", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		await claimWorkflowDispatch({ workspace_root: root });
		await assert.rejects(() => parkWorkflow(root), /dispatch_in_flight/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("cancel rejects while dispatch is in flight", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		await claimWorkflowDispatch({ workspace_root: root });
		await assert.rejects(() => cancelWorkflow(root), /dispatch_in_flight/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("cancel closes workflow and removes the entire .agent directory", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		const cancelled = await cancelWorkflow(root, "test cancellation");
		assert.equal(cancelled.workflow_closed, true);
		assert.deepEqual(cancelled.cleanup, {
			attempted: true,
			removed: true,
			path: path.join(root, ".agent"),
		});
		assert.equal(existsSync(path.join(root, ".agent")), false);
		const dispatch = await getWorkflowDispatch(root);
		assert.equal(dispatch.reason, "no_active_workflow");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("terminal role submission returns a closure receipt before removing .agent", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		const claim = await claimWorkflowDispatch({ workspace_root: root });
		await updateWorkflowState(root, {
			workflow_entry_status: "done",
			continuation_policy: "done",
			project_done: true,
			next_mandatory_role: null,
		});
		const submitted = await submitRoleResult({
			workspace_root: root,
			role: "completion-regrounder",
			raw_output: "role: completion-regrounder\nverdict: ok\nsummary: final reconciliation complete",
			dispatch_key: dispatchKeyFromClaim(claim),
		});
		assert.equal(submitted.workflow_closed, true);
		assert.equal((submitted.cleanup as { removed?: boolean }).removed, true);
		assert.equal((submitted.closure as { status?: string }).status, "done");
		assert.equal(existsSync(path.join(root, ".agent")), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("cleanup fails closed for an unrelated .agent directory", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await mkdir(path.join(root, ".agent", "current"), { recursive: true });
		await writeFile(
			path.join(root, ".agent", "current", "state.json"),
			JSON.stringify({
				workflow_entry_status: "done",
				continuation_policy: "done",
				project_done: true,
				orchestrator: "another-tool",
			}),
			"utf8",
		);
		await writeFile(
			path.join(root, ".agent", "profile.json"),
			JSON.stringify({ protocol_id: "another-protocol" }),
			"utf8",
		);
		const cleanup = await cleanupClosedWorkflow(root);
		assert.equal(cleanup.removed, false);
		assert.equal(cleanup.reason, "agent_directory_not_owned_by_completion_protocol");
		assert.equal(existsSync(path.join(root, ".agent")), true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("resume rejects while dispatch is in flight", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		await claimWorkflowDispatch({ workspace_root: root });
		await assert.rejects(() => resumeWorkflow(root), /dispatch_in_flight/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("implementer force reclaim allowed for stall recovery on same slice and head", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		const regrounderClaim = await claimWorkflowDispatch({ workspace_root: root });
		await submitRoleResult({
			workspace_root: root,
			role: "completion-regrounder",
			raw_output: "role: completion-regrounder\nverdict: ok\nsummary: selected slice auth-redirect",
			dispatch_key: dispatchKeyFromClaim(regrounderClaim),
		});
		const firstClaim = await claimWorkflowDispatch({ workspace_root: root });
		const reclaimed = await claimWorkflowDispatch({ workspace_root: root, force: true });
		assert.equal(reclaimed.ok, true);
		assert.notEqual(dispatchKeyFromClaim(reclaimed), dispatchKeyFromClaim(firstClaim));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("implementer force reclaim rejected after head changes without submit", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		const regrounderClaim = await claimWorkflowDispatch({ workspace_root: root });
		await submitRoleResult({
			workspace_root: root,
			role: "completion-regrounder",
			raw_output: "role: completion-regrounder\nverdict: ok\nsummary: selected slice auth-redirect",
			dispatch_key: dispatchKeyFromClaim(regrounderClaim),
		});
		await claimWorkflowDispatch({ workspace_root: root });
		await writeFile(path.join(root, "slice.txt"), "work\n", "utf8");
		git(root, "add", "slice.txt");
		git(root, "commit", "-m", "slice work");
		const reclaimed = await claimWorkflowDispatch({ workspace_root: root, force: true });
		assert.equal(reclaimed.ok, false);
		assert.equal(reclaimed.reason, "force_redispatch_not_allowed");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("implementer submit accepts head change after slice commit", async () => {
	const root = await makeGitWorkflowRoot();
	try {
		await scaffoldTestWorkflow(root);
		const regrounderClaim = await claimWorkflowDispatch({ workspace_root: root });
		await submitRoleResult({
			workspace_root: root,
			role: "completion-regrounder",
			raw_output: "role: completion-regrounder\nverdict: ok\nsummary: selected slice auth-redirect",
			dispatch_key: dispatchKeyFromClaim(regrounderClaim),
		});
		const implementerClaim = await claimWorkflowDispatch({ workspace_root: root });
		await writeFile(path.join(root, "slice.txt"), "work\n", "utf8");
		git(root, "add", "slice.txt");
		git(root, "commit", "-m", "slice work");
		const submitted = await submitRoleResult({
			workspace_root: root,
			role: "completion-implementer",
			raw_output: "role: completion-implementer\nverdict: ok\nsummary: implemented slice with commit",
			dispatch_key: dispatchKeyFromClaim(implementerClaim),
		});
		assert.equal(submitted.ok, true);
		const dispatch = await getWorkflowDispatch(root);
		assert.notEqual(dispatch.reason, "role_in_flight");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
