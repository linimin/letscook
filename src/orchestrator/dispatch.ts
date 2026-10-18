import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import type { CompletionRole, JsonRecord, WorkflowDispatch, WorkflowSnapshot } from "../types.ts";
import {
	appendJsonl,
	asString,
	loadWorkflowSnapshot,
	missionFromSnapshot,
	updateWorkflowState,
} from "../control-plane/state.ts";
import { cleanupClosedWorkflow } from "../control-plane/cleanup.ts";
import {
	activeSliceId,
	buildDispatchKey,
	buildDispatchKeyForContext,
	readDispatchInFlight,
	resolveGitHead,
	shouldAutoClearInFlight,
} from "./dispatch-key.ts";
import { mandatoryNextRoleAfterCompletion, resolveMandatoryDispatch } from "./mandatory-dispatch.ts";
import {
	parseReportFields,
	stopJudgeHistoryRecord,
	validateRoleReport,
} from "./role-transcription.ts";

const ROLE_SET = new Set<string>([
	"completion-bootstrapper",
	"completion-regrounder",
	"completion-implementer",
	"completion-reviewer",
	"completion-auditor",
	"completion-stop-judge",
]);

function isCompletionRole(value: string | undefined): value is CompletionRole {
	return Boolean(value && ROLE_SET.has(value));
}

function readRoleFromState(snapshot: WorkflowSnapshot): CompletionRole | null {
	const role = asString(snapshot.state.next_mandatory_role);
	return isCompletionRole(role) ? role : null;
}

function buildRoleSystemContext(snapshot: WorkflowSnapshot, role: CompletionRole): string {
	const mission = missionFromSnapshot(snapshot);
	const lines = [
		`COMPLETION ROLE: ${role}`,
		`Protocol: letscook / completion-workflow (Cursor-native orchestrator)`,
		`Mission anchor: ${mission}`,
		`Task type: ${asString(snapshot.state.task_type) ?? "completion-workflow"}`,
		`Evaluation profile: ${asString(snapshot.state.evaluation_profile) ?? "completion-rubric-v1"}`,
		"",
		"Follow completion-protocol mandatory dispatch and rubric transcription rules.",
		"Load the completion-protocol skill from the letscook plugin when executing this role.",
		"",
		"Canonical files to re-read before acting:",
		"- .agent/current/state.json",
		"- .agent/current/startup-brief.json",
		"- .agent/current/plan.json",
		"- .agent/current/active-slice.json",
		"- .agent/current/verification-evidence.json",
	];
	if (role === "completion-implementer") {
		lines.push("", "Authority: you may edit product code and create the slice commit.");
	} else if (role === "completion-reviewer" || role === "completion-auditor" || role === "completion-stop-judge") {
		lines.push("", "Authority: read-only. Do not edit product files or create commits.");
	} else if (role === "completion-bootstrapper" || role === "completion-regrounder") {
		lines.push("", "Authority: may edit .agent/** control-plane files only unless protocol requires otherwise.");
	}
	return lines.join("\n");
}

function buildRoleTaskPrompt(snapshot: WorkflowSnapshot, role: CompletionRole): string {
	const mission = missionFromSnapshot(snapshot);
	const activeStatus = asString(snapshot.active.status) ?? "idle";
	const sliceGoal = asString(snapshot.active.goal);
	const parts = [`Execute the ${role} responsibilities for mission: ${mission}`];
	if (sliceGoal) parts.push(`Active slice goal: ${sliceGoal}`);
	parts.push(`Active slice status: ${activeStatus}`);
	parts.push(
		"",
		"Return a structured role report with at minimum:",
		"- role",
		"- verdict or outcome",
		"- summary",
		"- blockers (if any)",
		"- recommended_next_role (advisory only; orchestrator decides dispatch)",
	);
	if (role === "completion-regrounder") {
		parts.push("", "Reconcile canonical plan/active-slice from repo truth. Select next slice if appropriate.");
	}
	if (role === "completion-implementer") {
		parts.push("", "Implement the active slice, run verification commands, and land one commit for the slice.");
	}
	if (role === "completion-auditor") {
		parts.push(
			"",
			"This is a fresh audit of the whole project at HEAD.",
			"Re-read canonical .agent/** state and repo truth yourself.",
			"Do not treat a prior reviewer report as your working context.",
			"State why the project is still not done, whether the backlog is truthful, and whether the tracked worktree is clean.",
		);
	}
	return parts.join("\n");
}

