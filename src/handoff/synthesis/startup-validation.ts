import {
	STARTUP_ANALYSIS_CONFIDENCE_LEVELS,
	STARTUP_ANALYSIS_VERDICTS,
	STARTUP_WORKFLOW_RELATIONS,
	type JsonRecord,
	type StartupAnalysisConfidence,
	type StartupAnalysisVerdict,
	type StartupWorkflowRelation,
	type ValidatedStartupAnalysis,
} from "./completion-types.ts";

export type StartupAnalysisValidationDeps = {
	asString: (value: unknown) => string | undefined;
	asStringArray: (value: unknown) => string[];
	asNumber?: (value: unknown) => number | undefined;
	assessMissionAnchor: (text: string, projectName: string) => { derived: string };
	normalizeMissionAnchorText: (text: string) => string;
	isWeakMissionAnchor: (text: string) => boolean;
};

function localAsString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function localAsStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
		: [];
}

function localAsNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function uniqueItems(items: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of items) {
		const normalized = item.replace(/\s+/g, " ").trim();
		if (!normalized) continue;
		const key = normalized.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(normalized);
	}
	return result;
}

function normalizeKey(value: string): string {
	return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
}

function normalizeStartupAnalysisVerdict(
	value: unknown,
	asStringFn: (value: unknown) => string | undefined,
): StartupAnalysisVerdict | undefined {
	const normalized = asStringFn(value);
	if (!normalized) return undefined;
	const key = normalizeKey(normalized);
	const direct = STARTUP_ANALYSIS_VERDICTS.find((candidate) => candidate === key);
	if (direct) return direct;
	const aliases: Record<string, StartupAnalysisVerdict> = {
		start: "startable",
		startable: "startable",
		ready: "startable",
		implementation_ready: "startable",
		repo_change: "startable",
		yes: "startable",
		clarify: "needs_clarification",
		needs_clarification: "needs_clarification",
		unclear: "needs_clarification",
		ambiguous: "needs_clarification",
		question: "needs_clarification",
		planning_only: "planning_only",
		discussion_only: "planning_only",
		proposal_only: "planning_only",
		spec_only: "planning_only",
		design_only: "planning_only",
		not_repo_change: "not_repo_change",
		non_repo_change: "not_repo_change",
		no_repo_change: "not_repo_change",
		not_code_change: "not_repo_change",
		unsafe: "unsafe",
		blocked: "unsafe",
		reject: "unsafe",
		rejected: "unsafe",
		no: "unsafe",
	};
	return aliases[key];
}

function normalizeStartupWorkflowRelation(
	value: unknown,
	asStringFn: (value: unknown) => string | undefined,
): StartupWorkflowRelation | undefined {
	const normalized = asStringFn(value);
	if (!normalized) return undefined;
	const key = normalizeKey(normalized);
	const direct = STARTUP_WORKFLOW_RELATIONS.find((candidate) => candidate === key);
	if (direct) return direct;
	const aliases: Record<string, StartupWorkflowRelation> = {
		new: "new_workflow",
		new_workflow: "new_workflow",
		continue: "continue_current_workflow",
		continue_current_workflow: "continue_current_workflow",
		same: "continue_current_workflow",
		current: "continue_current_workflow",
		replace: "replace_current_workflow",
		refocus: "replace_current_workflow",
		replace_current_workflow: "replace_current_workflow",
		new_mission: "replace_current_workflow",
		unclear: "unclear",
		unknown: "unclear",
	};
	return aliases[key];
}

function confidenceFromNumber(value: number): StartupAnalysisConfidence {
	if (value >= 0.8) return "high";
	if (value >= 0.55) return "medium";
	return "low";
}

