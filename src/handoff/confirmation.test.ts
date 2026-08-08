import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import type { ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { normalizeCookHandoffCapsule, readCookHandoffSidecar, writeCookHandoffFile } from "./capsule.ts";
import {
	buildAskQuestionHandoffPayload,
	buildHandoffElicitationParams,
	buildIsolationConfirmationSection,
	confirmCookHandoff,
	formatConfirmationBrief,
} from "./confirmation.ts";
import { updateWorkflowState } from "../control-plane/state.ts";
import { startCookWorkflowFromHandoff } from "./start-workflow.ts";
import { getCookWorkspaceContext } from "../worktree.ts";

function runGit(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
}

async function initGitRepo(root: string): Promise<void> {
	runGit(root, ["init"]);
	runGit(root, ["config", "user.email", "test@example.com"]);
	runGit(root, ["config", "user.name", "Test User"]);
	runGit(root, ["commit", "--allow-empty", "-m", "init"]);
}

test("formatConfirmationBrief includes mission and acceptance", () => {
	const brief = formatConfirmationBrief({
		mission: "Add login redirect handling",
		scope: ["src/auth/"],
		constraints: ["Keep changes minimal"],
		acceptance: ["redirect tests pass"],
	});
	assert.match(brief, /Add login redirect handling/);
	assert.match(brief, /redirect tests pass/);
});

test("buildHandoffElicitationParams includes start/cancel/edit choices", () => {
	const params = buildHandoffElicitationParams({ mission: "Ship feature X", scope: ["src/"], acceptance: ["tests pass"] });
	assert.equal(params.mode, "form");
	const action = params.requestedSchema.properties.action as { enum?: string[] };
	assert.deepEqual(action.enum, ["start", "cancel", "edit"]);
});

test("buildHandoffElicitationParams includes main-checkout isolation choices", () => {
	const params = buildHandoffElicitationParams(
		{ mission: "Ship feature X", scope: ["src/"], acceptance: ["tests pass"] },
		{ isolationConfirmRequired: true },
	);
	const action = params.requestedSchema.properties.action as { enum?: string[] };
	assert.deepEqual(action.enum, ["start_on_main", "defer_worktree", "cancel", "edit"]);
});

test("buildIsolationConfirmationSection warns about main checkout", () => {
	const section = buildIsolationConfirmationSection(
		getCookWorkspaceContext({ workspaceRoot: "/tmp/example" }),
	);
	assert.match(section, /main checkout/i);
	assert.match(section, /apply-worktree/i);
});

test("confirmCookHandoff returns AskQuestion fallback when elicitation unavailable", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-confirm-"));
	try {
		const capsule = normalizeCookHandoffCapsule({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		await writeCookHandoffFile(root, capsule, { workspace_root: root });
		const result = await confirmCookHandoff(root, {}, { skip_elicitation: true });
		assert.equal(result.ok, true);
		assert.equal(result.elicitation_unavailable, true);
		assert.equal(result.user_action_required, "ask_question");
		const askQuestion = buildAskQuestionHandoffPayload({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		assert.equal(askQuestion.questions[0]?.options[0]?.id, "start");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("confirmCookHandoff starts workflow after MCP elicitation accept", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-confirm-"));
	try {
		await initGitRepo(root);
		const capsule = normalizeCookHandoffCapsule({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		await writeCookHandoffFile(root, capsule, { workspace_root: root });
		const result = await confirmCookHandoff(root, {
			getClientCapabilities: () => ({ elicitation: { form: {} } }),
			elicitInput: async () =>
				({
					action: "accept",
					content: { action: "start" },
				}) as ElicitResult,
		});
		assert.equal(result.ok, true);
		assert.equal(result.confirmed, true);
		assert.equal(result.confirmation_method, "mcp_elicitation");
		assert.ok(result.action === "start" || result.action === "start_on_main");
		assert.match(String((result.dispatch as { role?: string })?.role ?? ""), /completion-/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("confirmCookHandoff cancels pending handoff after MCP elicitation cancel", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-confirm-"));
	try {
		const capsule = normalizeCookHandoffCapsule({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		await writeCookHandoffFile(root, capsule, { workspace_root: root });
		const result = await confirmCookHandoff(root, {
			getClientCapabilities: () => ({ elicitation: { form: {} } }),
			elicitInput: async () => ({ action: "cancel" }) as ElicitResult,
		});
		assert.equal(result.ok, true);
		assert.equal(result.confirmed, false);
		assert.equal(result.action, "cancel");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("confirmCookHandoff defers to worktree on main checkout", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-confirm-main-"));
	try {
		await initGitRepo(root);
		const capsule = normalizeCookHandoffCapsule({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		await writeCookHandoffFile(root, capsule, { workspace_root: root });
		const result = await confirmCookHandoff(root, {
			getClientCapabilities: () => ({ elicitation: { form: {} } }),
			elicitInput: async () =>
				({
					action: "accept",
					content: { action: "defer_worktree" },
				}) as ElicitResult,
		});
		assert.equal(result.ok, true);
		assert.equal(result.confirmed, false);
		assert.equal(result.action, "defer_worktree");
		assert.equal(result.user_action_required, "run_worktree_first");
		assert.equal(await readCookHandoffSidecar(root), undefined);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("confirmCookHandoff defaults missing elicitation action to defer on main checkout", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-confirm-main-default-"));
	try {
		await initGitRepo(root);
		const capsule = normalizeCookHandoffCapsule({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		await writeCookHandoffFile(root, capsule, { workspace_root: root });
		const result = await confirmCookHandoff(root, {
			getClientCapabilities: () => ({ elicitation: { form: {} } }),
			elicitInput: async () =>
				({
					action: "accept",
					content: {},
				}) as ElicitResult,
		});
		assert.equal(result.ok, true);
		assert.equal(result.confirmed, false);
		assert.equal(result.action, "defer_worktree");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("AskQuestion start path confirms before start_cook_workflow", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-confirm-ask-start-"));
	try {
		await initGitRepo(root);
		const capsule = normalizeCookHandoffCapsule({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		const { confirmationId } = await writeCookHandoffFile(root, capsule, { workspace_root: root });
		const fallback = await confirmCookHandoff(root, {}, { skip_elicitation: true });
		assert.equal(fallback.user_action_required, "ask_question");
		assert.match(
			String((fallback.next_steps as string[] | undefined)?.[1] ?? ""),
			/confirmation_action: 'start'/,
		);

		const confirmed = await confirmCookHandoff(root, {}, {
			skip_elicitation: true,
			confirmation_action: "start",
		});
		assert.equal(confirmed.confirmed, true);

		const started = await startCookWorkflowFromHandoff(root, confirmationId);
		assert.match(String(started.dispatch.role ?? ""), /completion-/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("confirmCookHandoff allows deferred start after workflow is done", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-confirm-done-"));
	try {
		await initGitRepo(root);
		const capsule = normalizeCookHandoffCapsule({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		await writeCookHandoffFile(root, capsule, { workspace_root: root });
		await confirmCookHandoff(root, {
			getClientCapabilities: () => ({ elicitation: { form: {} } }),
			elicitInput: async () =>
				({
					action: "accept",
					content: { action: "start" },
				}) as ElicitResult,
		});
		await updateWorkflowState(root, {
			project_done: true,
			continuation_policy: "done",
			workflow_entry_status: "done",
		});
		await writeCookHandoffFile(root, capsule, { workspace_root: root });
		const confirmed = await confirmCookHandoff(root, {}, {
			skip_elicitation: true,
			confirmation_action: "start",
		});
		assert.equal(confirmed.confirmed, true);
		assert.notEqual(confirmed.workflow_already_active, true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("confirmCookHandoff does not rescaffold an active workflow", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-confirm-active-"));
	try {
		await initGitRepo(root);
		const capsule = normalizeCookHandoffCapsule({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		await writeCookHandoffFile(root, capsule, { workspace_root: root });
		await confirmCookHandoff(root, {
			getClientCapabilities: () => ({ elicitation: { form: {} } }),
			elicitInput: async () =>
				({
					action: "accept",
					content: { action: "start" },
				}) as ElicitResult,
		});
		const again = await confirmCookHandoff(root, {}, {
			skip_elicitation: true,
			confirmation_action: "start",
		});
		assert.equal(again.workflow_already_active, true);
		assert.notEqual(again.confirmed, true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("confirmCookHandoff accepts start_on_main confirmation_action alias", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-confirm-main-alias-"));
	try {
		await initGitRepo(root);
		const capsule = normalizeCookHandoffCapsule({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		await writeCookHandoffFile(root, capsule, { workspace_root: root });
		const result = await confirmCookHandoff(root, {}, {
			skip_elicitation: true,
			confirmation_action: "start_on_main",
		});
		assert.equal(result.confirmed, true);
		assert.equal(result.action, "start_on_main");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("confirmCookHandoff records confirmation for deferred start_cook_workflow", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-confirm-deferred-start-"));
	try {
		await initGitRepo(root);
		const capsule = normalizeCookHandoffCapsule({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		const { confirmationId } = await writeCookHandoffFile(root, capsule, { workspace_root: root });
		const confirmed = await confirmCookHandoff(root, {}, {
			skip_elicitation: true,
			confirmation_action: "start",
		});
		assert.equal(confirmed.confirmed, true);
		const sidecar = await readCookHandoffSidecar(root);
		assert.equal(sidecar?.status, "confirmed");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("confirmCookHandoff rejects start when workspace has no git commits", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-confirm-no-head-"));
	try {
		runGit(root, ["init"]);
		runGit(root, ["config", "user.email", "test@example.com"]);
		runGit(root, ["config", "user.name", "Test User"]);
		const capsule = normalizeCookHandoffCapsule({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		await writeCookHandoffFile(root, capsule, { workspace_root: root });
		const result = await confirmCookHandoff(root, {}, {
			skip_elicitation: true,
			confirmation_action: "start",
		});
		assert.equal(result.ok, false);
		assert.equal(result.code, "workspace_not_ready");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("confirmCookHandoff starts on main with isolation audit record", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-confirm-main-start-"));
	try {
		await initGitRepo(root);
		const capsule = normalizeCookHandoffCapsule({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		await writeCookHandoffFile(root, capsule, { workspace_root: root });
		const result = await confirmCookHandoff(root, {
			getClientCapabilities: () => ({ elicitation: { form: {} } }),
			elicitInput: async () =>
				({
					action: "accept",
					content: { action: "start_on_main" },
				}) as ElicitResult,
		});
		assert.equal(result.ok, true);
		assert.equal(result.confirmed, true);
		assert.equal(result.action, "start_on_main");
		const startupBrief = JSON.parse(
			await readFile(path.join(root, ".agent/current/startup-brief.json"), "utf8"),
		) as { isolation_choice?: string };
		assert.equal(startupBrief.isolation_choice, "main_checkout_acknowledged");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("confirmCookHandoff warns when starting against a parked workflow", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-confirm-parked-"));
	try {
		await initGitRepo(root);
		const capsule = normalizeCookHandoffCapsule({
			mission: "Add login redirect handling and tests",
			scope: ["src/auth/"],
			acceptance: ["redirect tests pass"],
		});
		await writeCookHandoffFile(root, capsule, { workspace_root: root });
		await confirmCookHandoff(root, {
			getClientCapabilities: () => ({ elicitation: { form: {} } }),
			elicitInput: async () =>
				({
					action: "accept",
					content: { action: "start" },
				}) as ElicitResult,
		});
		await updateWorkflowState(root, {
			workflow_entry_status: "parked",
			continuation_policy: "paused",
		});
		const { confirmationId } = await writeCookHandoffFile(root, capsule, { workspace_root: root });
		const confirmed = await confirmCookHandoff(root, {}, {
			skip_elicitation: true,
			confirmation_action: "start",
		});
		assert.equal(confirmed.confirmed, false);
		assert.equal(confirmed.workflow_parked, true);
		await assert.rejects(
			() => startCookWorkflowFromHandoff(root, confirmationId),
			/handoff not confirmed/i,
		);
		await updateWorkflowState(root, {
			workflow_entry_status: "active",
			continuation_policy: "continue",
		});
		await assert.rejects(
			() => startCookWorkflowFromHandoff(root, confirmationId),
			/handoff not confirmed/i,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