function closedDispatch(
	workspaceRoot: string,
	partial: Partial<WorkflowDispatch> & { reason: string },
): WorkflowDispatch {
	const { reason, next_steps, ...rest } = partial;
	return {
		workspace_root: workspaceRoot,
		role: null,
		dispatch_allowed: false,
		reason,
		system_context: "",
		task_prompt: "",
		cursor_agent: "",
		subagent_type: "generalPurpose",
		in_flight: null,
		claim_required: false,
		next_steps: next_steps ?? [],
		...rest,
	};
}

type DispatchContext = {
	snapshot: WorkflowSnapshot;
	role: CompletionRole;
	headSha: string;
	sliceId: string | null;
	dispatchKey: string;
	inFlight: ReturnType<typeof readDispatchInFlight>;
};

async function resolveDispatchContext(
	workspaceRoot: string,
	snapshot: WorkflowSnapshot,
): Promise<DispatchContext | WorkflowDispatch> {
	const entryStatus = asString(snapshot.state.workflow_entry_status);
	const continuation = asString(snapshot.state.continuation_policy);
	if (entryStatus === "parked" || continuation === "paused") {
		return closedDispatch(workspaceRoot, {
			reason: "workflow_parked",
			continuation_policy: continuation,
			workflow_entry_status: entryStatus,
			next_steps: ["Resume with resume_workflow, then call get_workflow_dispatch again"],
		});
	}
	if (entryStatus === "cancelled" || continuation === "done" || snapshot.state.project_done === true) {
		return closedDispatch(workspaceRoot, {
			reason: "workflow_closed",
			workflow_entry_status: entryStatus,
			continuation_policy: continuation,
			workflow_closed: true,
			next_steps: ["Workflow is done or cancelled"],
		});
	}

	let role = readRoleFromState(snapshot);
	if (!role) {
		const mandatory = resolveMandatoryDispatch(snapshot);
		if (mandatory.role) {
			await updateWorkflowState(workspaceRoot, {
				next_mandatory_role: mandatory.role,
				next_mandatory_action: mandatory.action,
			});
			const reloaded = await loadWorkflowSnapshot(workspaceRoot);
			if (!reloaded) {
				return closedDispatch(workspaceRoot, {
					reason: "no_active_workflow",
					next_steps: ["Inspect .agent/current/state.json"],
				});
			}
			role = mandatory.role;
			snapshot = reloaded;
		} else {
			return closedDispatch(workspaceRoot, {
				reason: mandatory.reason,
				next_steps: ["Inspect .agent/current/state.json continuation_policy and blockers"],
			});
		}
	}

	const headSha = resolveGitHead(workspaceRoot);
	if (!headSha) {
		return closedDispatch(workspaceRoot, {
			reason: "git_head_unavailable",
			role,
			next_steps: ["Ensure workspace_root is a git repository with a valid HEAD"],
		});
	}

	const sliceId = activeSliceId(snapshot);
	const dispatchKey = buildDispatchKeyForContext(role, sliceId, headSha, snapshot);
	let inFlight = readDispatchInFlight(snapshot);

	if (inFlight && shouldAutoClearInFlight(inFlight, role, sliceId, headSha)) {
		await updateWorkflowState(workspaceRoot, { dispatch_in_flight: null });
		inFlight = null;
	}

	return { snapshot, role, headSha, sliceId, dispatchKey, inFlight };
}

