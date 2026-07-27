#!/usr/bin/env node
/**
 * Shared parser for letscook MCP tool results inside Cursor hooks.
 * Reads JSON from stdin: { tool_name, tool_output, ... } or subagentStop payload.
 * Prints JSON to stdout: { action, additional_context?, followup_message?, sticky? }
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

function stickyPath() {
	return (
		process.env.LETSCOOK_STICKY_PATH ??
		path.join(os.homedir(), ".cursor", "letscook-sticky-continue.json")
	);
}

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

function shouldContinueAfterSubmit(payload) {
	if (!payload || payload.ok === false) return undefined;
	const dispatch = payload.dispatch && typeof payload.dispatch === "object" ? payload.dispatch : payload;
	const workflowClosed =
		payload.workflow_closed === true ||
		dispatch.workflow_closed === true ||
		dispatch.reason === "workflow_closed";
	if (workflowClosed) return undefined;
	const continuation = dispatch.continuation_policy ?? payload.continuation_policy;
	if (isStoppedContinuation(continuation)) return undefined;
	if (payload.driver_continue !== true) return undefined;
	const role = dispatch.role ?? payload.next_mandatory_role;
	const workspaceRoot = dispatch.workspace_root ?? payload.workspace_root;
	if (!workspaceRoot || !role) return undefined;
	return {
		workspaceRoot,
		role,
		continuation: continuation ?? "continue",
		dispatchKey: dispatch.dispatch_key ?? null,
		phase: "ready_to_dispatch",
	};
}

function isStoppedContinuation(policy) {
	return policy === "paused" || policy === "blocked" || policy === "await_user_input" || policy === "done";
}

function buildSubmitNudge(next) {
	return [
		"LETSCOOK STICKY CONTINUE (mandatory): role submitted; preflight next dispatch.",
		`workspace_root: ${next.workspaceRoot}`,
		`next_mandatory_role: ${next.role}`,
		"Steps: get_workflow_dispatch (preflight) → claim_workflow_dispatch → dispatch ONE bundled agent Task.",
		"Do NOT open a second Task for the same dispatch_key while dispatch_in_flight is set.",
	].join("\n");
}

function buildClaimedDispatchNudge(workspaceRoot, role) {
	return [
		"LETSCOOK STICKY CONTINUE (mandatory): dispatch claimed; launch bundled agent Task.",
		`workspace_root: ${workspaceRoot}`,
		`next_mandatory_role: ${role}`,
		"Dispatch ONE bundled completion agent Task for this role now.",
		"Do NOT call claim_workflow_dispatch again while dispatch_in_flight is set.",
		"If a Task is already running for this dispatch, wait for it to finish.",
	].join("\n");
}

function buildClaimedDispatchFollowup(workspaceRoot, role) {
	return [
		"Continue the active letscook completion workflow without asking the user.",
		`workspace_root: ${workspaceRoot}`,
		`Dispatch ONE bundled agent for role: ${role} (claim already succeeded).`,
		"If no Task is running yet, launch it now. If a Task is already running, wait for subagentStop.",
	].join(" ");
}

function buildSubmitFollowup(next) {
	return [
		"Continue the active letscook completion workflow without asking the user.",
		`workspace_root: ${next.workspaceRoot}`,
		`Next role: ${next.role}`,
		"Steps: get_workflow_dispatch → claim_workflow_dispatch → dispatch bundled agent → submit_role_result → repeat until workflow_closed.",
	].join(" ");
}

function buildSubagentSubmitFollowup(next, loopCount) {
	const dispatchKeyLine = next.dispatchKey
		? `dispatch_key: ${next.dispatchKey}`
		: "dispatch_key: (from active dispatch_in_flight)";
	return [
		`Letscook subagent finished (auto-continue ${loopCount ?? 0}).`,
		`workspace_root: ${next.workspaceRoot}`,
		`If the subagent output is not yet submitted, call submit_role_result({ workspace_root, role, raw_output, ${dispatchKeyLine} }) now.`,
		"Do NOT dispatch another Task until submit_role_result completes and clears dispatch_in_flight.",
	].join(" ");
}

function buildGenericSubagentSubmitFollowup(loopCount) {
	return [
		`Letscook subagent finished (auto-continue ${loopCount ?? 0}).`,
		"If not submitted yet, call submit_role_result with workspace_root, role, raw_output, and the active dispatch_key from dispatch_in_flight.",
		"Do NOT call claim_workflow_dispatch or open another Task until submit completes.",
	].join(" ");
}

function buildSubmitRetryNudge(workspaceRoot, role, dispatchKey) {
	return [
		"LETSCOOK STICKY CONTINUE (mandatory): submit_role_result failed; retry now.",
		`workspace_root: ${workspaceRoot}`,
		`role: ${role}`,
		dispatchKey ? `dispatch_key: ${dispatchKey}` : "dispatch_key: (from active dispatch_in_flight)",
		"Call submit_role_result({ workspace_root, role, raw_output, dispatch_key }) with the subagent output.",
		"Do NOT dispatch another Task until submit succeeds.",
	].join("\n");
}

/** Parent-first so postToolUse and subagentStop share the same sticky key. */
export function resolveStickyConversationId(input) {
	if (typeof input.parent_conversation_id === "string" && input.parent_conversation_id) {
		return input.parent_conversation_id;
	}
	const id = input.conversation_id ?? input.session_id;
	return typeof id === "string" && id.length > 0 ? id : undefined;
}

