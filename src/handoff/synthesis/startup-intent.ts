import {
	extractCookHandoffProposalFromText,
	finalizeContextProposalAnalysis,
} from "./proposal.ts";
import type {
	ContextProposal,
	ContextProposalAlternate,
	ContextProposalAnalysis,
	ContextProposalWorkflowContext,
	RecentDiscussionEntry,
	RecentSessionMessage,
} from "./proposal.ts";
import type { CompletionStateSnapshot, StartupAnalysisConfidence, StartupWorkflowRelation } from "./completion-types.ts";
import type { CookHandoffGenerationResult } from "./structured-subprocess-wiring.ts";

export type { CookHandoffGenerationResult };

export type CookProposalDeps = {
	asString: (value: unknown) => string | undefined;
	asStringArray: (value: unknown) => string[];
	assessMissionAnchor: (text: string, projectName: string) => { derived: string };
	normalizeMissionAnchorText: (text: string) => string;
	isWeakMissionAnchor: (text: string) => boolean;
	missionAnchorsStrictlyEquivalent: (left: string, right: string) => boolean;
	stripCodeBlocks: (text: string) => string;
};

export type CookContextProposalResult = {
	proposal?: ContextProposal;
	handoffSynthesis?: CookHandoffGenerationResult;
	importHandoffPath?: string;
	importHandoffError?: string;
};

export type StartupIntentHints = {
	firstSliceGoal?: string;
	firstSliceNonGoals: string[];
	implementationSurfaces: string[];
	verificationCommands: string[];
	whyThisSliceFirst?: string;
	verificationTruthMode?: string;
	deterministicVerifierReady?: boolean;
	verificationLatency?: string;
	verificationNoiseRisk?: string;
	verifierGap?: string;
	recommendedFirstSliceKind?: string;
};

export type CookSynthesisContext = {
	recentEntries: RecentDiscussionEntry[];
	workflowContext?: ContextProposalWorkflowContext;
	workflowContextLines: string[];
};

export type AdvisoryStartupBrief = {
	kind: "startup_brief";
	source: "recent_discussion" | "primary_agent_handoff" | "deferred_primary_agent_handoff";
	confirmed: true;
	captured_at: string;
	goal_text: string;
	mission: string;
	scope: string[];
	constraints: string[];
	acceptance: string[];
	risks: string[];
	notes: string[];
	first_slice_goal_hint?: string;
	first_slice_non_goals_hint?: string[];
	implementation_surfaces_hint?: string[];
	verification_commands_hint?: string[];
	why_this_slice_first_hint?: string;
	verification_truth_mode?: string;
	deterministic_verifier_ready?: boolean;
	verification_latency?: string;
	verification_noise_risk?: string;
	verifier_gap?: string;
	recommended_first_slice_kind?: string;
	task_type?: string;
	evaluation_profile?: string;
};

const COOK_HANDOFF_BLOCK_REGEX = /```cook_handoff\s*[\s\S]*?```/giu;

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stripCookHandoffBlocks(text: string): string {
	return text.replace(COOK_HANDOFF_BLOCK_REGEX, " ").replace(/\s+/g, " ").trim();
}

function buildAdvisoryStartupBriefNotes(analysis: ContextProposalAnalysis): string[] {
	const notes = [
		...analysis.diagnostics.map((item) => `Diagnostic: ${item}`),
		...analysis.critique,
		...analysis.possibleNoise.map((item) => `Possible noise: ${item}`),
	];
	return notes.length > 0 ? notes : ["No additional operator notes were derived for this startup handoff."];
}

export function startupHintsPresent(hints: StartupIntentHints | undefined): boolean {
	if (!hints) return false;
	return Boolean(
		hints.firstSliceGoal ||
			hints.firstSliceNonGoals.length > 0 ||
			hints.implementationSurfaces.length > 0 ||
			hints.verificationCommands.length > 0 ||
			hints.whyThisSliceFirst ||
			hints.verificationTruthMode ||
			hints.deterministicVerifierReady !== undefined ||
			hints.verificationLatency ||
			hints.verificationNoiseRisk ||
			hints.verifierGap ||
			hints.recommendedFirstSliceKind,
	);
}

export function workflowContextFromSnapshot(
	snapshot: CompletionStateSnapshot | undefined,
): ContextProposalWorkflowContext | undefined {
	if (!snapshot) return undefined;
	return {
		currentMissionAnchor: asString(snapshot.state?.mission_anchor) ?? asString(snapshot.plan?.mission_anchor) ?? asString(snapshot.active?.mission_anchor),
		continuationPolicy: asString(snapshot.state?.continuation_policy),
		latestCompletedSlice: asString(snapshot.state?.latest_completed_slice),
		latestVerifiedSlice: asString(snapshot.state?.latest_verified_slice),
		activeSliceGoal: asString(snapshot.active?.goal),
		activeSliceWhyNow: asString(snapshot.active?.why_now),
		verificationGoal: asString(snapshot.verificationEvidence?.goal),
		verificationSummary: asString(snapshot.verificationEvidence?.summary),
	};
}