function buildReadyDispatch(
	workspaceRoot: string,
	ctx: DispatchContext,
	options?: { claimed?: boolean; suppressReason?: string },
): WorkflowDispatch {
	const { snapshot, role, headSha, sliceId, dispatchKey, inFlight } = ctx;
	const continuation = asString(snapshot.state.continuation_policy);
	const entryStatus = asString(snapshot.state.workflow_entry_status);

	let dispatchAllowed = true;
	let reason = options?.claimed ? "dispatch_claimed" : "dispatch_ready";

	if (options?.claimed) {
		dispatchAllowed = true;
		reason = "dispatch_claimed";
	} else if (options?.suppressReason) {
		dispatchAllowed = false;
		reason = options.suppressReason;
	} else if (inFlight) {
		const sameDispatch = inFlight.role === role && inFlight.slice_id === sliceId;
		dispatchAllowed = false;
		reason = sameDispatch ? "role_in_flight" : "stale_in_flight";
	}

	const inFlightInfo = inFlight
		? {
				role: inFlight.role,
				slice_id: inFlight.slice_id,
				head_sha: inFlight.head_sha,
				claimed_at: inFlight.claimed_at,
				dispatch_key: inFlight.dispatch_key,
			}
		: null;

	const nextSteps = dispatchAllowed
		? options?.claimed
			? [
					`Invoke one Task with subagent_type "${role}" (not generalPurpose)`,
					`Pass system_context + task_prompt in the invocation`,
					`After the agent completes, call submit_role_result({ workspace_root, role: "${role}", raw_output })`,
				]
			: [
					`Call claim_workflow_dispatch({ workspace_root }) before dispatching Task`,
					`Then invoke one Task with subagent_type "${role}" (not generalPurpose) and system_context + task_prompt`,
					`After the agent completes, call submit_role_result({ workspace_root, role: "${role}", raw_output })`,
				]
		: reason === "role_in_flight"
			? [
					"Wait for the in-flight subagent to finish",
					"Call submit_role_result with its output before claiming again",
				]
			: [`Inspect dispatch reason: ${reason}`];

	return {
		workspace_root: workspaceRoot,
		role,
		dispatch_allowed: dispatchAllowed,
		reason,
		system_context: buildRoleSystemContext(snapshot, role),
		task_prompt: buildRoleTaskPrompt(snapshot, role),
		cursor_agent: role,
		subagent_type: role,
		continuation_policy: continuation,
		workflow_entry_status: entryStatus,
		driver_continue:
			dispatchAllowed &&
			(continuation === "continue" || !continuation) &&
			options?.claimed === true,
		driver_continue_reason:
			dispatchAllowed && continuation === "continue" && options?.claimed
				? "Dispatch the claimed bundled agent Task; submit with the returned dispatch_key"
				: undefined,
		dispatch_key: options?.claimed && inFlight ? inFlight.dispatch_key : dispatchKey,
		head_sha: headSha,
		slice_id: sliceId,
		in_flight: inFlightInfo,
		claim_required: dispatchAllowed && !options?.claimed,
		next_steps: nextSteps,
	};
}

export async function getWorkflowDispatch(workspaceRoot: string): Promise<WorkflowDispatch> {
	const snapshot = await loadWorkflowSnapshot(workspaceRoot);
	if (!snapshot) {
		return closedDispatch(workspaceRoot, {
			reason: "no_active_workflow",
			next_steps: ["Call confirm_cook_handoff after handoff confirmation to scaffold .agent/ state"],
		});
	}

	const ctx = await resolveDispatchContext(workspaceRoot, snapshot);
	if (!("role" in ctx && "dispatchKey" in ctx)) {
		return ctx as WorkflowDispatch;
	}

	return buildReadyDispatch(workspaceRoot, ctx);
}

export type ClaimWorkflowDispatchInput = {
	workspace_root: string;
	force?: boolean;
};