export function conversationIdsForStickyLookup(input) {
	const ids = [];
	for (const key of ["parent_conversation_id", "conversation_id", "session_id"]) {
		const value = input[key];
		if (typeof value === "string" && value.length > 0 && !ids.includes(value)) {
			ids.push(value);
		}
	}
	return ids;
}

function readStickyRaw() {
	if (!fs.existsSync(stickyPath())) return undefined;
	try {
		return JSON.parse(fs.readFileSync(stickyPath(), "utf8"));
	} catch {
		return undefined;
	}
}

export function normalizeSticky(sticky) {
	if (!sticky || typeof sticky !== "object") return undefined;
	const workspaceRoot = sticky.workspace_root;
	if (!workspaceRoot) return undefined;
	return {
		workspaceRoot,
		role: sticky.next_mandatory_role ?? null,
		continuation: sticky.continuation_policy ?? "continue",
		phase: sticky.phase ?? "ready_to_dispatch",
		dispatchKey: sticky.dispatch_key ?? null,
		conversationId: sticky.conversation_id ?? null,
	};
}

export function readStickyForHook(input) {
	const sticky = readStickyRaw();
	if (!sticky) return undefined;
	const normalized = normalizeSticky(sticky);
	if (!normalized) return undefined;

	const stickyIds = [sticky.conversation_id, sticky.subagent_conversation_id].filter(Boolean);
	if (stickyIds.length > 0) {
		const lookupIds = conversationIdsForStickyLookup(input);
		if (lookupIds.length === 0) return undefined;
		if (!lookupIds.some((id) => stickyIds.includes(id))) return undefined;
		return normalized;
	}

	// Global sticky (no conversation_id) — used when hook payloads omit conversation ids.
	return normalized;
}

export function resolveSubagentSubmitContext(input) {
	let sticky = readStickyForHook(input);
	let raw = readStickyRaw();

	if (!sticky && raw?.workspace_root && raw.conversation_id && !raw.subagent_conversation_id) {
		const childId = typeof input.conversation_id === "string" ? input.conversation_id : undefined;
		if (childId && childId !== raw.conversation_id && raw.phase === "subagent_running") {
			const inFlight = readDispatchInFlightFromWorkspace(raw.workspace_root);
			if (inFlight) {
				raw = { ...raw, subagent_conversation_id: childId };
				sticky = normalizeSticky(raw);
				writeSticky(
					raw.conversation_id,
					{
						workspaceRoot: raw.workspace_root,
						role: inFlight.role ?? raw.next_mandatory_role,
						continuation: raw.continuation_policy ?? "continue",
						phase: "awaiting_submit",
						dispatchKey: inFlight.dispatch_key ?? raw.dispatch_key ?? null,
					},
					input,
				);
			}
		}
	}

	if (sticky?.workspaceRoot) {
		const inFlight = readDispatchInFlightFromWorkspace(sticky.workspaceRoot);
		if (!inFlight) return undefined;
		const role = resolveSubmitRoleFromContext(sticky.workspaceRoot, sticky, inFlight);
		if (role) {
			return {
				sticky,
				workspaceRoot: sticky.workspaceRoot,
				role,
				dispatchKey: inFlight.dispatch_key,
			};
		}
	}

	if (!sticky) {
		raw = readStickyRaw();
	}
	if (!sticky && raw?.workspace_root) {
		const stickyIds = [raw.conversation_id, raw.subagent_conversation_id].filter(Boolean);
		const lookupIds = conversationIdsForStickyLookup(input);
		if (stickyIds.length > 0 && lookupIds.length > 0) {
			if (!lookupIds.some((id) => stickyIds.includes(id))) return undefined;
		} else if (raw.subagent_conversation_id && stickyIds.length > 0 && lookupIds.length === 0) {
			// Linked completion subagent may stop without conversation ids in the hook payload.
		} else if (stickyIds.length > 0 && lookupIds.length === 0 && !raw.subagent_conversation_id) {
			if (raw.phase !== "subagent_running" && raw.phase !== "awaiting_submit") {
				return undefined;
			}
		}

		const normalized = normalizeSticky(raw);
		if (!normalized) return undefined;
		const inFlight = readDispatchInFlightFromWorkspace(raw.workspace_root);
		if (!inFlight) return undefined;
		const role = resolveSubmitRoleFromContext(raw.workspace_root, normalized, inFlight);
		if (!role) return undefined;
		return {
			sticky: normalized,
			workspaceRoot: raw.workspace_root,
			role,
			dispatchKey: inFlight.dispatch_key,
		};
	}

	return undefined;
}

