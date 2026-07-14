import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import type { ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { normalizeCookHandoffCapsule, writeCookHandoffFile } from "./capsule.ts";
import {
	buildAskQuestionHandoffPayload,
	buildHandoffElicitationParams,
	confirmCookHandoff,
	formatConfirmationBrief,
} from "./confirmation.ts";

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
