import {
	STRUCTURED_HELPER_OUTPUT_LIMITS,
	type StructuredHelperOutput,
	utf8Length,
} from "./synthesis/helper-types.ts";
import type { CompletionRole, JsonRecord } from "./synthesis/completion-types.ts";

export const COMPLETION_HELPER_SCOUT_CONTRACT_ID = "completion.helper.scout.v1";
export const COMPLETION_HELPER_CRITIC_CONTRACT_ID = "completion.helper.critic.v1";
export const COMPLETION_STARTUP_ANALYSIS_CONTRACT_ID = "completion.startup.analysis.v1";
export const COMPLETION_COOK_HANDOFF_CONTRACT_ID = "completion.handoff.cook_handoff.v1";
export const COMPLETION_EVALUATOR_REVIEWER_CONTRACT_ID = "completion.evaluator.reviewer.v1";
export const COMPLETION_EVALUATOR_AUDITOR_CONTRACT_ID = "completion.evaluator.auditor.v1";
export const COMPLETION_EVALUATOR_STOP_JUDGE_CONTRACT_ID = "completion.evaluator.stop_judge.v1";
export const COMPLETION_ROLE_BOOTSTRAPPER_CONTRACT_ID = "completion.role.bootstrapper.v1";
export const COMPLETION_ROLE_REGROUNDER_CONTRACT_ID = "completion.role.regrounder.v1";
export const COMPLETION_ROLE_IMPLEMENTER_CONTRACT_ID = "completion.role.implementer.v1";

export const HELPER_EMIT_SCOUT_TOOL = "completion_helper_emit_scout_result";
export const HELPER_EMIT_CRITIC_TOOL = "completion_helper_emit_critic_result";
export const EMIT_STARTUP_ANALYSIS_TOOL = "completion_emit_startup_analysis";
export const EMIT_COOK_HANDOFF_TOOL = "completion_emit_cook_handoff";
export const EMIT_REVIEWER_REPORT_TOOL = "completion_emit_reviewer_report";
export const EMIT_AUDITOR_REPORT_TOOL = "completion_emit_auditor_report";
export const EMIT_STOP_JUDGE_REPORT_TOOL = "completion_emit_stop_judge_report";
export const EMIT_BOOTSTRAPPER_HANDOFF_TOOL = "completion_emit_bootstrapper_handoff";
export const EMIT_REGROUNDER_RECONCILIATION_TOOL = "completion_emit_regrounder_reconciliation";
export const EMIT_IMPLEMENTER_HANDOFF_TOOL = "completion_emit_implementer_handoff";

export const RUBRIC_DIMENSIONS = [
	"Contract coverage",
	"Correctness risk",
	"Verification evidence",
	"Docs/state parity",
] as const;

export type RubricVerdict = "pass" | "concern" | "fail";

export type StructuredRubricLine = {
	dimension: (typeof RUBRIC_DIMENSIONS)[number];
	verdict: RubricVerdict;
	explanation: string;
};

export type StructuredHelperResult = StructuredHelperOutput & {
	contractId: string;
	schemaVersion: number;
};

export type StructuredStartupAnalysisPayload = {
	contractId: string;
	schemaVersion: number;
	record: JsonRecord;
};

export type StructuredCookHandoffPayload = {
	contractId: string;
	schemaVersion: number;
	capsule: JsonRecord;
};

export type StructuredEvaluatorReport = {
	contractId: string;
	schemaVersion: number;
	missionAnchor: string;
	remainingContractIds: string;
	rubric: StructuredRubricLine[];
	fields: JsonRecord;
};

export type StructuredRoleHandoffReport = {
	contractId: string;
	schemaVersion: number;
	fields: JsonRecord;
};

export type StructuredContractParseResult<T> =
	| { ok: true; payload: T }
	| { ok: false; errors: string[] };

