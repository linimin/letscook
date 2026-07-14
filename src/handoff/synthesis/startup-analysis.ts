import {
	assessMissionAnchor,
	extractJsonObjectFromText,
	finalizeContextProposalAnalysis,
	isWeakMissionAnchor,
	normalizeMissionAnchorText,
	parseContextProposalAnalystOutput,
	serializeRecentDiscussionEntries,
	type ContextProposal,
	type RecentDiscussionEntry,
} from "./proposal.ts";
import { validateStartupAnalysisRecord, startupAnalysisValidationDefaults } from "./startup-validation.ts";
import { COMPLETION_STARTUP_ANALYSIS_CONTRACT_ID, type StructuredStartupAnalysisPayload } from "../structured-contracts.ts";
import { requireSubprocessFinalOutput } from "./subprocess-final-output.ts";
import type { JsonRecord } from "./completion-types.ts";

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildStartupAnalysisPrompt(projectName: string, discussion: string, contextLines: string[] = []): string {
	const lines = [
		`Project: ${projectName}`,
		"Analyze whether the user has provided enough repo-change intent to start /cook safely.",
		"Treat /cook itself as the workflow-entry signal; do not require English implementation-intent keywords before analyzing recent discussion.",
		"Prefer the latest clear user implementation intent and canonical workflow context over older background discussion.",
		"Use recent user/custom discussion plus canonical workflow context only; do not assume a workflow-startable mission when the discussion is planning-only, ambiguous, or weak.",
		"Do not include task_type or evaluation_profile in discussion-derived startup-analysis output. Only explicit structured startup artifacts may supply those routing fields elsewhere in /cook.",
		"When startup intent is unclear, contradictory, or low-confidence, return a non-startable analysis instead of inventing a generic mission anchor.",
	];
	if (contextLines.length > 0) lines.push("", "Canonical workflow context:", ...contextLines);
	lines.push("", "Recent discussion:", discussion || "(none)");
	return lines.join("\n");
}

export function buildStartupAnalysisPromptFromEntries(
	projectName: string,
	recentEntries: RecentDiscussionEntry[],
	contextLines: string[] = [],
	serializeEntries: (entries: RecentDiscussionEntry[]) => string = serializeRecentDiscussionEntries,
): string {
	return buildStartupAnalysisPrompt(projectName, serializeEntries(recentEntries), contextLines);
}

function parseStartupAnalysisFromValidatedRecord(parsed: JsonRecord, projectName: string): ContextProposal | undefined {
	const validated = validateStartupAnalysisRecord(parsed, projectName, {
		...startupAnalysisValidationDefaults,
		assessMissionAnchor,
		normalizeMissionAnchorText,
		isWeakMissionAnchor,
	});
	if (!validated) return undefined;
	if (validated.verdict !== "startable") return undefined;
	const sanitizedRecord = {
		verdict: validated.verdict,
		workflow_relation: validated.workflowRelation,
		confidence: validated.confidence,
		mission: validated.mission,
		scope: validated.scope,
		constraints: validated.constraints,
		acceptance: validated.acceptance,
		diagnostics: validated.diagnostics,
		critique: validated.critique,
		risks: validated.risks,
		possible_noise: validated.possibleNoise,
		alternate_missions: validated.alternateMissions,
		completed_topics: validated.suppressedCompletedTopics,
		negated_topics: validated.suppressedNegatedTopics,
	};
	const sanitizedBasisPreview = JSON.stringify(sanitizedRecord).replace(/\s+/g, " ").trim();
	const proposal = parseContextProposalAnalystOutput(JSON.stringify(sanitizedRecord), projectName);
	if (!proposal) return undefined;
	return {
		...proposal,
		basisPreview: sanitizedBasisPreview,
		analysis: finalizeContextProposalAnalysis(
			{
				...proposal.analysis,
				startupVerdict: validated.verdict,
				workflowRelation: validated.workflowRelation,
				confidence: validated.confidence,
				diagnostics: validated.diagnostics,
			},
			[proposal.goalText, proposal.mission, ...validated.diagnostics],
		),
	};
}

export function parseStartupAnalysisOutput(raw: string, projectName: string): ContextProposal | undefined {
	const jsonText = extractJsonObjectFromText(raw);
	if (!jsonText) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;
	return parseStartupAnalysisFromValidatedRecord(parsed, projectName);
}

export function parseStartupAnalysisFromSubprocess(args: {
	raw: string;
	projectName: string;
	eventLines?: string[];
}): ContextProposal | undefined {
	try {
		const { payload } = requireSubprocessFinalOutput<StructuredStartupAnalysisPayload>({
			eventLines: args.eventLines,
			contractId: COMPLETION_STARTUP_ANALYSIS_CONTRACT_ID,
			assistantText: args.raw,
		});
		if (!isRecord(payload.record)) return undefined;
		return parseStartupAnalysisFromValidatedRecord(payload.record, args.projectName);
	} catch {
		return undefined;
	}
}
