import type { ContextProposal, ContextProposalAnalysis, ContextProposalConfirmationLayout } from "./synthesis/proposal.ts";
import {
	buildContextProposalConfirmationLayout,
	buildContextProposalCritiqueText,
	buildContextProposalDisplayText,
	buildContextProposalRoutingText,
} from "./synthesis/prompt-surfaces.ts";

export type { ContextProposalConfirmationLayout };

const DEFAULT_TASK_TYPE = "completion-workflow";
const DEFAULT_EVALUATION_PROFILE = "completion-rubric-v1";

export function buildHandoffConfirmationLayout(args: {
	title?: string;
	proposal: ContextProposal;
	analysis: ContextProposalAnalysis;
	mainChatRerunGuidance?: string;
}): ContextProposalConfirmationLayout {
	return buildContextProposalConfirmationLayout({
		title: args.title ?? "Review letscook startup brief",
		proposal: args.proposal,
		analysis: args.analysis,
		mainChatRerunGuidance:
			args.mainChatRerunGuidance ??
			"Discuss changes in chat, then rerun /cook to synthesize a fresh startup handoff.",
		defaultTaskType: DEFAULT_TASK_TYPE,
		defaultEvaluationProfile: DEFAULT_EVALUATION_PROFILE,
	});
}

export function formatConfirmationLayoutText(layout: ContextProposalConfirmationLayout): string {
	const sections = [
		layout.intro,
		"",
		`## ${layout.proposalHeading}`,
		layout.proposalBody,
		"",
		`## ${layout.critiqueHeading}`,
		layout.critiqueBody,
		"",
		`## ${layout.routingHeading}`,
		layout.routingBody,
	];
	if (layout.footer) sections.push("", layout.footer);
	return sections.join("\n");
}

export function proposalFromCapsule(capsule: Record<string, unknown>): ContextProposal {
	const mission = String(capsule.mission ?? "");
	const scope = Array.isArray(capsule.scope) ? capsule.scope.filter((v): v is string => typeof v === "string") : [];
	const constraints = Array.isArray(capsule.constraints)
		? capsule.constraints.filter((v): v is string => typeof v === "string")
		: [];
	const acceptance = Array.isArray(capsule.acceptance)
		? capsule.acceptance.filter((v): v is string => typeof v === "string")
		: [];
	const risks = Array.isArray(capsule.risks) ? capsule.risks.filter((v): v is string => typeof v === "string") : [];
	const notes = Array.isArray(capsule.notes) ? capsule.notes.filter((v): v is string => typeof v === "string") : [];
	const proposal: ContextProposal = {
		mission,
		scope,
		constraints,
		acceptance,
		goalText: "",
		basisPreview: mission,
		source: "handoff_capsule",
		alternateProposals: [],
		analysis: {
			risks,
			critique: notes,
			diagnostics: [],
			possibleNoise: [],
			alternateMissions: [],
			suppressedCompletedTopics: [],
			suppressedNegatedTopics: [],
			taskType: typeof capsule.task_type === "string" ? capsule.task_type : DEFAULT_TASK_TYPE,
			evaluationProfile:
				typeof capsule.evaluation_profile === "string" ? capsule.evaluation_profile : DEFAULT_EVALUATION_PROFILE,
		},
		startupHints: {
			firstSliceGoal:
				typeof capsule.first_slice_goal === "string" ? capsule.first_slice_goal : undefined,
			firstSliceNonGoals: Array.isArray(capsule.first_slice_non_goals)
				? capsule.first_slice_non_goals.filter((v): v is string => typeof v === "string")
				: [],
			implementationSurfaces: Array.isArray(capsule.implementation_surfaces)
				? capsule.implementation_surfaces.filter((v): v is string => typeof v === "string")
				: [],
			verificationCommands: Array.isArray(capsule.verification_commands)
				? capsule.verification_commands.filter((v): v is string => typeof v === "string")
				: [],
			whyThisSliceFirst:
				typeof capsule.why_this_slice_first === "string" ? capsule.why_this_slice_first : undefined,
			verificationTruthMode:
				typeof capsule.verification_truth_mode === "string" ? capsule.verification_truth_mode : undefined,
			deterministicVerifierReady:
				typeof capsule.deterministic_verifier_ready === "boolean"
					? capsule.deterministic_verifier_ready
					: undefined,
			verificationLatency:
				typeof capsule.verification_latency === "string" ? capsule.verification_latency : undefined,
			verificationNoiseRisk:
				typeof capsule.verification_noise_risk === "string" ? capsule.verification_noise_risk : undefined,
			verifierGap: typeof capsule.verifier_gap === "string" ? capsule.verifier_gap : undefined,
			recommendedFirstSliceKind:
				typeof capsule.recommended_first_slice_kind === "string"
					? capsule.recommended_first_slice_kind
					: undefined,
		},
	};
	proposal.goalText = buildContextProposalDisplayText(proposal);
	return proposal;
}

export function analysisFromCapsule(capsule: Record<string, unknown>, proposal: ContextProposal): ContextProposalAnalysis {
	const notes = Array.isArray(capsule.notes)
		? capsule.notes.filter((v): v is string => typeof v === "string")
		: [];
	return {
		...proposal.analysis,
		startupVerdict: "startable",
		workflowRelation: "new_workflow",
		confidence: "high",
		risks: proposal.analysis.risks ?? [],
		critique: notes,
		diagnostics: proposal.analysis.diagnostics ?? [],
	};
}

export { buildContextProposalDisplayText, buildContextProposalCritiqueText, buildContextProposalRoutingText };
