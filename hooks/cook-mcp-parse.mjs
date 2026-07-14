#!/usr/bin/env node
/**
 * Shared parser for letscook MCP tool results inside Cursor hooks.
 * Reads JSON from stdin: { tool_name, tool_output, ... } or subagentStop payload.
 * Prints JSON to stdout: { action, additional_context?, followup_message?, sticky? }
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const STICKY_PATH = path.join(os.homedir(), ".cursor", "letscook-sticky-continue.json");

function readStdin() {
	return new Promise((resolve) => {
		let data = "";
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data));
	});
}

function parsePayload(raw) {
	if (!raw) return undefined;
	try {
		const outer = JSON.parse(raw);
		if (outer && typeof outer === "object" && !Array.isArray(outer)) {
			if (typeof outer.ok === "boolean" || outer.dispatch || outer.workflow_closed !== undefined) {
				return outer;
			}
			const text = Array.isArray(outer.content)
				? outer.content.find((item) => item?.type === "text")?.text
				: undefined;
			if (typeof text === "string") {
				return JSON.parse(text);
			}
		}
	} catch {
		// ignore
	}
	return undefined;
}

function shouldContinue(payload) {
	if (!payload || payload.ok === false) return undefined;
	const dispatch = payload.dispatch && typeof payload.dispatch === "object" ? payload.dispatch : payload;
	const workflowClosed =
		payload.workflow_closed === true ||
		dispatch.workflow_closed === true ||
		dispatch.reason === "workflow_closed";
	if (workflowClosed) return undefined;
	const continuation = dispatch.continuation_policy ?? payload.continuation_policy;
	if (continuation === "paused" || continuation === "blocked" || continuation === "await_user_input") {
		return undefined;
	}
	if (dispatch.dispatch_allowed !== true) return undefined;
	const role = dispatch.role ?? payload.next_mandatory_role;
	const workspaceRoot = dispatch.workspace_root ?? payload.workspace_root;
	if (!workspaceRoot || !role) return undefined;
	return { workspaceRoot, role, continuation: continuation ?? "continue" };
}

function buildNudge(next) {
	return [
		"LETSCOOK STICKY CONTINUE (mandatory): completion workflow is still active.",
		`workspace_root: ${next.workspaceRoot}`,
		`next_mandatory_role: ${next.role}`,
		"Do NOT end this turn or ask the user whether to continue.",
		"Immediately: invoke the bundled agent for next_mandatory_role with dispatch system_context + task_prompt, then submit_role_result.",
		"If the previous subagent output is not yet submitted, call submit_role_result first.",
	].join("\n");
}

function buildFollowup(next) {
	return [
		"Continue the active letscook completion workflow without asking the user.",
		`workspace_root: ${next.workspaceRoot}`,
		`Next role: ${next.role}`,
		"Steps: get_workflow_dispatch if needed → dispatch bundled agent → submit_role_result → repeat until workflow_closed.",
	].join(" ");
}

function buildSubagentFollowup(next, loopCount) {
	const base = buildFollowup(next);
	return `${base} If the subagent output is not yet submitted, call submit_role_result first, then get_workflow_dispatch. (auto-continue ${loopCount ?? 0})`;
}

function buildGenericSubagentFollowup(loopCount) {
	return [
		"Letscook subagent finished. Mandatory next steps in this same conversation:",
		"1) if not submitted yet, call submit_role_result({ workspace_root, role, raw_output });",
		"2) call get_workflow_dispatch({ workspace_root });",
		"3) if dispatch_allowed, immediately dispatch the returned cursor_agent with system_context + task_prompt — do not ask the user to continue.",
		`(auto-continue ${loopCount ?? 0})`,
	].join(" ");
}

function resolveConversationId(input, { preferParent = false } = {}) {
	if (preferParent && typeof input.parent_conversation_id === "string" && input.parent_conversation_id) {
		return input.parent_conversation_id;
	}
	const id = input.conversation_id ?? input.parent_conversation_id ?? input.session_id;
	return typeof id === "string" && id.length > 0 ? id : undefined;
}

function readStickyRaw() {
	if (!fs.existsSync(STICKY_PATH)) return undefined;
	try {
		return JSON.parse(fs.readFileSync(STICKY_PATH, "utf8"));
	} catch {
		return undefined;
	}
}

function readStickyForConversation(conversationId) {
	if (!conversationId) return undefined;
	const sticky = readStickyRaw();
	if (!sticky || sticky.conversation_id !== conversationId) return undefined;
	const workspaceRoot = sticky.workspace_root;
	const role = sticky.next_mandatory_role;
	if (!workspaceRoot || !role) return undefined;
	return {
		workspaceRoot,
		role,
		continuation: sticky.continuation_policy ?? "continue",
	};
}

function clearStickyForConversation(conversationId) {
	const sticky = readStickyRaw();
	if (!sticky) return;
	if (!conversationId || sticky.conversation_id === conversationId) {
		try {
			fs.unlinkSync(STICKY_PATH);
		} catch {
			// ignore
		}
	}
}

function writeSticky(conversationId, next) {
	if (!conversationId) return;
	const sticky = {
		conversation_id: conversationId,
		workspace_root: next.workspaceRoot,
		next_mandatory_role: next.role,
		continuation_policy: next.continuation,
		updated_at: new Date().toISOString(),
	};
	try {
		fs.mkdirSync(path.dirname(STICKY_PATH), { recursive: true });
		fs.writeFileSync(STICKY_PATH, `${JSON.stringify(sticky, null, 2)}\n`, "utf8");
	} catch {
		// ignore
	}
}

function isWorkflowClosed(payload) {
	if (!payload) return false;
	const dispatch = payload.dispatch && typeof payload.dispatch === "object" ? payload.dispatch : payload;
	return (
		payload.workflow_closed === true ||
		dispatch.workflow_closed === true ||
		dispatch.reason === "workflow_closed"
	);
}

const mode = process.argv[2] ?? "post";
const raw = await readStdin();
let input;
try {
	input = JSON.parse(raw);
} catch {
	process.stdout.write("{}\n");
	process.exit(0);
}

if (mode === "subagent") {
	if (input.status !== "completed") {
		process.stdout.write("{}\n");
		process.exit(0);
	}
	const conversationId = resolveConversationId(input, { preferParent: true });
	const stickyNext = readStickyForConversation(conversationId);
	const loopCount = input.loop_count ?? 0;
	if (stickyNext) {
		process.stdout.write(
			JSON.stringify({ followup_message: buildSubagentFollowup(stickyNext, loopCount) }) + "\n",
		);
		process.exit(0);
	}
	process.stdout.write(JSON.stringify({ followup_message: buildGenericSubagentFollowup(loopCount) }) + "\n");
	process.exit(0);
}

if (mode === "stop") {
	if (input.status !== "completed") {
		process.stdout.write("{}\n");
		process.exit(0);
	}
	const conversationId = resolveConversationId(input);
	const stickyNext = readStickyForConversation(conversationId);
	if (!stickyNext) {
		process.stdout.write("{}\n");
		process.exit(0);
	}
	process.stdout.write(JSON.stringify({ followup_message: buildFollowup(stickyNext) }) + "\n");
	process.exit(0);
}

const toolName = String(input.tool_name ?? "");
const isLetscookTool =
	/submit_role_result|get_workflow_dispatch|confirm_cook_handoff/i.test(toolName) ||
	/letscook/i.test(toolName);

if (mode === "post" && !isLetscookTool) {
	process.stdout.write("{}\n");
	process.exit(0);
}

const payload = parsePayload(input.tool_output ?? input.result_json ?? "");
const next = shouldContinue(payload);
const conversationId = resolveConversationId(input);

if (!next) {
	if (isWorkflowClosed(payload)) {
		clearStickyForConversation(conversationId);
	}
	process.stdout.write("{}\n");
	process.exit(0);
}

writeSticky(conversationId, next);

if (mode === "post") {
	process.stdout.write(JSON.stringify({ additional_context: buildNudge(next) }) + "\n");
	process.exit(0);
}

process.stdout.write("{}\n");
