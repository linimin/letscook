import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import type { AgentPaths, JsonRecord, WorkflowSnapshot } from "../types.ts";
import {
	buildVerifyControlPlaneScript,
	buildVerifyStopScript,
	detectVerifierCommand,
} from "./verify-scripts.ts";

const PROTOCOL_ID = "completion";
const DEFAULT_TASK_TYPE = "completion-workflow";
const DEFAULT_EVALUATION_PROFILE = "completion-rubric-v1";
const DEFAULT_REQUIRED_STOP_JUDGES = 2;
const DEFAULT_STOP_AGGREGATION_POLICY = "unanimous-current-head-v1";

export function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function asStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		: [];
}

export function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveAgentPaths(root: string): AgentPaths {
	const agentDir = path.join(root, ".agent");
	const currentDir = path.join(agentDir, "current");
	const tmpDir = path.join(agentDir, "tmp");
	return {
		root: path.resolve(root),
		agentDir,
		currentDir,
		tmpDir,
		statePath: path.join(currentDir, "state.json"),
		planPath: path.join(currentDir, "plan.json"),
		activePath: path.join(currentDir, "active-slice.json"),
		sliceHistoryPath: path.join(currentDir, "slice-history.jsonl"),
		stopHistoryPath: path.join(currentDir, "stop-check-history.jsonl"),
		startupBriefPath: path.join(currentDir, "startup-brief.json"),
		verificationEvidencePath: path.join(currentDir, "verification-evidence.json"),
		handoffPath: path.join(tmpDir, "cursor-handoff.json"),
		pendingSidecarPath: path.join(tmpDir, "cursor-handoff.pending.json"),
		workflowEventsPath: path.join(tmpDir, "workflow-events.jsonl"),
	};
}

