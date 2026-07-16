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
		assert.equal(result.action, "start");
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