export async function claimWorkflowDispatch(input: ClaimWorkflowDispatchInput): Promise<JsonRecord> {
	const workspaceRoot = input.workspace_root;
	const snapshot = await loadWorkflowSnapshot(workspaceRoot);
	if (!snapshot) {
		return { ok: false, reason: "no_active_workflow" };
	}

	const ctx = await resolveDispatchContext(workspaceRoot, snapshot);
	if (!("role" in ctx && "dispatchKey" in ctx)) {
		const closed = ctx as WorkflowDispatch;
		return { ok: false, reason: closed.reason, dispatch: closed };
	}

	const { role, headSha, sliceId, dispatchKey, inFlight, snapshot: currentSnapshot } = ctx;

	if (inFlight && inFlight.role === role && inFlight.slice_id === sliceId) {
		if (!input.force) {
			const dispatch = buildReadyDispatch(workspaceRoot, ctx, { suppressReason: "role_in_flight" });
			return { ok: false, reason: "role_in_flight", dispatch };
		}

		const forceAllowed =
			role === "completion-implementer"
				? inFlight.slice_id === sliceId && inFlight.head_sha === headSha
				: inFlight.head_sha !== headSha;
		if (!forceAllowed) {
			const dispatch = buildReadyDispatch(workspaceRoot, ctx, { suppressReason: "role_in_flight" });
			return { ok: false, reason: "force_redispatch_not_allowed", dispatch };
		}
		if (role !== "completion-implementer") {
			await updateWorkflowState(workspaceRoot, { dispatch_in_flight: null });
		}
	} else if (inFlight) {
		const dispatch = buildReadyDispatch(workspaceRoot, ctx, { suppressReason: "stale_in_flight" });
		return { ok: false, reason: "stale_in_flight", dispatch };
	}

	const claimedAt = new Date().toISOString();
	const claimId = randomUUID().slice(0, 8);
	const claimedDispatchKey = `${dispatchKey}:${claimId}`;
	const dispatchInFlight = {
		role,
		slice_id: sliceId,
		head_sha: headSha,
		claimed_at: claimedAt,
		dispatch_key: claimedDispatchKey,
	};

	await updateWorkflowState(workspaceRoot, { dispatch_in_flight: dispatchInFlight });
	await appendJsonl(currentSnapshot.files.workflowEventsPath, {
		event_id: randomUUID(),
		timestamp: claimedAt,
		type: "dispatch_claimed",
		role,
		dispatch_key: claimedDispatchKey,
		head_sha: headSha,
		slice_id: sliceId,
		force: input.force === true,
	});

	const refreshed = await loadWorkflowSnapshot(workspaceRoot);
	if (!refreshed) {
		return { ok: false, reason: "no_active_workflow" };
	}

	const refreshedCtx: DispatchContext = {
		...ctx,
		snapshot: refreshed,
		inFlight: readDispatchInFlight(refreshed),
	};
	const dispatch = buildReadyDispatch(workspaceRoot, refreshedCtx, { claimed: true });

	return {
		ok: true,
		reason: "dispatch_claimed",
		dispatch,
		dispatch_key: claimedDispatchKey,
		in_flight: dispatchInFlight,
	};
}

function parseReportFieldsFromOutput(rawOutput: string): JsonRecord {
	return parseReportFields(rawOutput);
}