export type StructuredContractDefinition = {
	contractId: string;
	schemaVersion: number;
	terminatingToolName: string;
};

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringArrayField(value: unknown, fieldName: string, errors: string[]): string[] {
	if (!Array.isArray(value)) {
		errors.push(`${fieldName} must be an array of strings`);
		return [];
	}
	const normalized: string[] = [];
	for (const item of value) {
		const text = asString(item);
		if (!text) {
			errors.push(`${fieldName} must contain only non-empty strings`);
			continue;
		}
		normalized.push(text);
	}
	return normalized;
}

function parseHelperOutputDetails(details: unknown, contractId: string): StructuredContractParseResult<StructuredHelperResult> {
	const errors: string[] = [];
	if (!isRecord(details)) return { ok: false, errors: ["structured helper details must be an object"] };
	const summary = asString(details.summary);
	if (!summary) errors.push("helper output must include summary");
	const evidence = parseStringArrayField(details.evidence, "evidence", errors);
	const paths = parseStringArrayField(details.paths, "paths", errors);
	const openQuestions = parseStringArrayField(details.open_questions, "open_questions", errors);
	if (summary && utf8Length(summary) > STRUCTURED_HELPER_OUTPUT_LIMITS.summaryMaxBytes) {
		errors.push("helper output summary exceeded the V1 byte cap");
	}
	if (evidence.length > STRUCTURED_HELPER_OUTPUT_LIMITS.evidenceMaxItems) errors.push("helper output evidence exceeded the V1 item cap");
	if (paths.length > STRUCTURED_HELPER_OUTPUT_LIMITS.pathsMaxItems) errors.push("helper output paths exceeded the V1 item cap");
	if (openQuestions.length > STRUCTURED_HELPER_OUTPUT_LIMITS.openQuestionsMaxItems) {
		errors.push("helper output open_questions exceeded the V1 item cap");
	}
	if (errors.length > 0) return { ok: false, errors };
	const normalized: StructuredHelperOutput = { summary: summary ?? "", evidence, paths, open_questions: openQuestions };
	if (utf8Length(JSON.stringify(normalized)) > STRUCTURED_HELPER_OUTPUT_LIMITS.totalMaxBytes) {
		return { ok: false, errors: ["helper output exceeded the V1 serialized JSON byte cap"] };
	}
	return {
		ok: true,
		payload: {
			...normalized,
			contractId,
			schemaVersion: 1,
		},
	};
}

function parseRubricLines(value: unknown, errors: string[]): StructuredRubricLine[] {
	if (!Array.isArray(value)) {
		errors.push("rubric must be an array");
		return [];
	}
	const lines: StructuredRubricLine[] = [];
	for (const dimension of RUBRIC_DIMENSIONS) {
		const raw = value.find((item) => isRecord(item) && asString(item.dimension) === dimension);
		if (!isRecord(raw)) {
			errors.push(`missing rubric line for ${dimension}`);
			continue;
		}
		const verdict = asString(raw.verdict)?.toLowerCase();
		const explanation = asString(raw.explanation);
		if (verdict !== "pass" && verdict !== "concern" && verdict !== "fail") {
			errors.push(`malformed rubric verdict for ${dimension}`);
			continue;
		}
		if (!explanation) {
			errors.push(`missing rubric explanation for ${dimension}`);
			continue;
		}
		lines.push({ dimension, verdict, explanation });
	}
	return lines;
}

function parseEvaluatorReportDetails(
	details: unknown,
	contractId: string,
	requiredFieldKeys: string[],
): StructuredContractParseResult<StructuredEvaluatorReport> {
	const errors: string[] = [];
	if (!isRecord(details)) return { ok: false, errors: ["structured evaluator details must be an object"] };
	const missionAnchor = asString(details.mission_anchor ?? details.missionAnchor);
	const remainingContractIds = asString(details.remaining_contract_ids ?? details.remainingContractIds);
	if (!missionAnchor) errors.push("missing mission anchor");
	if (!remainingContractIds) errors.push("missing remaining contract IDs");
	const rubric = parseRubricLines(details.rubric, errors);
	const fieldsRaw = details.fields;
	if (!isRecord(fieldsRaw)) {
		errors.push("evaluator report must include fields object");
	} else {
		for (const key of requiredFieldKeys) {
			if (!(key in fieldsRaw) || !asString(fieldsRaw[key])) errors.push(`missing required field: ${key}`);
		}
	}
	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		payload: {
			contractId,
			schemaVersion: 1,
			missionAnchor: missionAnchor!,
			remainingContractIds: remainingContractIds!,
			rubric,
			fields: fieldsRaw as JsonRecord,
		},
	};
}