async function readJsonFile(filePath: string): Promise<JsonRecord | undefined> {
	try {
		const raw = await fsp.readFile(filePath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
	await fsp.mkdir(path.dirname(filePath), { recursive: true });
	await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function appendJsonl(filePath: string, record: JsonRecord): Promise<void> {
	await fsp.mkdir(path.dirname(filePath), { recursive: true });
	await fsp.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function loadWorkflowSnapshot(root: string): Promise<WorkflowSnapshot | undefined> {
	const files = resolveAgentPaths(root);
	if (!fs.existsSync(files.statePath)) return undefined;
	const state = (await readJsonFile(files.statePath)) ?? {};
	const plan = (await readJsonFile(files.planPath)) ?? {};
	const active = (await readJsonFile(files.activePath)) ?? {};
	const startupBrief = (await readJsonFile(files.startupBriefPath)) ?? {};
	return { files, state, plan, active, startupBrief };
}

function buildWorkflowSessionId(): string {
	return `wf-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

export function defaultState(missionAnchor: string, routing?: { taskType?: string; evaluationProfile?: string }): JsonRecord {
	return {
		schema_version: 1,
		mission_anchor: missionAnchor,
		workflow_entry_status: "active",
		workflow_entry_source: "letscook-mcp",
		workflow_entry_confirmed_at: new Date().toISOString(),
		workflow_session_id: buildWorkflowSessionId(),
		startup_brief_path: ".agent/current/startup-brief.json",
		current_phase: "reground",
		continuation_policy: "continue",
		continuation_reason: "Fresh letscook bootstrap requires canonical re-ground",
		project_done: false,
		task_type: routing?.taskType ?? DEFAULT_TASK_TYPE,
		evaluation_profile: routing?.evaluationProfile ?? DEFAULT_EVALUATION_PROFILE,
		requires_reground: true,
		slices_since_last_reground: 0,
		remaining_release_blockers: null,
		remaining_high_value_gaps: null,
		unsatisfied_contract_ids: [],
		release_blocker_ids: [],
		next_mandatory_action: "Reconcile canonical state from current repo truth",
		next_mandatory_role: "completion-regrounder",
		remaining_stop_judges: DEFAULT_REQUIRED_STOP_JUDGES,
		current_stop_wave_id: 0,
		last_reground_at: null,
		last_auditor_verdict: null,
		contract_status: "unknown",
		latest_completed_slice: null,
		latest_verified_slice: null,
		orchestrator: "letscook-mcp",
	};
}

export function defaultPlan(missionAnchor: string, routing?: { taskType?: string; evaluationProfile?: string }): JsonRecord {
	return {
		schema_version: 1,
		mission_anchor: missionAnchor,
		task_type: routing?.taskType ?? DEFAULT_TASK_TYPE,
		evaluation_profile: routing?.evaluationProfile ?? DEFAULT_EVALUATION_PROFILE,
		last_reground_at: null,
		plan_basis: "letscook-handoff",
		candidate_slices: [],
	};
}

export function defaultActiveSlice(missionAnchor: string, routing?: { taskType?: string; evaluationProfile?: string }): JsonRecord {
	return {
		schema_version: 1,
		mission_anchor: missionAnchor,
		task_type: routing?.taskType ?? DEFAULT_TASK_TYPE,
		evaluation_profile: routing?.evaluationProfile ?? DEFAULT_EVALUATION_PROFILE,
		status: "idle",
		slice_id: null,
		goal: null,
		contract_ids: [],
		acceptance_criteria: [],
		priority: null,
		why_now: null,
		blocked_on: [],
		locked_notes: [],
		must_fix_findings: [],
		implementation_surfaces: [],
		verification_commands: [],
		basis_commit: null,
		remaining_contract_ids_before: [],
		release_blocker_count_before: null,
		high_value_gap_count_before: null,
	};
}

export function defaultStartupBrief(
	missionAnchor: string,
	handoff: JsonRecord,
	routing?: { taskType?: string; evaluationProfile?: string },
): JsonRecord {
	const capturedAt = asString(handoff.captured_at) ?? new Date().toISOString();
	return {
		schema_version: 1,
		artifact_type: "completion-startup-brief",
		source: asString(handoff.source) ?? "letscook-mcp",
		confirmed: true,
		confirmed_at: capturedAt,
		mission_anchor: missionAnchor,
		mission: asString(handoff.mission) ?? missionAnchor,
		goal_text: asString(handoff.goal_text) ?? `Mission: ${missionAnchor}`,
		scope: asStringArray(handoff.scope),
		constraints: asStringArray(handoff.constraints),
		non_goals: asStringArray(handoff.non_goals),
		acceptance: asStringArray(handoff.acceptance),
		risks: asStringArray(handoff.risks),
		notes:
			asStringArray(handoff.notes).length > 0
				? asStringArray(handoff.notes)
				: ["No additional startup notes were preserved for this workflow entry."],
		first_slice_goal_hint: asString(handoff.first_slice_goal),
		first_slice_non_goals_hint: asStringArray(handoff.first_slice_non_goals),
		implementation_surfaces_hint: asStringArray(handoff.implementation_surfaces),
		verification_commands_hint: asStringArray(handoff.verification_commands),
		why_this_slice_first_hint: asString(handoff.why_this_slice_first),
		verification_truth_mode: asString(handoff.verification_truth_mode),
		deterministic_verifier_ready:
			typeof handoff.deterministic_verifier_ready === "boolean" ? handoff.deterministic_verifier_ready : undefined,
		verification_latency: asString(handoff.verification_latency),
		verification_noise_risk: asString(handoff.verification_noise_risk),
		verifier_gap: asString(handoff.verifier_gap),
		recommended_first_slice_kind: asString(handoff.recommended_first_slice_kind),
		task_type: routing?.taskType ?? DEFAULT_TASK_TYPE,
		evaluation_profile: routing?.evaluationProfile ?? DEFAULT_EVALUATION_PROFILE,
		why_cook_now: asString(handoff.why_cook_now),
		handoff_source: "letscook-mcp",
	};
}

export function defaultVerificationEvidence(missionAnchor: string): JsonRecord {
	const idleSummary =
		"No deterministic verification evidence is recorded yet because no selected slice or current-HEAD verification subject exists.";
	return {
		schema_version: 1,
		artifact_type: "completion-verification-evidence",
		mission_anchor: missionAnchor,
		subject_type: "none",
		slice_id: null,
		goal: null,
		contract_ids: [],
		basis_commit: null,
		head_sha: null,
		verification_commands: [],
		outcome: "not_recorded",
		recorded_at: null,
		evidence_quality: { status: "not_recorded", summary: idleSummary },
		command_results: [],
		acceptance_coverage: [],
		flake_signals: [],
		open_gaps: [],
		basis_regression_required: false,
		basis_regression_status: "not_applicable",
		basis_regression_reason: "No selected slice or current-HEAD verification subject exists yet.",
		basis_regression_artifact_paths: [],
		summary: idleSummary,
		evidence: [],
	};
}

export function defaultProfileRecord(projectName: string): JsonRecord {
	return {
		schema_version: 1,
		protocol_id: PROTOCOL_ID,
		project_name: projectName,
		required_stop_judges: DEFAULT_REQUIRED_STOP_JUDGES,
		stop_aggregation_policy: DEFAULT_STOP_AGGREGATION_POLICY,
		priority_policy_id: "completion-default",
		task_type: DEFAULT_TASK_TYPE,
		evaluation_profile: DEFAULT_EVALUATION_PROFILE,
		docs_surfaces: [],
	};
}

export function sha256Hex(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function scaffoldWorkflowFromHandoff(
	root: string,
	handoff: JsonRecord,
	projectName: string,
): Promise<WorkflowSnapshot> {
	const files = resolveAgentPaths(root);
	const mission = asString(handoff.mission);
	if (!mission) throw new Error("handoff mission is required to scaffold workflow");
	const routing = {
		taskType: asString(handoff.task_type),
		evaluationProfile: asString(handoff.evaluation_profile),
	};
	const state = defaultState(mission, routing);
	const plan = defaultPlan(mission, routing);
	const active = defaultActiveSlice(mission, routing);
	const startupBrief = defaultStartupBrief(mission, handoff, routing);
	const verificationEvidence = defaultVerificationEvidence(mission);
	const profile = defaultProfileRecord(projectName);
	const verifierCommand = await detectVerifierCommand(root);
	const stopScriptPath = path.join(files.agentDir, "verify_completion_stop.sh");
	const controlPlaneScriptPath = path.join(files.agentDir, "verify_completion_control_plane.sh");

	await fsp.mkdir(files.currentDir, { recursive: true });
	await fsp.mkdir(files.tmpDir, { recursive: true });
	await fsp.mkdir(files.agentDir, { recursive: true });
	await fsp.writeFile(stopScriptPath, buildVerifyStopScript(verifierCommand), "utf8");
	await fsp.writeFile(controlPlaneScriptPath, buildVerifyControlPlaneScript(), "utf8");
	await fsp.chmod(stopScriptPath, 0o755);
	await fsp.chmod(controlPlaneScriptPath, 0o755);
	await fsp.writeFile(files.sliceHistoryPath, "", "utf8");
	await fsp.writeFile(files.stopHistoryPath, "", "utf8");
	await writeJsonFile(files.statePath, state);
	await writeJsonFile(files.planPath, plan);
	await writeJsonFile(files.activePath, active);
	await writeJsonFile(files.startupBriefPath, startupBrief);
	await writeJsonFile(files.verificationEvidencePath, verificationEvidence);
	await writeJsonFile(path.join(files.agentDir, "profile.json"), profile);
	await appendJsonl(files.workflowEventsPath, {
		event_id: randomUUID(),
		timestamp: new Date().toISOString(),
		type: "workflow_started",
		source: "letscook-mcp",
		mission,
	});
	const snapshot = await loadWorkflowSnapshot(root);
	if (!snapshot) throw new Error("failed to load workflow after scaffold");
	return snapshot;
}

export async function updateWorkflowState(root: string, patch: JsonRecord): Promise<WorkflowSnapshot> {
	const snapshot = await loadWorkflowSnapshot(root);
	if (!snapshot) throw new Error("no active workflow");
	const next = { ...snapshot.state, ...patch };
	await writeJsonFile(snapshot.files.statePath, next);
	const reloaded = await loadWorkflowSnapshot(root);
	if (!reloaded) throw new Error("failed to reload workflow");
	return reloaded;
}

export function missionFromSnapshot(snapshot: WorkflowSnapshot): string {
	return (
		asString(snapshot.state.mission_anchor) ??
		asString(snapshot.startupBrief.mission) ??
		asString(snapshot.plan.mission_anchor) ??
		"(missing mission)"
	);
}

export { DEFAULT_REQUIRED_STOP_JUDGES, DEFAULT_STOP_AGGREGATION_POLICY, PROTOCOL_ID };