function applyRoleCompletionState(
	role: CompletionRole,
	snapshot: WorkflowSnapshot,
	reportFields: JsonRecord,
): JsonRecord {
	const patch: JsonRecord = {
		last_completed_role: role,
		last_role_completed_at: new Date().toISOString(),
		dispatch_in_flight: null,
	};
	const snapshotAlreadyClosed =
		asString(snapshot.state.workflow_entry_status) === "done" ||
		asString(snapshot.state.workflow_entry_status) === "cancelled" ||
		asString(snapshot.state.continuation_policy) === "done" ||
		snapshot.state.project_done === true;
	if (snapshotAlreadyClosed) {
		return {
			...patch,
			project_done: true,
			continuation_policy: "done",
			next_mandatory_role: null,
			next_mandatory_action: "Workflow complete",
		};
	}

	let nextRole = mandatoryNextRoleAfterCompletion(role, snapshot, reportFields);

	if (role === "completion-stop-judge") {
		const remaining = typeof snapshot.state.remaining_stop_judges === "number" ? snapshot.state.remaining_stop_judges : 2;
		const nextRemaining = Math.max(0, remaining - 1);
		patch.remaining_stop_judges = nextRemaining;
		const verdict = asString(reportFields.verdict)?.toLowerCase() ?? asString(reportFields["Can the project stop now"])?.toLowerCase();
		if (nextRemaining > 0 && verdict !== "can_stop" && !verdict?.startsWith("yes")) {
			nextRole = "completion-stop-judge";
		} else if (nextRemaining > 0) {
			nextRole = "completion-stop-judge";
		}
	}

	if (role === "completion-implementer") {
		patch.current_phase = "review";
		patch.requires_reground = false;
	}

	if (role === "completion-regrounder") {
		patch.requires_reground = false;
		patch.last_reground_at = new Date().toISOString();
		const activeStatus = asString(snapshot.active.status)?.toLowerCase();
		if (activeStatus === "selected" || activeStatus === "in_progress") {
			nextRole = "completion-implementer";
		} else if (snapshot.state.requires_reground === true || asString(snapshot.state.current_phase) === "reground") {
			nextRole = "completion-implementer";
		}
	}

	if (!nextRole) {
		patch.project_done = true;
		patch.continuation_policy = "done";
		patch.workflow_entry_status = "done";
		patch.next_mandatory_role = null;
		patch.next_mandatory_action = "Workflow complete";
		return patch;
	}

	const mandatory = resolveMandatoryDispatch({ ...snapshot, state: { ...snapshot.state, ...patch } });
	patch.next_mandatory_role = nextRole ?? mandatory.role;
	patch.next_mandatory_action = mandatory.action ?? `Dispatch ${patch.next_mandatory_role}`;
	patch.continuation_policy = "continue";
	return patch;
}

export type SubmitRoleResultInput = {
	workspace_root: string;
	role: string;
	raw_output: string;
	dispatch_key?: string;
	ok?: boolean;
	structured?: JsonRecord;
};