function parseRoleHandoffDetails(details: unknown, contractId: string, requiredFieldKeys: string[]): StructuredContractParseResult<StructuredRoleHandoffReport> {
	const errors: string[] = [];
	if (!isRecord(details)) return { ok: false, errors: ["structured role handoff details must be an object"] };
	const fieldsRaw = details.fields ?? details;
	if (!isRecord(fieldsRaw)) {
		return { ok: false, errors: ["role handoff must include fields object"] };
	}
	for (const key of requiredFieldKeys) {
		if (!(key in fieldsRaw) || !asString(fieldsRaw[key])) errors.push(`missing required field: ${key}`);
	}
	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		payload: {
			contractId,
			schemaVersion: 1,
			fields: fieldsRaw as JsonRecord,
		},
	};
}

function parseBootstrapperDetails(details: unknown): StructuredContractParseResult<StructuredRoleHandoffReport> {
	return parseRoleHandoffDetails(details, COMPLETION_ROLE_BOOTSTRAPPER_CONTRACT_ID, BOOTSTRAPPER_FIELD_KEYS);
}

function parseRegrounderDetails(details: unknown): StructuredContractParseResult<StructuredRoleHandoffReport> {
	return parseRoleHandoffDetails(details, COMPLETION_ROLE_REGROUNDER_CONTRACT_ID, REGROUNDER_FIELD_KEYS);
}

function parseImplementerDetails(details: unknown): StructuredContractParseResult<StructuredRoleHandoffReport> {
	return parseRoleHandoffDetails(details, COMPLETION_ROLE_IMPLEMENTER_CONTRACT_ID, IMPLEMENTER_FIELD_KEYS);
}

const REVIEWER_FIELD_KEYS = [
	"Findings",
	"Acceptable as-is",
	"Smallest follow-up slice",
];

const AUDITOR_FIELD_KEYS = [
	"Why the project is still not done",
	"Open top-level contract IDs",
	"Blocker count",
	"High-value gap count",
	"Tracked and unignored worktree is clean",
	"Worktree blockers",
	"Next mandatory slice",
	"Stale or conflicting canonical state",
	"Plan truthfully captures remaining slice backlog",
];

const STOP_JUDGE_FIELD_KEYS = [
	"Can the project stop now",
	"Exact remaining open top-level contract IDs",
	"Blocker count",
	"High-value gap count",
	"Latest completed slice commit",
	"Docs/config/runbooks match shipped behavior",
	"Tracked and unignored worktree is clean",
	"Brief justification",
];

const BOOTSTRAPPER_FIELD_KEYS = [
	"MISSION ANCHOR",
	"Remaining contract IDs",
	"Bootstrap applied",
	"Local helper files repaired",
	"Execution-state files initialized",
	"Gitignore updated",
	"Next role to invoke",
	"Exact handoff payload",
	"Canonical blockers",
];

const REGROUNDER_FIELD_KEYS = [
	"MISSION ANCHOR",
	"Remaining contract IDs",
	"Canonical re-ground applied",
	"Acceptance criteria revalidated",
	"Tracked and unignored worktree is clean",
	"Reopened slices",
	"Reconciliation decision",
	"Reconciled slice ID",
	"Current selected slice",
	"Next role to invoke",
	"Exact handoff payload",
	"Canonical blockers or deviations",
];