function normalizeStartupAnalysisConfidence(
	value: unknown,
	asStringFn: (value: unknown) => string | undefined,
	asNumberFn: (value: unknown) => number | undefined,
): StartupAnalysisConfidence | undefined {
	const numeric = asNumberFn(value);
	if (numeric !== undefined) return confidenceFromNumber(numeric);
	const stringValue = asStringFn(value);
	if (!stringValue) return undefined;
	const parsedNumeric = Number(stringValue);
	if (Number.isFinite(parsedNumeric)) return confidenceFromNumber(parsedNumeric);
	const key = normalizeKey(stringValue);
	const direct = STARTUP_ANALYSIS_CONFIDENCE_LEVELS.find((candidate) => candidate === key);
	if (direct) return direct;
	const aliases: Record<string, StartupAnalysisConfidence> = {
		high: "high",
		strong: "high",
		confident: "high",
		medium: "medium",
		med: "medium",
		moderate: "medium",
		low: "low",
		weak: "low",
		unclear: "low",
	};
	return aliases[key];
}

export function validateStartupAnalysisRecord(
	parsed: JsonRecord,
	projectName: string,
	deps: StartupAnalysisValidationDeps,
): ValidatedStartupAnalysis | undefined {
	const asNumberFn = deps.asNumber ?? localAsNumber;
	const verdict = normalizeStartupAnalysisVerdict(parsed.verdict, deps.asString);
	const workflowRelation = normalizeStartupWorkflowRelation(parsed.workflow_relation ?? parsed.workflowRelation, deps.asString);
	const confidence = normalizeStartupAnalysisConfidence(parsed.confidence, deps.asString, asNumberFn);
	const missionSource = deps.asString(parsed.mission) ?? deps.asString(parsed.goal) ?? deps.asString(parsed.summary);
	const scope = uniqueItems(deps.asStringArray(parsed.scope));
	const constraints = uniqueItems(deps.asStringArray(parsed.constraints));
	const acceptance = uniqueItems(deps.asStringArray(parsed.acceptance));
	const diagnostics = uniqueItems(deps.asStringArray(parsed.diagnostics ?? parsed.notes));
	const critique = uniqueItems(deps.asStringArray(parsed.critique));
	const risks = uniqueItems(deps.asStringArray(parsed.risks ?? parsed.risk));
	const possibleNoise = uniqueItems(deps.asStringArray(parsed.possible_noise ?? parsed.possibleNoise));
	const alternateMissions = uniqueItems(deps.asStringArray(parsed.alternate_missions ?? parsed.alternateMissions));
	const suppressedCompletedTopics = uniqueItems(deps.asStringArray(parsed.completed_topics ?? parsed.completedTopics));
	const suppressedNegatedTopics = uniqueItems(deps.asStringArray(parsed.negated_topics ?? parsed.negatedTopics));
	const taskType = deps.asString(parsed.task_type ?? parsed.taskType);
	const evaluationProfile = deps.asString(parsed.evaluation_profile ?? parsed.evaluationProfile);
	if (!verdict || !workflowRelation || !confidence || !missionSource) return undefined;
	const normalizedMissionSource = deps.normalizeMissionAnchorText(missionSource);
	if (!normalizedMissionSource || deps.isWeakMissionAnchor(normalizedMissionSource)) return undefined;
	const mission = deps.assessMissionAnchor(missionSource, projectName).derived;
	const normalizedMission = deps.normalizeMissionAnchorText(mission);
	if (!normalizedMission || deps.isWeakMissionAnchor(normalizedMission)) return undefined;
	if (verdict === "startable") {
		if (confidence === "low") return undefined;
		if (workflowRelation === "unclear") return undefined;
		if (scope.length === 0 || constraints.length === 0 || acceptance.length === 0) return undefined;
	}
	return {
		verdict,
		workflowRelation,
		confidence,
		mission,
		scope,
		constraints,
		acceptance,
		diagnostics,
		critique,
		risks,
		possibleNoise,
		alternateMissions,
		suppressedCompletedTopics,
		suppressedNegatedTopics,
		taskType,
		evaluationProfile,
		basisPreview: JSON.stringify(parsed).replace(/\s+/g, " ").trim(),
	};
}

export const startupAnalysisValidationDefaults = {
	asString: localAsString,
	asStringArray: localAsStringArray,
	asNumber: localAsNumber,
};