function shouldAllowStopStickyFallbackWithoutIds(raw) {
	const inFlight = readDispatchInFlightFromWorkspace(raw.workspace_root);
	if (inFlight) return true;
	const canonicalContinuation = readContinuationPolicyFromWorkspace(raw.workspace_root);
	if (!canonicalContinuation) return false;
	if (isStoppedContinuation(canonicalContinuation)) return false;
	return raw.phase === "ready_to_dispatch";
}

export function resolveStopStickyContext(input) {
	let sticky = readStickyForHook(input);
	const raw = readStickyRaw();

	if (!sticky && raw?.workspace_root) {
		const stickyIds = [raw.conversation_id, raw.subagent_conversation_id].filter(Boolean);
		const lookupIds = conversationIdsForStickyLookup(input);
		if (stickyIds.length > 0 && lookupIds.length === 0) {
			if (!shouldAllowStopStickyFallbackWithoutIds(raw)) return undefined;
		}
		if (stickyIds.length > 0 && lookupIds.length > 0) {
			if (!lookupIds.some((id) => stickyIds.includes(id))) return undefined;
		}
		sticky = normalizeSticky(raw);
	}

	if (!sticky?.workspaceRoot) return undefined;

	const workspaceRole = readNextMandatoryRoleFromWorkspace(sticky.workspaceRoot);
	if (workspaceRole) {
		return { ...sticky, role: workspaceRole };
	}
	return sticky;
}

function resolveStickyWriteConversationId(input) {
	const raw = readStickyRaw();
	if (raw?.conversation_id) return raw.conversation_id;
	return resolveStickyConversationId(input);
}

function clearStickyFile() {
	try {
		fs.unlinkSync(stickyPath());
	} catch {
		// ignore
	}
}

function clearStickyForConversation(conversationId) {
	const sticky = readStickyRaw();
	if (!sticky) return;
	if (!sticky.conversation_id || sticky.conversation_id === conversationId) {
		clearStickyFile();
	}
}

function writeSticky(conversationId, next, hookInput) {
	const sticky = {
		workspace_root: next.workspaceRoot,
		next_mandatory_role: next.role ?? null,
		continuation_policy: next.continuation ?? "continue",
		phase: next.phase ?? "ready_to_dispatch",
		dispatch_key: next.dispatchKey ?? null,
		updated_at: new Date().toISOString(),
	};
	if (conversationId) {
		sticky.conversation_id = conversationId;
	}
	if (
		hookInput &&
		typeof hookInput.conversation_id === "string" &&
		hookInput.conversation_id &&
		hookInput.conversation_id !== conversationId
	) {
		sticky.subagent_conversation_id = hookInput.conversation_id;
	}
	try {
		fs.mkdirSync(path.dirname(stickyPath()), { recursive: true });
		fs.writeFileSync(stickyPath(), `${JSON.stringify(sticky, null, 2)}\n`, "utf8");
	} catch {
		// ignore
	}
}