const IMPLEMENTER_FIELD_KEYS = [
	"MISSION ANCHOR",
	"Remaining contract IDs before slice",
	"Slice ID",
	"Slice goal",
	"Contract IDs closed or advanced",
	"Files changed",
	"Tests added or strengthened",
	"Verification commands run",
	"Verification results",
	"Commit SHA",
	"What release gap this closed",
	"Plan adjustment required",
	"Residual risks discovered",
	"Remaining contract IDs after slice",
];

export const STRUCTURED_CONTRACTS: Record<string, StructuredContractDefinition & {
	parseDetails: (details: unknown) => StructuredContractParseResult<unknown>;
}> = {
	[COMPLETION_HELPER_SCOUT_CONTRACT_ID]: {
		contractId: COMPLETION_HELPER_SCOUT_CONTRACT_ID,
		schemaVersion: 1,
		terminatingToolName: HELPER_EMIT_SCOUT_TOOL,
		parseDetails: (details) => parseHelperOutputDetails(details, COMPLETION_HELPER_SCOUT_CONTRACT_ID),
	},
	[COMPLETION_HELPER_CRITIC_CONTRACT_ID]: {
		contractId: COMPLETION_HELPER_CRITIC_CONTRACT_ID,
		schemaVersion: 1,
		terminatingToolName: HELPER_EMIT_CRITIC_TOOL,
		parseDetails: (details) => parseHelperOutputDetails(details, COMPLETION_HELPER_CRITIC_CONTRACT_ID),
	},
	[COMPLETION_STARTUP_ANALYSIS_CONTRACT_ID]: {
		contractId: COMPLETION_STARTUP_ANALYSIS_CONTRACT_ID,
		schemaVersion: 1,
		terminatingToolName: EMIT_STARTUP_ANALYSIS_TOOL,
		parseDetails: (details) => {
			if (!isRecord(details)) return { ok: false, errors: ["startup analysis details must be an object"] };
			const record = details.record ?? details;
			if (!isRecord(record)) return { ok: false, errors: ["startup analysis record must be an object"] };
			return {
				ok: true,
				payload: {
					contractId: COMPLETION_STARTUP_ANALYSIS_CONTRACT_ID,
					schemaVersion: 1,
					record,
				} satisfies StructuredStartupAnalysisPayload,
			};
		},
	},
	[COMPLETION_COOK_HANDOFF_CONTRACT_ID]: {
		contractId: COMPLETION_COOK_HANDOFF_CONTRACT_ID,
		schemaVersion: 1,
		terminatingToolName: EMIT_COOK_HANDOFF_TOOL,
		parseDetails: (details) => {
			if (!isRecord(details)) return { ok: false, errors: ["cook handoff details must be an object"] };
			const capsule = details.capsule ?? details;
			if (!isRecord(capsule)) return { ok: false, errors: ["cook handoff capsule must be an object"] };
			if (asString(capsule.kind) !== "cook_handoff") return { ok: false, errors: ["cook handoff kind must be cook_handoff"] };
			const handoffKind = asString(capsule.handoff_kind ?? capsule.handoffKind);
			if (handoffKind === "unable_to_prepare") {
				const reason = asString(capsule.reason ?? capsule.notes);
				if (!reason) return { ok: false, errors: ["unable_to_prepare cook handoff requires reason or notes"] };
				return {
					ok: true,
					payload: {
						contractId: COMPLETION_COOK_HANDOFF_CONTRACT_ID,
						schemaVersion: 1,
						capsule,
					} satisfies StructuredCookHandoffPayload,
				};
			}
			if (handoffKind !== "implementation_workflow_handoff") {
				return { ok: false, errors: ["cook handoff handoff_kind must be implementation_workflow_handoff or unable_to_prepare"] };
			}
			if (!asString(capsule.mission)) return { ok: false, errors: ["cook handoff mission is required"] };
			return {
				ok: true,
				payload: {
					contractId: COMPLETION_COOK_HANDOFF_CONTRACT_ID,
					schemaVersion: 1,
					capsule,
				} satisfies StructuredCookHandoffPayload,
			};
		},
	},
	[COMPLETION_EVALUATOR_REVIEWER_CONTRACT_ID]: {
		contractId: COMPLETION_EVALUATOR_REVIEWER_CONTRACT_ID,
		schemaVersion: 1,
		terminatingToolName: EMIT_REVIEWER_REPORT_TOOL,
		parseDetails: (details) => parseEvaluatorReportDetails(details, COMPLETION_EVALUATOR_REVIEWER_CONTRACT_ID, REVIEWER_FIELD_KEYS),
	},
	[COMPLETION_EVALUATOR_AUDITOR_CONTRACT_ID]: {
		contractId: COMPLETION_EVALUATOR_AUDITOR_CONTRACT_ID,
		schemaVersion: 1,
		terminatingToolName: EMIT_AUDITOR_REPORT_TOOL,
		parseDetails: (details) => parseEvaluatorReportDetails(details, COMPLETION_EVALUATOR_AUDITOR_CONTRACT_ID, AUDITOR_FIELD_KEYS),
	},
	[COMPLETION_EVALUATOR_STOP_JUDGE_CONTRACT_ID]: {
		contractId: COMPLETION_EVALUATOR_STOP_JUDGE_CONTRACT_ID,
		schemaVersion: 1,
		terminatingToolName: EMIT_STOP_JUDGE_REPORT_TOOL,
		parseDetails: (details) => parseEvaluatorReportDetails(details, COMPLETION_EVALUATOR_STOP_JUDGE_CONTRACT_ID, STOP_JUDGE_FIELD_KEYS),
	},
	[COMPLETION_ROLE_BOOTSTRAPPER_CONTRACT_ID]: {
		contractId: COMPLETION_ROLE_BOOTSTRAPPER_CONTRACT_ID,
		schemaVersion: 1,
		terminatingToolName: EMIT_BOOTSTRAPPER_HANDOFF_TOOL,
		parseDetails: parseBootstrapperDetails,
	},
	[COMPLETION_ROLE_REGROUNDER_CONTRACT_ID]: {
		contractId: COMPLETION_ROLE_REGROUNDER_CONTRACT_ID,
		schemaVersion: 1,
		terminatingToolName: EMIT_REGROUNDER_RECONCILIATION_TOOL,
		parseDetails: parseRegrounderDetails,
	},
	[COMPLETION_ROLE_IMPLEMENTER_CONTRACT_ID]: {
		contractId: COMPLETION_ROLE_IMPLEMENTER_CONTRACT_ID,
		schemaVersion: 1,
		terminatingToolName: EMIT_IMPLEMENTER_HANDOFF_TOOL,
		parseDetails: parseImplementerDetails,
	},
};

export function getStructuredContract(contractId: string) {
	return STRUCTURED_CONTRACTS[contractId];
}

export function contractIdForHelper(helper: "scout" | "critic"): string {
	return helper === "scout" ? COMPLETION_HELPER_SCOUT_CONTRACT_ID : COMPLETION_HELPER_CRITIC_CONTRACT_ID;
}

export function contractIdForCompletionRole(role: CompletionRole): string | undefined {
	switch (role) {
		case "completion-reviewer":
			return COMPLETION_EVALUATOR_REVIEWER_CONTRACT_ID;
		case "completion-auditor":
			return COMPLETION_EVALUATOR_AUDITOR_CONTRACT_ID;
		case "completion-stop-judge":
			return COMPLETION_EVALUATOR_STOP_JUDGE_CONTRACT_ID;
		case "completion-bootstrapper":
			return COMPLETION_ROLE_BOOTSTRAPPER_CONTRACT_ID;
		case "completion-regrounder":
			return COMPLETION_ROLE_REGROUNDER_CONTRACT_ID;
		case "completion-implementer":
			return COMPLETION_ROLE_IMPLEMENTER_CONTRACT_ID;
		default:
			return undefined;
	}
}