export function buildWorkflowContextLines(workflowContext: ContextProposalWorkflowContext | undefined): string[] {
	if (!workflowContext) return [];
	return [
		`current mission anchor: ${workflowContext.currentMissionAnchor ?? "(none)"}`,
		`continuation policy: ${workflowContext.continuationPolicy ?? "(none)"}`,
		`latest completed slice: ${workflowContext.latestCompletedSlice ?? "(none)"}`,
		`latest verified slice: ${workflowContext.latestVerifiedSlice ?? "(none)"}`,
		`active slice goal: ${workflowContext.activeSliceGoal ?? "(none)"}`,
		`active slice why_now: ${workflowContext.activeSliceWhyNow ?? "(none)"}`,
		`verification goal: ${workflowContext.verificationGoal ?? "(none)"}`,
		`verification summary: ${workflowContext.verificationSummary ?? "(none)"}`,
	];
}

export function buildCookRecentEntries(args: {
	inlinePrompt?: string;
	recentMessages: RecentSessionMessage[];
	limit?: number;
}): RecentDiscussionEntry[] {
	const limit = args.limit ?? 12;
	return [
		...(args.inlinePrompt ? [{ role: "user" as const, text: args.inlinePrompt }] : []),
		...args.recentMessages
			.filter((entry) => !entry.isCommand && (entry.role === "user" || entry.role === "assistant" || entry.role === "custom" || entry.role === "summary"))
			.slice(0, limit)
			.map((entry) => ({ role: entry.role, text: stripCookHandoffBlocks(entry.text) }))
			.filter((entry) => entry.text.length > 0),
	];
}

function isPrimaryAgentStructuredProposalSource(source: ContextProposal["source"]): boolean {
	return source === "handoff_capsule" || source === "deferred_primary_agent_handoff";
}

function annotateActiveWorkflowRoutingCandidate<T extends ContextProposalAlternate>(
	candidate: T,
	workflowContext: ContextProposalWorkflowContext | undefined,
	deps: Pick<CookProposalDeps, "missionAnchorsStrictlyEquivalent">,
): T {
	const currentMissionAnchor = workflowContext?.currentMissionAnchor?.trim();
	if (!currentMissionAnchor || workflowContext?.continuationPolicy === "done") return candidate;
	if (!isPrimaryAgentStructuredProposalSource(candidate.source)) return candidate;
	const workflowRelation: StartupWorkflowRelation =
		candidate.analysis.workflowRelation
			?? (deps.missionAnchorsStrictlyEquivalent(currentMissionAnchor, candidate.mission)
				? "continue_current_workflow"
				: "replace_current_workflow");
	const confidence: StartupAnalysisConfidence = candidate.analysis.confidence ?? "high";
	const routingDiagnostic = workflowRelation === "continue_current_workflow"
		? "Primary-agent-generated structured startup handoff strictly matches the current workflow mission, so /cook should continue the current workflow by default."
		: "Primary-agent-generated structured startup handoff proposes a different mission than the current workflow, so /cook should require approval before refocusing.";
	const diagnostics = candidate.analysis.diagnostics.includes(routingDiagnostic)
		? candidate.analysis.diagnostics
		: [...candidate.analysis.diagnostics, routingDiagnostic];
	return {
		...candidate,
		analysis: finalizeContextProposalAnalysis(
			{
				...candidate.analysis,
				workflowRelation,
				confidence,
				diagnostics,
			},
			[candidate.goalText, candidate.mission, currentMissionAnchor],
		),
	};
}

function annotateActiveWorkflowRoutingProposal(
	proposal: ContextProposal,
	workflowContext: ContextProposalWorkflowContext | undefined,
	deps: Pick<CookProposalDeps, "missionAnchorsStrictlyEquivalent">,
): ContextProposal {
	const annotated = annotateActiveWorkflowRoutingCandidate(proposal, workflowContext, deps);
	return {
		...annotated,
		alternateProposals: proposal.alternateProposals.map((candidate) =>
			annotateActiveWorkflowRoutingCandidate(candidate, workflowContext, deps)
		),
	};
}