function seedStickyFromWorkflowStart(conversationId, payload, hookInput) {
	const dispatch = payload?.dispatch;
	const workspaceRoot = dispatch?.workspace_root ?? payload?.workspace_root;
	const role = dispatch?.role ?? payload?.next_mandatory_role;
	if (!workspaceRoot || !role) return;
	if (dispatch && dispatch.dispatch_allowed === false) return;
	if (isWorkflowClosed(payload)) return;
	writeSticky(
		conversationId,
		{
			workspaceRoot,
			role,
			continuation: dispatch?.continuation_policy ?? payload?.continuation_policy ?? "continue",
			phase: "ready_to_dispatch",
			dispatchKey: dispatch?.dispatch_key ?? null,
		},
		hookInput,
	);
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

function readDispatchInFlightFromWorkspace(workspaceRoot) {
	if (!workspaceRoot) return null;
	const statePath = path.join(workspaceRoot, ".agent", "current", "state.json");
	try {
		const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
		const inFlight = state?.dispatch_in_flight;
		if (!inFlight || typeof inFlight !== "object") return null;
		return inFlight;
	} catch {
		return null;
	}
}

function readContinuationPolicyFromWorkspace(workspaceRoot) {
	if (!workspaceRoot) return undefined;
	const statePath = path.join(workspaceRoot, ".agent", "current", "state.json");
	try {
		const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
		return typeof state.continuation_policy === "string" ? state.continuation_policy : undefined;
	} catch {
		return undefined;
	}
}

function readNextMandatoryRoleFromWorkspace(workspaceRoot) {
	if (!workspaceRoot) return undefined;
	const statePath = path.join(workspaceRoot, ".agent", "current", "state.json");
	try {
		const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
		return typeof state.next_mandatory_role === "string" ? state.next_mandatory_role : undefined;
	} catch {
		return undefined;
	}
}

function resolveSubmitRoleFromContext(workspaceRoot, sticky, inFlight) {
	return inFlight?.role ?? sticky?.role ?? readNextMandatoryRoleFromWorkspace(workspaceRoot);
}

function shouldStopFollowup(sticky) {
	if (!sticky) return true;
	if (isStoppedContinuation(sticky.continuation)) return true;
	const canonical = readContinuationPolicyFromWorkspace(sticky.workspaceRoot);
	if (isStoppedContinuation(canonical)) return true;
	return false;
}

function isLetscookToolName(toolName) {
	return (
		/submit_role_result|claim_workflow_dispatch|get_workflow_dispatch|confirm_cook_handoff|start_cook_workflow/i.test(
			toolName,
		) || /letscook/i.test(toolName)
	);
}

async function runCli() {
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
	const loopCount = input.loop_count ?? 0;
	const submitContext = resolveSubagentSubmitContext(input);
	if (submitContext) {
		const followupTarget = {
			workspaceRoot: submitContext.workspaceRoot,
			role: submitContext.role,
			dispatchKey: submitContext.dispatchKey,
		};
		process.stdout.write(
			JSON.stringify({ followup_message: buildSubagentSubmitFollowup(followupTarget, loopCount) }) + "\n",
		);
		writeSticky(
			resolveStickyWriteConversationId(input),
			{
				workspaceRoot: submitContext.workspaceRoot,
				role: submitContext.role,
				continuation: submitContext.sticky?.continuation ?? "continue",
				phase: "awaiting_submit",
				dispatchKey: submitContext.dispatchKey ?? submitContext.sticky?.dispatchKey ?? null,
			},
			input,
		);
		process.exit(0);
	}
	const raw = readStickyRaw();
	if (raw?.workspace_root) {
		const inFlight = readDispatchInFlightFromWorkspace(raw.workspace_root);
		const role = inFlight?.role ?? raw.next_mandatory_role;
		if (inFlight && role) {
			process.stdout.write(
				JSON.stringify({
					followup_message: buildSubagentSubmitFollowup(
						{
							workspaceRoot: raw.workspace_root,
							role,
							dispatchKey: inFlight.dispatch_key,
						},
						loopCount,
					),
				}) + "\n",
			);
			process.exit(0);
		}
	}
	process.stdout.write("{}\n");
	process.exit(0);
}

if (mode === "stop") {
	if (input.status !== "completed") {
		process.stdout.write("{}\n");
		process.exit(0);
	}
	const sticky = resolveStopStickyContext(input);
	if (!sticky?.workspaceRoot) {
		process.stdout.write("{}\n");
		process.exit(0);
	}
	if (shouldStopFollowup(sticky)) {
		process.stdout.write("{}\n");
		process.exit(0);
	}
	const inFlight = readDispatchInFlightFromWorkspace(sticky.workspaceRoot);
	if (inFlight) {
		if (sticky.phase === "awaiting_submit") {
			const role = resolveSubmitRoleFromContext(sticky.workspaceRoot, sticky, inFlight);
			if (role) {
				process.stdout.write(
					JSON.stringify({
						followup_message: buildSubagentSubmitFollowup(
							{
								workspaceRoot: sticky.workspaceRoot,
								role,
								dispatchKey: inFlight.dispatch_key ?? sticky.dispatchKey,
							},
							input.loop_count ?? 0,
						),
					}) + "\n",
				);
				process.exit(0);
			}
		} else if (sticky.phase === "ready_to_dispatch" || sticky.phase === "subagent_running") {
			const role = inFlight.role ?? sticky.role ?? readNextMandatoryRoleFromWorkspace(sticky.workspaceRoot);
			if (role) {
				process.stdout.write(
					JSON.stringify({
						followup_message: buildClaimedDispatchFollowup(sticky.workspaceRoot, role),
					}) + "\n",
				);
				process.exit(0);
			}
		}
		process.stdout.write("{}\n");
		process.exit(0);
	}
	const role = sticky.role ?? readNextMandatoryRoleFromWorkspace(sticky.workspaceRoot);
	if (!role) {
		process.stdout.write("{}\n");
		process.exit(0);
	}
	process.stdout.write(
		JSON.stringify({ followup_message: buildSubmitFollowup({ ...sticky, role }) }) + "\n",
	);
	process.exit(0);
}

const toolName = String(input.tool_name ?? "");
const isLetscookTool = isLetscookToolName(toolName);

if (mode === "post" && !isLetscookTool) {
	process.stdout.write("{}\n");
	process.exit(0);
}

const payload = parsePayload(input.tool_output ?? input.result_json ?? "");
const conversationId = resolveStickyConversationId(input);

if (
	(toolName.includes("confirm_cook_handoff") || toolName.includes("start_cook_workflow")) &&
	payload?.ok === true &&
	payload?.confirmed !== false
) {
	seedStickyFromWorkflowStart(conversationId, payload, input);
}

if (toolName.includes("claim_workflow_dispatch") && payload?.ok === true) {
	const dispatch = payload.dispatch ?? payload;
	const workspaceRoot = dispatch.workspace_root ?? payload.workspace_root;
	const role = dispatch.role ?? payload.role;
	if (workspaceRoot && role) {
		writeSticky(
			conversationId,
			{
				workspaceRoot,
				role,
				continuation: dispatch.continuation_policy ?? "continue",
				phase: "subagent_running",
				dispatchKey: dispatch.dispatch_key ?? payload.dispatch_key ?? null,
			},
			input,
		);
		process.stdout.write(
			JSON.stringify({ additional_context: buildClaimedDispatchNudge(workspaceRoot, role) }) + "\n",
		);
		process.exit(0);
	}
	process.stdout.write("{}\n");
	process.exit(0);
}

if (toolName.includes("submit_role_result")) {
	if (!payload || payload.ok === false) {
		const sticky = resolveStopStickyContext(input);
		const workspaceRoot =
			sticky?.workspaceRoot ?? payload?.workspace_root ?? payload?.dispatch?.workspace_root;
		const inFlight = workspaceRoot ? readDispatchInFlightFromWorkspace(workspaceRoot) : null;
		if (workspaceRoot && inFlight) {
			const role = resolveSubmitRoleFromContext(workspaceRoot, sticky, inFlight);
			if (role) {
				writeSticky(
					conversationId,
					{
						workspaceRoot,
						role,
						continuation: sticky?.continuation ?? "continue",
						phase: "awaiting_submit",
						dispatchKey: sticky?.dispatchKey ?? inFlight.dispatch_key ?? null,
					},
					input,
				);
				process.stdout.write(
					JSON.stringify({ additional_context: buildSubmitRetryNudge(workspaceRoot, role, inFlight.dispatch_key) }) +
						"\n",
				);
				process.exit(0);
			}
		}
		process.stdout.write("{}\n");
		process.exit(0);
	}
	const next = shouldContinueAfterSubmit(payload);
	if (!next) {
		if (isWorkflowClosed(payload)) {
			clearStickyFile();
		} else {
			const sticky = readStickyForHook(input);
			const workspaceRoot =
				sticky?.workspaceRoot ?? payload.dispatch?.workspace_root ?? payload.workspace_root;
			if (workspaceRoot) {
				const continuation =
					payload.dispatch?.continuation_policy ?? sticky?.continuation ?? "continue";
				writeSticky(
					conversationId,
					{
						workspaceRoot,
						role: payload.next_mandatory_role ?? sticky?.role ?? null,
						continuation,
						phase: isStoppedContinuation(continuation) ? "stopped" : "ready_to_dispatch",
						dispatchKey: payload.dispatch?.dispatch_key ?? sticky?.dispatchKey ?? null,
					},
					input,
				);
			}
		}
		process.stdout.write("{}\n");
		process.exit(0);
	}
	writeSticky(conversationId, next, input);
	if (mode === "post") {
		process.stdout.write(JSON.stringify({ additional_context: buildSubmitNudge(next) }) + "\n");
		process.exit(0);
	}
}

if (isWorkflowClosed(payload)) {
	clearStickyFile();
}

process.stdout.write("{}\n");
}

const isCli =
	typeof process.argv[1] === "string" &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
	await runCli();
}
