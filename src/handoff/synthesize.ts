import { asString, asStringArray } from "../control-plane/state.ts";
import {
	assessCookHandoffStartability,
	buildConfirmationPreview,
	cookHandoffBlockFromJsonText,
	normalizeCookHandoffCapsule,
	validateCookHandoffSchema,
} from "./capsule.ts";
import {
	buildHandoffConfirmationLayout,
	formatConfirmationLayoutText,
} from "./confirmation-layout.ts";
import { createAnalystDeps, createProposalDeps } from "./synthesis/proposal-deps.ts";
import {
	buildContextProposalAnalystPrompt,
} from "./synthesis/prompt-surfaces.ts";
import { buildStartupAnalysisPrompt, parseStartupAnalysisOutput } from "./synthesis/startup-analysis.ts";
import {
	extractCookHandoffProposalFromText,
	parseContextProposalAnalystOutput,
	type ContextProposal,
} from "./synthesis/proposal.ts";
import { COMPLETION_STARTUP_ANALYSIS_CONTRACT_ID } from "./structured-contracts.ts";
import type { JsonRecord } from "../types.ts";

export type SynthesizeCookHandoffInput = {
	workspace_root?: string;
	project_name?: string;
	discussion_summary?: string;
	inline_intent?: string;
	explicit_capsule?: JsonRecord;
	structured_analysis?: JsonRecord;
	workflow_context_lines?: string[];
	plan_capsule?: JsonRecord;
};

function discussionFromInput(input: SynthesizeCookHandoffInput): string {
	const parts: string[] = [];
	if (input.inline_intent) parts.push(`Inline /cook intent: ${input.inline_intent}`);
	if (input.discussion_summary) parts.push(input.discussion_summary);
	if (parts.length === 0) return "(none)";
	return parts.join("\n\n");
}

function capsuleFromProposal(proposal: ContextProposal): JsonRecord {
	const hints = proposal.startupHints;
	return normalizeCookHandoffCapsule({
		kind: "cook_handoff",
		source: "primary_agent",
		captured_at: new Date().toISOString(),
		source_turn_id: "cursor-handoff-synthesis",
		mission: proposal.mission,
		scope: proposal.scope,
		constraints: proposal.constraints,
		acceptance: proposal.acceptance,
		risks: proposal.analysis.risks ?? [],
		notes: proposal.analysis.diagnostics ?? [],
		handoff_kind: "implementation_workflow_handoff",
		task_type: proposal.analysis.taskType ?? "completion-workflow",
		evaluation_profile: proposal.analysis.evaluationProfile ?? "completion-rubric-v1",
		why_cook_now: "Synthesized for /cook workflow entry",
		first_slice_goal: hints?.firstSliceGoal,
		first_slice_non_goals: hints?.firstSliceNonGoals ?? [],
		implementation_surfaces: hints?.implementationSurfaces ?? [],
		verification_commands: hints?.verificationCommands ?? [],
		why_this_slice_first: hints?.whyThisSliceFirst,
		verification_truth_mode: hints?.verificationTruthMode,
		deterministic_verifier_ready: hints?.deterministicVerifierReady,
		verification_latency: hints?.verificationLatency,
		verification_noise_risk: hints?.verificationNoiseRisk,
		verifier_gap: hints?.verifierGap,
		recommended_first_slice_kind: hints?.recommendedFirstSliceKind,
	});
}

function unableToPrepare(reason: string): JsonRecord {
	return normalizeCookHandoffCapsule({
		kind: "cook_handoff",
		source: "primary_agent",
		captured_at: new Date().toISOString(),
		mission: reason,
		scope: ["<repo>"],
		acceptance: ["Clarify mission before /cook"],
		handoff_kind: "unable_to_prepare",
		reason,
	});
}

export function getHandoffSynthesisPrompt(input: SynthesizeCookHandoffInput): JsonRecord {
	const projectName = asString(input.project_name) ?? "project";
	const discussion = discussionFromInput(input);
	const contextLines = input.workflow_context_lines ?? [];
	return {
		ok: true,
		contract_id: COMPLETION_STARTUP_ANALYSIS_CONTRACT_ID,
		analyst_prompt: buildContextProposalAnalystPrompt(projectName, discussion, contextLines),
		startup_analysis_prompt: buildStartupAnalysisPrompt(projectName, discussion, contextLines),
		instructions: [
			"Execute the analyst prompt and return exactly one JSON object.",
			"Then call submit_startup_analysis or synthesize_cook_handoff with structured_analysis.",
		],
	};
}

export function submitStartupAnalysis(
	input: SynthesizeCookHandoffInput & { structured_analysis: JsonRecord },
): JsonRecord {
	const projectName = asString(input.project_name) ?? "project";
	const proposal = parseStartupAnalysisOutput(JSON.stringify(input.structured_analysis), projectName);
	if (!proposal) {
		return {
			ok: false,
			error: "startup analysis is not startable or failed validation",
			code: "analysis_invalid",
		};
	}
	const capsule = capsuleFromProposal(proposal);
	const assessment = assessCookHandoffStartability(capsule, projectName);
	if (!assessment.startable || !assessment.proposal) {
		return {
			ok: false,
			error: assessment.errors.join("; ") || "handoff not startable",
			code: "not_startable",
			capsule,
		};
	}
	const layout = buildHandoffConfirmationLayout({ proposal: assessment.proposal, analysis: assessment.proposal.analysis });
	return {
		ok: true,
		startable: true,
		capsule,
		proposal: assessment.proposal,
		confirmation_preview: buildConfirmationPreview(capsule),
		confirmation_layout: layout,
		confirmation_layout_text: formatConfirmationLayoutText(layout),
		next_steps: ["prepare_cook_handoff({ workspace_root, capsule })", "confirm_cook_handoff({ workspace_root })"],
	};
}