export async function submitRoleResult(input: SubmitRoleResultInput): Promise<JsonRecord> {
	if (!isCompletionRole(input.role)) {
		throw new Error(`unsupported role: ${input.role}`);
	}
	const snapshot = await loadWorkflowSnapshot(input.workspace_root);
	if (!snapshot) throw new Error("no active workflow");

	const expected = readRoleFromState(snapshot);
	if (expected && expected !== input.role) {
		throw new Error(`role mismatch: expected ${expected}, got ${input.role}`);
	}

	const inFlight = readDispatchInFlight(snapshot);
	if (!inFlight) {
		throw new Error("dispatch not claimed: call claim_workflow_dispatch before submit_role_result");
	}
	if (inFlight.role !== input.role) {
		throw new Error(`dispatch in-flight role mismatch: expected ${inFlight.role}, got ${input.role}`);
	}

	const headSha = resolveGitHead(input.workspace_root);
	const sliceId = activeSliceId(snapshot);
	if (input.role === "completion-implementer" && inFlight.slice_id !== sliceId) {
		throw new Error(
			`dispatch slice mismatch: expected ${inFlight.slice_id ?? "none"}, got ${sliceId ?? "none"}`,
		);
	}
	if (!input.dispatch_key || input.dispatch_key !== inFlight.dispatch_key) {
		throw new Error(
			`dispatch_key mismatch: expected active claim ${inFlight.dispatch_key}, got ${input.dispatch_key ?? "none"}`,
		);
	}

	const transcriptDispatchKey = inFlight.dispatch_key;

	const reportFields = {
			...parseReportFieldsFromOutput(input.raw_output),
			...(input.structured ?? {}),
		};
		const transcriptionErrors = validateRoleReport(input.role, input.raw_output, reportFields as Record<string, string>);
		if (transcriptionErrors.length > 0 && input.ok !== false) {
			throw new Error(`role report failed transcription: ${transcriptionErrors.join("; ")}`);
		}
		const transcript = {
			event_id: randomUUID(),
			timestamp: new Date().toISOString(),
			role: input.role,
			ok: input.ok !== false,
			summary: asString(reportFields.summary) ?? input.raw_output.slice(0, 500),
			verdict: asString(reportFields.verdict) ?? asString(reportFields.outcome),
			head_sha: headSha ?? null,
			slice_id: sliceId,
			dispatch_key: transcriptDispatchKey,
			report_fields: reportFields,
		};
		await appendJsonl(snapshot.files.sliceHistoryPath, transcript);
		const stopRecord = stopJudgeHistoryRecord({
			role: input.role,
			reportFields: reportFields as Record<string, string>,
			waveId: typeof snapshot.state.current_stop_wave_id === "number" ? snapshot.state.current_stop_wave_id : 0,
		});
		if (stopRecord) {
			await appendJsonl(snapshot.files.stopHistoryPath, stopRecord);
		}
		await appendJsonl(snapshot.files.workflowEventsPath, {
			event_id: randomUUID(),
			timestamp: new Date().toISOString(),
			type: "role_completed",
			role: input.role,
			verdict: transcript.verdict,
			dispatch_key: transcriptDispatchKey,
		});

		const statePatch = applyRoleCompletionState(input.role, snapshot, reportFields);
		const updated = await updateWorkflowState(input.workspace_root, statePatch);
		const dispatch = await getWorkflowDispatch(input.workspace_root);
		const workflowClosed =
			updated.state.project_done === true ||
			asString(updated.state.continuation_policy) === "done" ||
			asString(updated.state.workflow_entry_status) === "done" ||
			asString(updated.state.workflow_entry_status) === "cancelled";

		const driverContinue =
			dispatch.dispatch_allowed === true &&
			dispatch.workflow_closed !== true &&
			(dispatch.continuation_policy === "continue" || !dispatch.continuation_policy);
		const cleanup = workflowClosed
			? await cleanupClosedWorkflow(
					input.workspace_root,
					asString(updated.state.workflow_session_id),
				)
			: undefined;

		return {
			ok: true,
			role: input.role,
			transcript,
			state_patch: statePatch,
			next_mandatory_role: asString(updated.state.next_mandatory_role),
			workflow_closed: workflowClosed,
			closure: workflowClosed
				? {
						status: asString(updated.state.workflow_entry_status) ?? "done",
						workflow_session_id: asString(updated.state.workflow_session_id),
						head_sha: headSha ?? null,
						reason: asString(updated.state.continuation_reason) ?? "workflow_complete",
					}
				: undefined,
			cleanup,
			driver_continue: driverContinue,
			driver_continue_reason: driverContinue
				? "continuation_policy requires preflight + claim before next dispatch"
				: undefined,
			dispatch,
		};
}

export async function parkWorkflow(workspaceRoot: string, reason?: string): Promise<JsonRecord> {
	const snapshot = await loadWorkflowSnapshot(workspaceRoot);
	if (!snapshot) throw new Error("no active workflow");
	if (readDispatchInFlight(snapshot)) {
		throw new Error(
			"cannot park while dispatch_in_flight is set: submit the in-flight role or wait for its Task to finish",
		);
	}
	const updated = await updateWorkflowState(workspaceRoot, {
		workflow_entry_status: "parked",
		continuation_policy: "paused",
		continuation_reason: reason ?? "Parked via letscook MCP",
		requires_reground: true,
		next_mandatory_role: "completion-regrounder",
		dispatch_in_flight: null,
	});
	return { ok: true, state: updated.state };
}

