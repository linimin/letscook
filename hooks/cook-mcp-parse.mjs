#!/usr/bin/env node
/**
 * Shared parser for letscook MCP tool results inside Cursor hooks.
 * Reads JSON from stdin: { tool_name, tool_output, ... }
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

const raw = await readStdin();
let input;
try {
	input = JSON.parse(raw);
} catch {
	process.stdout.write("{}\n");
	process.exit(0);
}

const mode = process.argv[2] ?? "post";
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

if (!next) {
	if (mode === "stop" && fs.existsSync(STICKY_PATH)) {
		try {
			fs.unlinkSync(STICKY_PATH);
		} catch {
			// ignore
		}
	}
	process.stdout.write("{}\n");
	process.exit(0);
}

const sticky = {
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

if (mode === "post") {
	process.stdout.write(JSON.stringify({ additional_context: buildNudge(next) }) + "\n");
	process.exit(0);
}

if (mode === "stop") {
	try {
		if (!fs.existsSync(STICKY_PATH)) {
			process.stdout.write("{}\n");
			process.exit(0);
		}
		const sticky = JSON.parse(fs.readFileSync(STICKY_PATH, "utf8"));
		const workspaceRoot = sticky.workspace_root;
		const role = sticky.next_mandatory_role;
		if (!workspaceRoot || !role) {
			process.stdout.write("{}\n");
			process.exit(0);
		}
		process.stdout.write(
			JSON.stringify({
				followup_message: buildFollowup({
					workspaceRoot,
					role,
					continuation: sticky.continuation_policy ?? "continue",
				}),
			}) + "\n",
		);
		process.exit(0);
	} catch {
		process.stdout.write("{}\n");
		process.exit(0);
	}
}

process.stdout.write("{}\n");