export function buildCookSynthesisContext(args: {
	inlinePrompt?: string;
	recentMessages: RecentSessionMessage[];
	snapshot?: CompletionStateSnapshot;
}): CookSynthesisContext {
	const recentEntries = buildCookRecentEntries({
		inlinePrompt: args.inlinePrompt,
		recentMessages: args.recentMessages,
	});
	const workflowContext = workflowContextFromSnapshot(args.snapshot);
	const workflowContextLines = buildWorkflowContextLines(workflowContext);
	if (args.inlinePrompt) {
		workflowContextLines.push(`inline /cook startup intent: ${args.inlinePrompt}`);
		workflowContextLines.push("Treat the inline /cook prompt as the highest-priority explicit startup intent for this workflow entry.");
	}
	return {
		recentEntries,
		workflowContext,
		workflowContextLines,
	};
}

export async function deriveCookContextProposalWithSynthesis(args: {
	inlinePrompt?: string;
	importedHandoffProposal?: ContextProposal;
	importHandoffPath?: string;
	recentMessages: RecentSessionMessage[];
	snapshot?: CompletionStateSnapshot;
	projectName: string;
	deps: CookProposalDeps;
	generateCookHandoff?: (params: {
		recentEntries: RecentDiscussionEntry[];
		workflowContextLines: string[];
	}) => Promise<CookHandoffGenerationResult>;
}): Promise<CookContextProposalResult> {
	const workflowContext = workflowContextFromSnapshot(args.snapshot);
	const annotateProposal = (proposal: ContextProposal | undefined): ContextProposal | undefined =>
		proposal ? annotateActiveWorkflowRoutingProposal(proposal, workflowContext, args.deps) : undefined;
	if (args.importedHandoffProposal) {
		return {
			proposal: annotateProposal(args.importedHandoffProposal),
			importHandoffPath: args.importHandoffPath,
		};
	}
	const synthesisContext = buildCookSynthesisContext({
		inlinePrompt: args.inlinePrompt,
		recentMessages: args.recentMessages,
		snapshot: args.snapshot,
	});
	const { recentEntries, workflowContextLines } = synthesisContext;
	const handoffResult = await args.generateCookHandoff?.({ recentEntries, workflowContextLines });
	if (handoffResult?.kind === "handoff") {
		const generatedProposal = annotateProposal(
			extractCookHandoffProposalFromText(handoffResult.text, args.projectName, args.deps, {
				messageId: "generated-primary-agent-handoff",
				timestampMs: Date.now(),
			}),
		);
		if (generatedProposal) return { proposal: generatedProposal, handoffSynthesis: handoffResult };
	}
	return { handoffSynthesis: handoffResult };
}

export function buildAdvisoryStartupBrief(args: {
	proposal: Pick<ContextProposal, "goalText" | "mission" | "scope" | "constraints" | "acceptance" | "source" | "startupHints">;
	analysis: ContextProposalAnalysis;
	capturedAt?: string;
}): AdvisoryStartupBrief {
	return {
		kind: "startup_brief",
		source:
			args.proposal.source === "handoff_capsule"
				? "primary_agent_handoff"
				: args.proposal.source === "deferred_primary_agent_handoff"
					? "deferred_primary_agent_handoff"
					: "recent_discussion",
			confirmed: true,
			captured_at: args.capturedAt ?? new Date().toISOString(),
			goal_text: args.proposal.goalText,
			mission: args.proposal.mission,
			scope: [...args.proposal.scope],
			constraints: [...args.proposal.constraints],
			acceptance: [...args.proposal.acceptance],
			risks: [...args.analysis.risks],
			notes: buildAdvisoryStartupBriefNotes(args.analysis),
			first_slice_goal_hint: args.proposal.startupHints?.firstSliceGoal,
			first_slice_non_goals_hint:
				args.proposal.startupHints && args.proposal.startupHints.firstSliceNonGoals.length > 0
					? [...args.proposal.startupHints.firstSliceNonGoals]
					: undefined,
			implementation_surfaces_hint:
				args.proposal.startupHints && args.proposal.startupHints.implementationSurfaces.length > 0
					? [...args.proposal.startupHints.implementationSurfaces]
					: undefined,
			verification_commands_hint:
				args.proposal.startupHints && args.proposal.startupHints.verificationCommands.length > 0
					? [...args.proposal.startupHints.verificationCommands]
					: undefined,
			why_this_slice_first_hint: args.proposal.startupHints?.whyThisSliceFirst,
			verification_truth_mode: args.proposal.startupHints?.verificationTruthMode,
			deterministic_verifier_ready: args.proposal.startupHints?.deterministicVerifierReady,
			verification_latency: args.proposal.startupHints?.verificationLatency,
			verification_noise_risk: args.proposal.startupHints?.verificationNoiseRisk,
			verifier_gap: args.proposal.startupHints?.verifierGap,
			recommended_first_slice_kind: args.proposal.startupHints?.recommendedFirstSliceKind,
			task_type: args.analysis.taskType,
			evaluation_profile: args.analysis.evaluationProfile,
		};
}