export async function resumeWorkflow(workspaceRoot: string): Promise<JsonRecord> {
	const snapshot = await loadWorkflowSnapshot(workspaceRoot);
	if (!snapshot) throw new Error("no active workflow");
	if (readDispatchInFlight(snapshot)) {
		throw new Error(
			"cannot resume while dispatch_in_flight is set: submit the in-flight role or wait for its Task to finish",
		);
	}
	const updated = await updateWorkflowState(workspaceRoot, {
		workflow_entry_status: "active",
		continuation_policy: "continue",
		requires_reground: true,
		next_mandatory_role: "completion-regrounder",
		continuation_reason: "Resumed via letscook MCP; canonical reground required",
		dispatch_in_flight: null,
	});
	const dispatch = await getWorkflowDispatch(workspaceRoot);
	return { ok: true, state: updated.state, dispatch };
}

export async function cancelWorkflow(workspaceRoot: string, reason?: string): Promise<JsonRecord> {
	const snapshot = await loadWorkflowSnapshot(workspaceRoot);
	if (!snapshot) throw new Error("no active workflow");
	if (readDispatchInFlight(snapshot)) {
		throw new Error(
			"cannot cancel while dispatch_in_flight is set: submit the in-flight role or wait for its Task to finish",
		);
	}
	const updated = await updateWorkflowState(workspaceRoot, {
		workflow_entry_status: "cancelled",
		continuation_policy: "done",
		project_done: true,
		next_mandatory_role: null,
		continuation_reason: reason ?? "Cancelled via letscook MCP",
		dispatch_in_flight: null,
	});
	const cleanup = await cleanupClosedWorkflow(
		workspaceRoot,
		asString(updated.state.workflow_session_id),
	);
	return {
		ok: true,
		workflow_closed: true,
		closure: {
			status: "cancelled",
			workflow_session_id: asString(updated.state.workflow_session_id),
			reason: asString(updated.state.continuation_reason),
		},
		cleanup,
	};
}

export async function readWorkflowEvents(workspaceRoot: string): Promise<JsonRecord[]> {
	const snapshot = await loadWorkflowSnapshot(workspaceRoot);
	if (!snapshot) return [];
	try {
		const raw = await fsp.readFile(snapshot.files.workflowEventsPath, "utf8");
		return raw
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as JsonRecord);
	} catch {
		return [];
	}
}

export async function pollWorkflowUpdates(workspaceRoot: string, sinceEventId?: string): Promise<JsonRecord> {
	const events = await readWorkflowEvents(workspaceRoot);
	const sinceIndex = sinceEventId ? events.findIndex((e) => e.event_id === sinceEventId) : -1;
	const delta = sinceIndex >= 0 ? events.slice(sinceIndex + 1) : events;
	const status = await getWorkflowStatus(workspaceRoot);
	return {
		workspace_root: workspaceRoot,
		since_event_id: sinceEventId ?? null,
		events: delta,
		last_event_id: events.at(-1)?.event_id,
		status,
	};
}

export async function getWorkflowStatus(workspaceRoot: string): Promise<JsonRecord> {
	const snapshot = await loadWorkflowSnapshot(workspaceRoot);
	if (!snapshot) {
		return { ok: false, error: "workflow_not_found" };
	}
	const slices = Array.isArray(snapshot.plan.candidate_slices) ? snapshot.plan.candidate_slices : [];
	const done = slices.filter((s) => {
		const status = asString((s as JsonRecord).status)?.toLowerCase();
		return status === "done";
	}).length;
	const inFlight = readDispatchInFlight(snapshot);
	return {
		ok: true,
		workspace_root: workspaceRoot,
		mission: missionFromSnapshot(snapshot),
		workflow_entry_status: asString(snapshot.state.workflow_entry_status),
		continuation_policy: asString(snapshot.state.continuation_policy),
		next_mandatory_role: asString(snapshot.state.next_mandatory_role),
		dispatch_in_flight: inFlight,
		active_slice: {
			id: asString(snapshot.active.slice_id),
			goal: asString(snapshot.active.goal),
			status: asString(snapshot.active.status),
		},
		slices_done: done,
		slices_total: slices.length,
		project_done: snapshot.state.project_done === true,
	};
}
