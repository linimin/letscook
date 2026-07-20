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
		`Protocol: pi-letscook / completion-workflow (Cursor-native orchestrator)`,
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
	return parts.join("\n");
}

export async function getWorkflowDispatch(workspaceRoot: string): Promise<WorkflowDispatch> {
	const snapshot = await loadWorkflowSnapshot(workspaceRoot);
	if (!snapshot) {
		return {
			workspace_root: workspaceRoot,
			role: null,
			dispatch_allowed: false,
			reason: "no_active_workflow",
			system_context: "",
			task_prompt: "",
			cursor_agent: "",
			subagent_type: "generalPurpose",
			next_steps: ["Call confirm_cook_handoff after handoff confirmation to scaffold .agent/ state"],
		};
	}

	const entryStatus = asString(snapshot.state.workflow_entry_status);
	const continuation = asString(snapshot.state.continuation_policy);
	if (entryStatus === "parked" || continuation === "paused") {
		return {
			workspace_root: workspaceRoot,
			role: null,
			dispatch_allowed: false,
			reason: "workflow_parked",
			system_context: "",
			task_prompt: "",
			cursor_agent: "",
			subagent_type: "generalPurpose",
			continuation_policy: continuation,
			workflow_entry_status: entryStatus,
			next_steps: ["Resume with resume_workflow, then call get_workflow_dispatch again"],
		};
	}
	if (entryStatus === "cancelled" || continuation === "done" || snapshot.state.project_done === true) {
		return {
			workspace_root: workspaceRoot,
			role: null,
			dispatch_allowed: false,
			reason: "workflow_closed",
			system_context: "",
			task_prompt: "",
			cursor_agent: "",
			subagent_type: "generalPurpose",
			workflow_entry_status: entryStatus,
			continuation_policy: continuation,
			next_steps: ["Workflow is done or cancelled"],
		};
	}

	const role = readRoleFromState(snapshot);
	if (!role) {
		const mandatory = resolveMandatoryDispatch(snapshot);
		if (mandatory.role) {
			await updateWorkflowState(workspaceRoot, {
				next_mandatory_role: mandatory.role,
				next_mandatory_action: mandatory.action,
			});
			return getWorkflowDispatch(workspaceRoot);
		}
		return {
			workspace_root: workspaceRoot,
			role: null,
			dispatch_allowed: false,
			reason: mandatory.reason,
			system_context: "",
			task_prompt: "",
			cursor_agent: "",
			subagent_type: "generalPurpose",
			next_steps: ["Inspect .agent/current/state.json continuation_policy and blockers"],
		};
	}

	return {
		workspace_root: workspaceRoot,
		role,
		dispatch_allowed: true,
		reason: "dispatch_ready",
		system_context: buildRoleSystemContext(snapshot, role),
		task_prompt: buildRoleTaskPrompt(snapshot, role),
		cursor_agent: role,
		subagent_type: role,
		continuation_policy: continuation,
		workflow_entry_status: entryStatus,
		driver_continue: continuation === "continue" || !continuation,
		driver_continue_reason:
			continuation === "continue"
				? "Dispatch this role now; do not end the turn or ask the user whether to continue"
				: undefined,
		next_steps: [
			`Invoke bundled agent "${role}" from the letscook plugin (Task/subagent delegation)`,
			`Pass system_context + task_prompt in the invocation`,
			`After the agent completes, call submit_role_result({ workspace_root, role: "${role}", raw_output })`,
		],
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
	};
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
	});

	const statePatch = applyRoleCompletionState(input.role, snapshot, reportFields);
	const updated = await updateWorkflowState(input.workspace_root, statePatch);
	const dispatch = await getWorkflowDispatch(input.workspace_root);

	const driverContinue =
		dispatch.dispatch_allowed === true &&
		dispatch.workflow_closed !== true &&
		(dispatch.continuation_policy === "continue" || !dispatch.continuation_policy);

	return {
		ok: true,
		role: input.role,
		transcript,
		state_patch: statePatch,
		next_mandatory_role: asString(updated.state.next_mandatory_role),
		workflow_closed: updated.state.project_done === true,
		driver_continue: driverContinue,
		driver_continue_reason: driverContinue
			? "continuation_policy requires immediate next dispatch without asking the user"
			: undefined,
		dispatch,
	};
}

export async function parkWorkflow(workspaceRoot: string, reason?: string): Promise<JsonRecord> {
	const snapshot = await loadWorkflowSnapshot(workspaceRoot);
	if (!snapshot) throw new Error("no active workflow");
	const updated = await updateWorkflowState(workspaceRoot, {
		workflow_entry_status: "parked",
		continuation_policy: "paused",
		continuation_reason: reason ?? "Parked via letscook MCP",
		requires_reground: true,
		next_mandatory_role: "completion-regrounder",
	});
	return { ok: true, state: updated.state };
}

export async function resumeWorkflow(workspaceRoot: string): Promise<JsonRecord> {
	const snapshot = await loadWorkflowSnapshot(workspaceRoot);
	if (!snapshot) throw new Error("no active workflow");
	const updated = await updateWorkflowState(workspaceRoot, {
		workflow_entry_status: "active",
		continuation_policy: "continue",
		requires_reground: true,
		next_mandatory_role: "completion-regrounder",
		continuation_reason: "Resumed via letscook MCP; canonical reground required",
	});
	const dispatch = await getWorkflowDispatch(workspaceRoot);
	return { ok: true, state: updated.state, dispatch };
}

export async function cancelWorkflow(workspaceRoot: string, reason?: string): Promise<JsonRecord> {
	const snapshot = await loadWorkflowSnapshot(workspaceRoot);
	if (!snapshot) throw new Error("no active workflow");
	const updated = await updateWorkflowState(workspaceRoot, {
		workflow_entry_status: "cancelled",
		continuation_policy: "done",
		project_done: true,
		next_mandatory_role: null,
		continuation_reason: reason ?? "Cancelled via letscook MCP",
	});
	return { ok: true, state: updated.state };
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
	return {
		ok: true,
		workspace_root: workspaceRoot,
		mission: missionFromSnapshot(snapshot),
		workflow_entry_status: asString(snapshot.state.workflow_entry_status),
		continuation_policy: asString(snapshot.state.continuation_policy),
		next_mandatory_role: asString(snapshot.state.next_mandatory_role),
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
