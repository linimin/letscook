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

function subagentTypeForRole(role: CompletionRole): WorkflowDispatch["subagent_type"] {
	if (role === "completion-implementer" || role === "completion-bootstrapper") return "generalPurpose";
	if (role === "completion-regrounder") return "generalPurpose";
	return "explore";
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
			subagent_type: "generalPurpose",
			next_steps: ["Call start_cook_workflow after handoff confirmation to scaffold .agent/ state"],
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
			subagent_type: "generalPurpose",
			workflow_entry_status: entryStatus,
			continuation_policy: continuation,
			next_steps: ["Workflow is done or cancelled"],
		};
	}

	const role = readRoleFromState(snapshot);
	if (!role) {
		return {
			workspace_root: workspaceRoot,
			role: null,
			dispatch_allowed: false,
			reason: "missing_next_mandatory_role",
			system_context: "",
			task_prompt: "",
			subagent_type: "generalPurpose",
			next_steps: ["Inspect .agent/current/state.json and repair next_mandatory_role"],
		};
	}

	return {
		workspace_root: workspaceRoot,
		role,
		dispatch_allowed: true,
		reason: "dispatch_ready",
		system_context: buildRoleSystemContext(snapshot, role),
		task_prompt: buildRoleTaskPrompt(snapshot, role),
		subagent_type: subagentTypeForRole(role),
		continuation_policy: continuation,
		workflow_entry_status: entryStatus,
		next_steps: [
			`Dispatch a Cursor subagent (Task tool) for ${role}`,
			`After completion, call submit_role_result with role and output`,
		],
	};
}

function parseReportFields(rawOutput: string): JsonRecord {
	const fields: JsonRecord = {};
	const patterns: Array<[string, RegExp]> = [
		["role", /^role:\s*(.+)$/im],
		["verdict", /^verdict:\s*(.+)$/im],
		["outcome", /^outcome:\s*(.+)$/im],
		["summary", /^summary:\s*(.+)$/im],
		["recommended_next_role", /^recommended_next_role:\s*(.+)$/im],
	];
	for (const [key, pattern] of patterns) {
		const match = rawOutput.match(pattern);
		if (match?.[1]) fields[key] = match[1].trim();
	}
	return fields;
}

function defaultNextRoleAfter(role: CompletionRole, snapshot: WorkflowSnapshot): CompletionRole | null {
	switch (role) {
		case "completion-bootstrapper":
			return "completion-regrounder";
		case "completion-regrounder": {
			const activeStatus = asString(snapshot.active.status)?.toLowerCase();
			if (activeStatus === "selected" || activeStatus === "in_progress") return "completion-implementer";
			if (snapshot.state.requires_reground === true || asString(snapshot.state.current_phase) === "reground") {
				return "completion-implementer";
			}
			const remaining = typeof snapshot.state.remaining_stop_judges === "number" ? snapshot.state.remaining_stop_judges : 0;
			if (remaining > 0) return "completion-stop-judge";
			return null;
		}
		case "completion-implementer":
			return "completion-reviewer";
		case "completion-reviewer":
			return "completion-auditor";
		case "completion-auditor":
			return "completion-regrounder";
		case "completion-stop-judge":
			return "completion-regrounder";
		default:
			return "completion-regrounder";
	}
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
	let nextRole = defaultNextRoleAfter(role, snapshot);
	const advisory = asString(reportFields.recommended_next_role);
	if (isCompletionRole(advisory)) nextRole = advisory;

	if (role === "completion-stop-judge") {
		const remaining = typeof snapshot.state.remaining_stop_judges === "number" ? snapshot.state.remaining_stop_judges : 2;
		const nextRemaining = Math.max(0, remaining - 1);
		patch.remaining_stop_judges = nextRemaining;
		if (nextRemaining > 0 && (asString(reportFields.verdict)?.toLowerCase() !== "can_stop")) {
			nextRole = "completion-stop-judge";
		}
	}

	if (role === "completion-implementer") {
		patch.current_phase = "review";
	}

	if (!nextRole) {
		patch.project_done = true;
		patch.continuation_policy = "done";
		patch.workflow_entry_status = "done";
		patch.next_mandatory_role = null;
		patch.next_mandatory_action = "Workflow complete";
		return patch;
	}

	patch.next_mandatory_role = nextRole;
	patch.next_mandatory_action = `Dispatch ${nextRole}`;
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
		...parseReportFields(input.raw_output),
		...(input.structured ?? {}),
	};
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

	return {
		ok: true,
		role: input.role,
		transcript,
		state_patch: statePatch,
		next_mandatory_role: asString(updated.state.next_mandatory_role),
		workflow_closed: updated.state.project_done === true,
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
