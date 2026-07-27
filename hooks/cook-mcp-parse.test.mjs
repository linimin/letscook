import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
	conversationIdsForStickyLookup,
	normalizeSticky,
	readStickyForHook,
	resolveStickyConversationId,
	resolveSubagentSubmitContext,
	resolveStopStickyContext,
} from "./cook-mcp-parse.mjs";

const hookScript = fileURLToPath(new URL("./cook-mcp-parse.mjs", import.meta.url));

function runHook(mode, input, env = {}) {
	return spawnSync(process.execPath, [hookScript, mode], {
		input: JSON.stringify(input),
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
}

test("post claim emits dispatch nudge", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-hook-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	try {
		const result = runHook(
			"post",
			{
				tool_name: "claim_workflow_dispatch",
				conversation_id: "parent-1",
				tool_output: JSON.stringify({
					ok: true,
					dispatch: {
						workspace_root: dir,
						role: "completion-implementer",
						continuation_policy: "continue",
						dispatch_key: "key-1",
					},
				}),
			},
			{ LETSCOOK_STICKY_PATH: stickyPath },
		);
		assert.equal(result.status, 0);
		const output = JSON.parse(result.stdout.trim());
		assert.match(output.additional_context, /launch bundled agent Task/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("stop nudges task launch when in-flight with subagent_running sticky", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-hook-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	const agentDir = path.join(dir, ".agent", "current");
	try {
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: dir,
				next_mandatory_role: "completion-implementer",
				continuation_policy: "continue",
				phase: "subagent_running",
			})}\n`,
			"utf8",
		);
		await writeFile(
			path.join(agentDir, "state.json"),
			`${JSON.stringify({
				dispatch_in_flight: { role: "completion-implementer", slice_id: "slice-1" },
			})}\n`,
			"utf8",
		);

		const result = runHook(
			"stop",
			{ status: "completed", parent_conversation_id: "parent-1" },
			{ LETSCOOK_STICKY_PATH: stickyPath },
		);
		assert.equal(result.status, 0);
		const output = JSON.parse(result.stdout.trim());
		assert.match(output.followup_message, /claim already succeeded/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("post start_cook_workflow skips sticky when dispatch blocked", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-hook-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		const result = runHook(
			"post",
			{
				tool_name: "start_cook_workflow",
				conversation_id: "parent-1",
				tool_output: JSON.stringify({
					ok: true,
					dispatch: {
						workspace_root: dir,
						role: "completion-regrounder",
						continuation_policy: "continue",
						dispatch_allowed: false,
						reason: "git_head_unavailable",
					},
				}),
			},
			{ LETSCOOK_STICKY_PATH: stickyPath },
		);
		assert.equal(result.status, 0);
		assert.equal(readStickyForHook({ parent_conversation_id: "parent-1" }), undefined);
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("post start_cook_workflow seeds sticky", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-hook-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		const result = runHook(
			"post",
			{
				tool_name: "start_cook_workflow",
				conversation_id: "parent-1",
				tool_output: JSON.stringify({
					ok: true,
					dispatch: {
						workspace_root: dir,
						role: "completion-regrounder",
						continuation_policy: "continue",
					},
				}),
			},
			{ LETSCOOK_STICKY_PATH: stickyPath },
		);
		assert.equal(result.status, 0);
		const sticky = readStickyForHook({ parent_conversation_id: "parent-1" });
		assert.equal(sticky?.workspaceRoot, dir);
		assert.equal(sticky?.role, "completion-regrounder");
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("stop continues when subagent_running sticky is orphaned without in-flight", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-hook-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	const agentDir = path.join(dir, ".agent", "current");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: dir,
				next_mandatory_role: "completion-regrounder",
				continuation_policy: "continue",
				phase: "subagent_running",
			})}\n`,
			"utf8",
		);
		await writeFile(
			path.join(agentDir, "state.json"),
			`${JSON.stringify({
				next_mandatory_role: "completion-regrounder",
				continuation_policy: "continue",
			})}\n`,
			"utf8",
		);

		const result = runHook(
			"stop",
			{ status: "completed", parent_conversation_id: "parent-1" },
			{ LETSCOOK_STICKY_PATH: stickyPath },
		);
		assert.equal(result.status, 0);
		const output = JSON.parse(result.stdout.trim());
		assert.match(output.followup_message, /get_workflow_dispatch/);
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("resolveStopStickyContext rejects scoped sticky without ids when workflow inactive", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-hook-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: dir,
				next_mandatory_role: "completion-implementer",
				continuation_policy: "continue",
				phase: "ready_to_dispatch",
			})}\n`,
			"utf8",
		);

		assert.equal(resolveStopStickyContext({}), undefined);
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("resolveStopStickyContext falls back without ids when ready_to_dispatch", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-hook-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	const agentDir = path.join(dir, ".agent", "current");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: dir,
				next_mandatory_role: "completion-implementer",
				continuation_policy: "continue",
				phase: "ready_to_dispatch",
			})}\n`,
			"utf8",
		);
		await writeFile(
			path.join(agentDir, "state.json"),
			`${JSON.stringify({
				continuation_policy: "continue",
				next_mandatory_role: "completion-implementer",
			})}\n`,
			"utf8",
		);

		const sticky = resolveStopStickyContext({});
		assert.equal(sticky?.workspaceRoot, dir);
		assert.equal(sticky?.role, "completion-implementer");
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("resolveStopStickyContext falls back without ids when dispatch is in flight", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-hook-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	const agentDir = path.join(dir, ".agent", "current");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: dir,
				next_mandatory_role: "completion-implementer",
				continuation_policy: "continue",
				phase: "subagent_running",
			})}\n`,
			"utf8",
		);
		await writeFile(
			path.join(agentDir, "state.json"),
			`${JSON.stringify({
				dispatch_in_flight: {
					role: "completion-implementer",
					slice_id: "slice-1",
					head_sha: "abc",
					claimed_at: "2026-01-01T00:00:00.000Z",
					dispatch_key: "completion-implementer:slice-1:abc:claim1",
				},
			})}\n`,
			"utf8",
		);

		const sticky = resolveStopStickyContext({});
		assert.equal(sticky?.workspaceRoot, dir);
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("stop nudges submit retry when awaiting_submit", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-hook-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	const agentDir = path.join(dir, ".agent", "current");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: dir,
				next_mandatory_role: "completion-implementer",
				continuation_policy: "continue",
				phase: "awaiting_submit",
			})}\n`,
			"utf8",
		);
		await writeFile(
			path.join(agentDir, "state.json"),
			`${JSON.stringify({
				dispatch_in_flight: { role: "completion-implementer", slice_id: "slice-1" },
			})}\n`,
			"utf8",
		);

		const result = runHook(
			"stop",
			{ status: "completed", parent_conversation_id: "parent-1" },
			{ LETSCOOK_STICKY_PATH: stickyPath },
		);
		assert.equal(result.status, 0);
		const output = JSON.parse(result.stdout.trim());
		assert.match(output.followup_message, /submit_role_result/);
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("post failed submit nudges retry when dispatch still in flight", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-hook-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	const agentDir = path.join(dir, ".agent", "current");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: dir,
				next_mandatory_role: "completion-implementer",
				continuation_policy: "continue",
				phase: "awaiting_submit",
			})}\n`,
			"utf8",
		);
		await writeFile(
			path.join(agentDir, "state.json"),
			`${JSON.stringify({
				dispatch_in_flight: { role: "completion-implementer", slice_id: "slice-1" },
			})}\n`,
			"utf8",
		);

		const result = runHook(
			"post",
			{
				tool_name: "submit_role_result",
				conversation_id: "parent-1",
				tool_output: JSON.stringify({
					ok: false,
					error: "dispatch not claimed",
					workspace_root: dir,
				}),
			},
			{ LETSCOOK_STICKY_PATH: stickyPath },
		);
		assert.equal(result.status, 0);
		const output = JSON.parse(result.stdout.trim());
		assert.match(output.additional_context, /submit_role_result failed/);
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("stop nudges task launch when in-flight with ready_to_dispatch sticky", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-hook-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	const agentDir = path.join(dir, ".agent", "current");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: dir,
				next_mandatory_role: "completion-implementer",
				continuation_policy: "continue",
				phase: "ready_to_dispatch",
			})}\n`,
			"utf8",
		);
		await writeFile(
			path.join(agentDir, "state.json"),
			`${JSON.stringify({
				dispatch_in_flight: { role: "completion-implementer", slice_id: "slice-1" },
			})}\n`,
			"utf8",
		);

		const result = runHook(
			"stop",
			{ status: "completed", parent_conversation_id: "parent-1" },
			{ LETSCOOK_STICKY_PATH: stickyPath },
		);
		assert.equal(result.status, 0);
		const output = JSON.parse(result.stdout.trim());
		assert.match(output.followup_message, /claim already succeeded/);
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("subagent stop preserves dispatch_key from in-flight in sticky", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-hook-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	const agentDir = path.join(dir, ".agent", "current");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: dir,
				next_mandatory_role: "completion-implementer",
				continuation_policy: "continue",
				phase: "subagent_running",
			})}\n`,
			"utf8",
		);
		await writeFile(
			path.join(agentDir, "state.json"),
			`${JSON.stringify({
				dispatch_in_flight: {
					role: "completion-implementer",
					slice_id: "slice-1",
					head_sha: "abc123",
					claimed_at: "2026-01-01T00:00:00.000Z",
					dispatch_key: "completion-implementer:slice-1:abc123:claim1",
				},
			})}\n`,
			"utf8",
		);

		const result = runHook(
			"subagent",
			{ status: "completed", parent_conversation_id: "parent-1" },
			{ LETSCOOK_STICKY_PATH: stickyPath },
		);
		assert.equal(result.status, 0);
		const sticky = readStickyForHook({ parent_conversation_id: "parent-1" });
		assert.equal(sticky?.dispatchKey, "completion-implementer:slice-1:abc123:claim1");
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("resolveSubagentSubmitContext requires dispatch in-flight", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-sticky-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	const agentDir = path.join(dir, ".agent", "current");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: dir,
				next_mandatory_role: "completion-implementer",
				continuation_policy: "continue",
				phase: "subagent_running",
			})}\n`,
			"utf8",
		);
		await writeFile(
			path.join(agentDir, "state.json"),
			`${JSON.stringify({ next_mandatory_role: "completion-implementer" })}\n`,
			"utf8",
		);

		assert.equal(resolveSubagentSubmitContext({ parent_conversation_id: "parent-1" }), undefined);
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("resolveStickyConversationId prefers parent for sticky key", () => {
	const id = resolveStickyConversationId({
		parent_conversation_id: "parent-1",
		conversation_id: "child-1",
	});
	assert.equal(id, "parent-1");
});