export function synthesizeCookHandoff(input: SynthesizeCookHandoffInput): JsonRecord {
	const projectName = asString(input.project_name) ?? "project";
	const deps = createAnalystDeps();

	if (input.plan_capsule) {
		const merged = normalizeCookHandoffCapsule({
			...input.plan_capsule,
			...(input.explicit_capsule ?? {}),
		});
		const assessment = assessCookHandoffStartability(merged, projectName);
		if (assessment.startable && assessment.proposal) {
			const layout = buildHandoffConfirmationLayout({
				proposal: assessment.proposal,
				analysis: assessment.proposal.analysis,
			});
			return {
				ok: true,
				startable: true,
				source: "plan_capsule",
				capsule: merged,
				confirmation_preview: buildConfirmationPreview(merged),
				confirmation_layout: layout,
				confirmation_layout_text: formatConfirmationLayoutText(layout),
			};
		}
	}

	if (input.explicit_capsule) {
		const capsule = normalizeCookHandoffCapsule(input.explicit_capsule);
		const assessment = assessCookHandoffStartability(capsule, projectName);
		if (assessment.startable && assessment.proposal) {
			const layout = buildHandoffConfirmationLayout({
				proposal: assessment.proposal,
				analysis: assessment.proposal.analysis,
			});
			return {
				ok: true,
				startable: true,
				source: "explicit_capsule",
				capsule,
				confirmation_preview: buildConfirmationPreview(capsule),
				confirmation_layout: layout,
				confirmation_layout_text: formatConfirmationLayoutText(layout),
			};
		}
	}

	if (input.structured_analysis) {
		return submitStartupAnalysis({ ...input, structured_analysis: input.structured_analysis });
	}

	const discussion = discussionFromInput(input);
	if (!discussion || discussion === "(none)") {
		return {
			ok: false,
			fail_closed: true,
			error: "discussion_summary or inline_intent is required for synthesis",
			code: "missing_discussion",
			next_steps: ["Call get_handoff_synthesis_prompt, produce JSON, then submit_startup_analysis"],
		};
	}

	const analystPrompt = buildContextProposalAnalystPrompt(
		projectName,
		discussion,
		input.workflow_context_lines ?? [],
	);
	const proposal = parseContextProposalAnalystOutput(analystPrompt, projectName, deps);
	if (proposal) {
		const capsule = capsuleFromProposal(proposal);
		const assessment = assessCookHandoffStartability(capsule, projectName);
		if (assessment.startable && assessment.proposal) {
			const layout = buildHandoffConfirmationLayout({
				proposal: assessment.proposal,
				analysis: assessment.proposal.analysis,
			});
			return {
				ok: true,
				startable: true,
				source: "inline_heuristic",
				capsule,
				confirmation_preview: buildConfirmationPreview(capsule),
				confirmation_layout: layout,
				confirmation_layout_text: formatConfirmationLayoutText(layout),
			};
		}
	}

	const block = input.explicit_capsule
		? cookHandoffBlockFromJsonText(JSON.stringify(input.explicit_capsule, null, 2))
		: "";
	const fromBlock = block
		? extractCookHandoffProposalFromText(block, projectName, deps, {
				messageId: "cursor-handoff",
				timestampMs: Date.now(),
				source: "handoff_capsule",
			})
		: undefined;
	if (fromBlock) {
		const capsule = capsuleFromProposal(fromBlock);
		const layout = buildHandoffConfirmationLayout({ proposal: fromBlock, analysis: fromBlock.analysis });
		return {
			ok: true,
			startable: true,
			source: "explicit_block",
			capsule,
			confirmation_layout: layout,
			confirmation_layout_text: formatConfirmationLayoutText(layout),
		};
	}

	return {
		ok: false,
		fail_closed: true,
		error: "Could not synthesize a startable cook_handoff from provided context",
		code: "synthesis_failed",
		prompt: getHandoffSynthesisPrompt(input),
		capsule: unableToPrepare("Synthesis could not produce a startable handoff"),
		next_steps: [
			"Clarify mission, scope, and acceptance in chat",
			"Call get_handoff_synthesis_prompt and submit_startup_analysis with structured JSON",
		],
	};
}

export function validateCookHandoffTool(capsuleInput: JsonRecord, projectName?: string): JsonRecord {
	const capsule = normalizeCookHandoffCapsule(capsuleInput);
	const schema = validateCookHandoffSchema(capsule);
	if (!schema.ok) return { ok: false, errors: schema.errors };
	const assessment = assessCookHandoffStartability(capsule, projectName ?? "project");
	return {
		ok: assessment.startable,
		startable: assessment.startable,
		errors: assessment.errors,
		warnings: assessment.warnings,
		confirmation_preview: assessment.startable ? buildConfirmationPreview(capsule) : undefined,
	};
}