test("normalizeSticky maps workspace_root to workspaceRoot", () => {
	const next = normalizeSticky({
		workspace_root: "/tmp/ws",
		next_mandatory_role: "completion-implementer",
		continuation_policy: "continue",
		phase: "subagent_running",
		dispatch_key: "key-1",
		conversation_id: "parent-1",
	});
	assert.equal(next?.workspaceRoot, "/tmp/ws");
	assert.equal(next?.role, "completion-implementer");
});

test("readStickyForHook matches parent sticky from child subagent conversation", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-sticky-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				subagent_conversation_id: "child-1",
				workspace_root: "/tmp/ws",
				next_mandatory_role: "completion-regrounder",
				continuation_policy: "continue",
			})}\n`,
			"utf8",
		);

		const fromChild = readStickyForHook({ conversation_id: "child-1" });
		assert.equal(fromChild?.workspaceRoot, "/tmp/ws");
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("readStickyForHook matches parent conversation id from hook payload", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-sticky-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: "/tmp/ws",
				next_mandatory_role: "completion-regrounder",
				continuation_policy: "continue",
			})}\n`,
			"utf8",
		);

		const fromParent = readStickyForHook({
			parent_conversation_id: "parent-1",
			conversation_id: "child-1",
		});
		assert.equal(fromParent?.workspaceRoot, "/tmp/ws");

		const fromChildOnly = readStickyForHook({
			conversation_id: "child-1",
		});
		assert.equal(fromChildOnly, undefined);
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("readStickyForHook rejects scoped sticky when hook has no conversation ids", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-sticky-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: "/tmp/ws",
				next_mandatory_role: "completion-regrounder",
				continuation_policy: "continue",
			})}\n`,
			"utf8",
		);

		assert.equal(readStickyForHook({}), undefined);
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("readStickyForHook falls back to global sticky without conversation_id", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-sticky-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				workspace_root: "/tmp/global-ws",
				next_mandatory_role: "completion-implementer",
				continuation_policy: "continue",
			})}\n`,
			"utf8",
		);

		const sticky = readStickyForHook({});
		assert.equal(sticky?.workspaceRoot, "/tmp/global-ws");
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("resolveSubagentSubmitContext ignores unrelated subagent before claim phase", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-sticky-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	const agentDir = path.join(dir, ".agent", "current");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: dir,
				next_mandatory_role: "completion-implementer",
				continuation_policy: "continue",
				phase: "ready_to_dispatch",
			})}\n`,
			"utf8",
		);
		await writeFile(
			path.join(agentDir, "state.json"),
			`${JSON.stringify({
				dispatch_in_flight: {
					role: "completion-implementer",
					slice_id: "slice-1",
				},
			})}\n`,
			"utf8",
		);

		assert.equal(resolveSubagentSubmitContext({ conversation_id: "other-subagent-1" }), undefined);
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("resolveSubagentSubmitContext binds completion subagent during subagent_running", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-sticky-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	const agentDir = path.join(dir, ".agent", "current");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: dir,
				next_mandatory_role: "completion-implementer",
				continuation_policy: "continue",
				phase: "subagent_running",
			})}\n`,
			"utf8",
		);
		await writeFile(
			path.join(agentDir, "state.json"),
			`${JSON.stringify({
				dispatch_in_flight: {
					role: "completion-implementer",
					slice_id: "slice-1",
					head_sha: "abc",
					claimed_at: "2026-01-01T00:00:00.000Z",
					dispatch_key: "completion-implementer:slice-1:abc:claim1",
				},
			})}\n`,
			"utf8",
		);

		const context = resolveSubagentSubmitContext({ conversation_id: "child-1" });
		assert.equal(context?.workspaceRoot, dir);
		assert.equal(context?.dispatchKey, "completion-implementer:slice-1:abc:claim1");
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("resolveSubagentSubmitContext uses in-flight when hook omits conversation ids", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-sticky-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	const agentDir = path.join(dir, ".agent", "current");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				workspace_root: dir,
				next_mandatory_role: "completion-implementer",
				continuation_policy: "continue",
				phase: "subagent_running",
			})}\n`,
			"utf8",
		);
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			path.join(agentDir, "state.json"),
			`${JSON.stringify({
				dispatch_in_flight: {
					role: "completion-implementer",
					slice_id: "slice-1",
				},
			})}\n`,
			"utf8",
		);

		const context = resolveSubagentSubmitContext({});
		assert.equal(context?.workspaceRoot, dir);
		assert.equal(context?.role, "completion-implementer");
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("resolveSubagentSubmitContext uses in-flight when linked subagent omits conversation ids", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "letscook-sticky-test-"));
	const stickyPath = path.join(dir, "sticky.json");
	const agentDir = path.join(dir, ".agent", "current");
	process.env.LETSCOOK_STICKY_PATH = stickyPath;
	try {
		await writeFile(
			stickyPath,
			`${JSON.stringify({
				conversation_id: "parent-1",
				subagent_conversation_id: "child-1",
				workspace_root: dir,
				next_mandatory_role: "completion-implementer",
				continuation_policy: "continue",
				phase: "awaiting_submit",
			})}\n`,
			"utf8",
		);
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			path.join(agentDir, "state.json"),
			`${JSON.stringify({
				dispatch_in_flight: {
					role: "completion-implementer",
					slice_id: "slice-1",
					head_sha: "abc",
					claimed_at: "2026-01-01T00:00:00.000Z",
					dispatch_key: "completion-implementer:slice-1:abc:claim1",
				},
			})}\n`,
			"utf8",
		);

		const context = resolveSubagentSubmitContext({});
		assert.equal(context?.workspaceRoot, dir);
		assert.equal(context?.dispatchKey, "completion-implementer:slice-1:abc:claim1");
	} finally {
		delete process.env.LETSCOOK_STICKY_PATH;
		await rm(dir, { recursive: true, force: true });
	}
});

test("conversationIdsForStickyLookup deduplicates ids", () => {
	const ids = conversationIdsForStickyLookup({
		parent_conversation_id: "same",
		conversation_id: "same",
		session_id: "session-1",
	});
	assert.deepEqual(ids, ["same", "session-1"]);
});
