import * as fs from "node:fs";
import * as path from "node:path";
import type { CompletionStateSnapshot, LiveRoleActivity } from "./completion-types.ts";
import type {
	ContextProposal,
	ContextProposalAnalysis,
	ContextProposalConfirmationActionItem,
	ContextProposalConfirmationLayout,
} from "./proposal.ts";
import { startupHintsPresent } from "./startup-intent.ts";

export function buildCookHandoffBoundaryReminder(): string {
	return [
		"You are in ordinary main chat unless the user explicitly runs /cook.",
		"Ordinary chat may clarify requirements, discuss tradeoffs, refine scope, and directly implement requested repo changes, including multi-file work, when that is the most helpful response.",
		"Do not proactively tell the user to run /cook just because a task looks workflow-worthy, and do not emit a ```cook_handoff``` capsule by default in ordinary chat.",
		"/cook is optional workflow mode for resumability, review, audit, canonical .agent state, or deliberate multi-session control; it is not required just to edit repo files in ordinary chat.",
		"In ordinary chat, do not load or follow completion-protocol, and do not call completion_role.",
		"If the user wants direct implementation now, stay in ordinary chat and help directly instead of blocking on /cook.",
		"If the user explicitly runs /cook, the extension should call a primary-agent handoff synthesis step from the current task context or inline /cook prompt, show Start/Cancel confirmation, and persist the confirmed startup brief into .agent/** without making the user rerun /cook.",
		"If no primary-agent-generated handoff is startable, /cook must fail closed and leave canonical workflow state unchanged.",
		"Only provide a preview startup brief or ```cook_handoff``` capsule in ordinary chat when the user explicitly asks for that preview behavior. Any preview capsule is illustrative only: /cook still synthesizes a fresh startup handoff when the user enters workflow mode, and the preview is not canonical .agent state, an active slice, or a persistent repo contract.",
		"When you continue in ordinary chat, do not pretend /cook already started and do not silently rewrite discussion into canonical workflow state.",
	].join(" ");
}

export function buildStoppedWorkflowBoundaryReminder(args: {
	missionAnchor?: string;
	continuationPolicy?: string;
	continuationReason?: string;
}): string {
	return [
		"A completion workflow is currently stopped but still canonically active for this repo.",
		`Mission anchor: ${args.missionAnchor ?? "(unknown)"}`,
		`Continuation policy: ${args.continuationPolicy ?? "unknown"}`,
		`Continuation reason: ${args.continuationReason ?? "(unknown)"}`,
		"Do not tell the user to hand-edit .agent state or open a new chat just to escape this stopped workflow.",
		"Supported same-repo controls are: rerun /cook or /cook resume to continue from canonical state; run /cook park to record a parked paused posture that unlocks ordinary direct edits and forces canonical reground before workflow continuation; run /cook cancel to close the workflow and disable stale hard locks or auto-resume.",
		"Until Park or Cancel is recorded canonically, ordinary tracked-file edits remain hard-locked for this repo.",
	].join(" ");
}

export function buildContextProposalGoalText(proposal: {
	mission: string;
	scope: string[];
	constraints: string[];
	acceptance: string[];
}): string {
	const lines = [`Mission: ${proposal.mission}`];
	if (proposal.scope.length > 0) {
		lines.push("", "Scope:");
		for (const item of proposal.scope) lines.push(`- ${item}`);
	}
	if (proposal.constraints.length > 0) {
		lines.push("", "Constraints:");
		for (const item of proposal.constraints) lines.push(`- ${item}`);
	}
	if (proposal.acceptance.length > 0) {
		lines.push("", "Acceptance:");
		for (const item of proposal.acceptance) lines.push(`- ${item}`);
	}
	return lines.join("\n");
}

function formatStartupHintBoolean(value: boolean | undefined): string | undefined {
	if (value === undefined) return undefined;
	return value ? "yes" : "no";
}

function startupHintsHaveVerifierPosture(startupHints: ContextProposal["startupHints"]): boolean {
	return Boolean(
		startupHints?.verificationTruthMode ||
			startupHints?.deterministicVerifierReady !== undefined ||
			startupHints?.verificationLatency ||
			startupHints?.verificationNoiseRisk ||
			startupHints?.verifierGap ||
			startupHints?.recommendedFirstSliceKind,
	);
}

export function buildContextProposalDisplayText(proposal: ContextProposal): string {
	const lines = ["Mission", proposal.mission];
	if (proposal.scope.length > 0) {
		lines.push("", "Scope");
		for (const item of proposal.scope) lines.push(`- ${item}`);
	}
	if (proposal.constraints.length > 0) {
		lines.push("", "Constraints");
		for (const item of proposal.constraints) lines.push(`- ${item}`);
	}
	if (proposal.acceptance.length > 0) {
		lines.push("", "Acceptance");
		for (const item of proposal.acceptance) lines.push(`- ${item}`);
	}
	const startupHints = proposal.startupHints;
	if (startupHintsPresent(startupHints)) {
		const hasInitialSliceHints = Boolean(
			startupHints?.firstSliceGoal ||
				startupHints?.firstSliceNonGoals.length ||
				startupHints?.implementationSurfaces.length ||
				startupHints?.verificationCommands.length ||
				startupHints?.whyThisSliceFirst,
		);
		if (hasInitialSliceHints) {
			lines.push("", "Initial slice hints (advisory)");
			if (startupHints?.firstSliceGoal) lines.push(`- First slice goal: ${startupHints.firstSliceGoal}`);
			if ((startupHints?.firstSliceNonGoals.length ?? 0) > 0) lines.push(`- First slice non-goals: ${startupHints?.firstSliceNonGoals.join(" | ")}`);
			if ((startupHints?.implementationSurfaces.length ?? 0) > 0) lines.push(`- Implementation surfaces: ${startupHints?.implementationSurfaces.join(" | ")}`);
			if ((startupHints?.verificationCommands.length ?? 0) > 0) lines.push(`- Verification commands: ${startupHints?.verificationCommands.join(" | ")}`);
			if (startupHints?.whyThisSliceFirst) lines.push(`- Why this slice first: ${startupHints.whyThisSliceFirst}`);
		}
		if (startupHintsHaveVerifierPosture(startupHints)) {
			lines.push("", "Verifier posture (advisory)");
			if (startupHints?.verificationTruthMode) lines.push(`- Verification truth mode: ${startupHints.verificationTruthMode}`);
			const deterministicVerifierReady = formatStartupHintBoolean(startupHints?.deterministicVerifierReady);
			if (deterministicVerifierReady) lines.push(`- Deterministic verifier ready: ${deterministicVerifierReady}`);
			if (startupHints?.verificationLatency) lines.push(`- Verification latency: ${startupHints.verificationLatency}`);
			if (startupHints?.verificationNoiseRisk) lines.push(`- Verification noise risk: ${startupHints.verificationNoiseRisk}`);
			if (startupHints?.verifierGap) lines.push(`- Verifier gap: ${startupHints.verifierGap}`);
			if (startupHints?.recommendedFirstSliceKind) lines.push(`- Recommended first slice kind: ${startupHints.recommendedFirstSliceKind}`);
		}
	}
	return lines.join("\n");
}

export function buildContextProposalCritiqueText(analysis: ContextProposalAnalysis): string {
	const lines: string[] = [];
	if (analysis.diagnostics.length > 0) {
		lines.push("Diagnostics");
		for (const item of analysis.diagnostics) lines.push(`- ${item}`);
	}
	if (analysis.critique.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push("Critique");
		for (const item of analysis.critique) lines.push(`- ${item}`);
	}
	if (analysis.risks.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push("Risks");
		for (const item of analysis.risks) lines.push(`- ${item}`);
	}
	if (analysis.possibleNoise.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push("Possible noise");
		for (const item of analysis.possibleNoise) lines.push(`- ${item}`);
	}
	if (analysis.alternateMissions.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push("Alternate recent missions");
		for (const item of analysis.alternateMissions) lines.push(`- ${item}`);
	}
	if (analysis.suppressedCompletedTopics.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push("Suppressed completed topics");
		for (const item of analysis.suppressedCompletedTopics) lines.push(`- ${item}`);
	}
	if (analysis.suppressedNegatedTopics.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push("Suppressed negated topics");
		for (const item of analysis.suppressedNegatedTopics) lines.push(`- ${item}`);
	}
	if (lines.length === 0) {
		return "No additional operator notes or risks were derived for this startup brief.";
	}
	return lines.join("\n");
}

export function buildContextProposalRoutingText(
	analysis: ContextProposalAnalysis,
	defaults: { taskType: string; evaluationProfile: string },
	startupHints?: ContextProposal["startupHints"],
): string {
	const lines = [
		analysis.startupVerdict ? `- verdict: ${analysis.startupVerdict}` : undefined,
		analysis.workflowRelation ? `- workflow_relation: ${analysis.workflowRelation}` : undefined,
		analysis.confidence ? `- confidence: ${analysis.confidence}` : undefined,
		`- task_type: ${analysis.taskType ?? defaults.taskType}`,
		`- evaluation_profile: ${analysis.evaluationProfile ?? defaults.evaluationProfile}`,
	].filter((line): line is string => Boolean(line));
	if (startupHints?.verificationTruthMode) lines.push(`- verification_truth_mode: ${startupHints.verificationTruthMode}`);
	if (startupHints?.deterministicVerifierReady !== undefined) {
		lines.push(`- deterministic_verifier_ready: ${startupHints.deterministicVerifierReady}`);
	}
	if (startupHints?.verificationLatency) lines.push(`- verification_latency: ${startupHints.verificationLatency}`);
	if (startupHints?.verificationNoiseRisk) lines.push(`- verification_noise_risk: ${startupHints.verificationNoiseRisk}`);
	if (startupHints?.verifierGap) lines.push(`- verifier_gap: ${startupHints.verifierGap}`);
	if (startupHints?.recommendedFirstSliceKind) {
		lines.push(`- recommended_first_slice_kind: ${startupHints.recommendedFirstSliceKind}`);
	}
	return lines.join("\n");
}

function summarizeContextProposalAnalysisItems(
	label: string,
	items: string[],
	truncateInline: (text: string, maxLength?: number) => string,
): string | undefined {
	if (items.length === 0) return undefined;
	return `${label}=${truncateInline(items.join(" | "), 160)}`;
}

export function buildContextProposalContinuationReason(
	prefix: string,
	goalText: string,
	analysis: ContextProposalAnalysis,
	deps: {
		defaultTaskType: string;
		defaultEvaluationProfile: string;
		truncateInline: (text: string, maxLength?: number) => string;
	},
): string {
	const critiqueParts = [
		analysis.critique.length > 0 ? `accepted critique=${deps.truncateInline(analysis.critique.join(" | "), 160)}` : "accepted critique=none",
		summarizeContextProposalAnalysisItems("risks", analysis.risks, deps.truncateInline),
		summarizeContextProposalAnalysisItems("possible_noise", analysis.possibleNoise, deps.truncateInline),
		summarizeContextProposalAnalysisItems("alternate_missions", analysis.alternateMissions, deps.truncateInline),
		summarizeContextProposalAnalysisItems("suppressed_completed", analysis.suppressedCompletedTopics, deps.truncateInline),
		summarizeContextProposalAnalysisItems("suppressed_negated", analysis.suppressedNegatedTopics, deps.truncateInline),
	].filter((part): part is string => Boolean(part));
	return `${prefix} ${deps.truncateInline(goalText, 220)} | startup routing: task_type=${analysis.taskType ?? deps.defaultTaskType}; evaluation_profile=${analysis.evaluationProfile ?? deps.defaultEvaluationProfile}; critique outcome=${critiqueParts.join("; ")}`;
}

export function buildContextProposalConfirmationActions(mainChatRerunGuidance: string): ContextProposalConfirmationActionItem[] {
	return [
		{
			id: "start",
			label: "Start",
			description: "Accept this startup brief and let /cook write or refocus canonical workflow state.",
		},
		{
			id: "cancel",
			label: "Cancel",
			description: `Stop here without changing canonical workflow state. ${mainChatRerunGuidance}`,
		},
	];
}

export function buildContextProposalConfirmationLayout(args: {
	title: string;
	proposal: ContextProposal;
	analysis: ContextProposalAnalysis;
	mainChatRerunGuidance: string;
	defaultTaskType: string;
	defaultEvaluationProfile: string;
}): ContextProposalConfirmationLayout {
	return {
		title: args.title,
		intro: "Review the startup brief (mission, scope, constraints, acceptance, and notes/risks) plus any advisory initial-slice hints before /cook writes canonical workflow state. Starting here enters workflow mode and preserves startup intent; completion-regrounder will still reconcile repo truth and author the canonical slices afterwards. This gate is approval-only: either Start it as-is or Cancel, discuss changes in the main chat, and rerun /cook.",
		proposalHeading: "Startup brief",
		proposalBody: buildContextProposalDisplayText(args.proposal),
		critiqueHeading: "Notes and risks",
		critiqueBody: buildContextProposalCritiqueText(args.analysis),
		routingHeading: "Routing recommendations",
		routingBody: buildContextProposalRoutingText(
			args.analysis,
			{
				taskType: args.defaultTaskType,
				evaluationProfile: args.defaultEvaluationProfile,
			},
			args.proposal.startupHints,
		),
		actionsHeading: "Actions",
		actions: buildContextProposalConfirmationActions(args.mainChatRerunGuidance),
		footer: "↑↓ navigate • enter select • esc cancel",
	};
}

export function maybeWriteContextProposalConfirmationSnapshot(
	layout: ContextProposalConfirmationLayout,
	snapshotPath: string | undefined,
): void {
	if (!snapshotPath) return;
	try {
		fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
		fs.writeFileSync(snapshotPath, `${JSON.stringify(layout, null, 2)}\n`, "utf8");
	} catch {
		// ignore malformed or unwritable test snapshot paths
	}
}

export function maybeWriteContextProposalSnapshot(proposal: ContextProposal, snapshotPath: string | undefined): void {
	if (!snapshotPath) return;
	try {
		fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
		fs.writeFileSync(snapshotPath, `${JSON.stringify(proposal, null, 2)}\n`, "utf8");
	} catch {
		// ignore malformed or unwritable test snapshot paths
	}
}


export function buildContextProposalConfirmationSelectItems(layout: ContextProposalConfirmationLayout) {
	return layout.actions.map((action) => ({
		value: action.id,
		label: action.label,
		description: action.description,
	}));
}

export function buildContextProposalAnalystPrompt(projectName: string, discussion: string, contextLines: string[] = []): string {
	const lines = [
		`Project: ${projectName}`,
		"Infer the current implementation mission from the discussion.",
		"Return exactly one JSON object with keys: verdict, workflow_relation, confidence, mission, scope, constraints, acceptance, diagnostics, critique, risks, possible_noise.",
		"Use verdict values: startable, needs_clarification, planning_only, not_repo_change, or unsafe.",
		"Use workflow_relation values: new_workflow, continue_current_workflow, replace_current_workflow, or unclear.",
		"Prefer the latest clear user implementation intent over older background context.",
		"Treat stale, completed, or explicitly negated topics as context to ignore unless the latest discussion clearly reopens them.",
		"Use only recent user/custom discussion plus canonical workflow context; do not infer startup intent from slash-command arguments or planning-only artifacts.",
		"Do not include task_type or evaluation_profile in startup-analysis output from free-text discussion. Only explicit structured startup artifacts may supply those routing fields elsewhere in /cook.",
	];
	if (contextLines.length > 0) lines.push("", "Canonical workflow context:", ...contextLines);
	lines.push("", "Recent discussion:", discussion || "(none)");
	return lines.join("\n");
}

function buildCookStartupProgressLines(
	activity: LiveRoleActivity,
	buildInlineRunningLines: (
		details: {
			role?: string;
			startedAt?: number;
			updatedAt?: number;
			currentAction?: string;
			toolActivity?: string;
			toolRecentActivity?: string[];
			recentActivity?: string[];
			assistantSummary?: string;
			progress?: string;
			rationale?: string;
			nextStep?: string;
			verifying?: string;
			stateDeltas?: string[];
		},
		options?: { mode?: "compact" | "expanded" },
	) => string[],
	footerLine: string,
): string[] {
	return [
		...buildInlineRunningLines(
			{
				role: activity.role,
				startedAt: activity.startedAt,
				updatedAt: activity.updatedAt,
				currentAction: activity.currentAction,
				toolActivity: activity.toolActivity,
				toolRecentActivity: activity.toolRecentActivity,
				recentActivity: activity.recentActivity,
				assistantSummary: activity.assistantSummary,
				progress: activity.progress,
				rationale: activity.rationale,
				nextStep: activity.nextStep,
				verifying: activity.verifying,
				stateDeltas: activity.stateDeltas,
			},
			{ mode: "expanded" },
		),
		"",
		footerLine,
	];
}

export function contextProposalAnalystProgressLines(
	activity: LiveRoleActivity,
	buildInlineRunningLines: (
		details: {
			role?: string;
			startedAt?: number;
			updatedAt?: number;
			currentAction?: string;
			toolActivity?: string;
			toolRecentActivity?: string[];
			recentActivity?: string[];
			assistantSummary?: string;
			progress?: string;
			rationale?: string;
			nextStep?: string;
			verifying?: string;
			stateDeltas?: string[];
		},
		options?: { mode?: "compact" | "expanded" },
	) => string[],
): string[] {
	return buildCookStartupProgressLines(activity, buildInlineRunningLines, "This step only prepares a proposal for confirmation.");
}

export function primaryAgentHandoffProgressLines(
	activity: LiveRoleActivity,
	buildInlineRunningLines: (
		details: {
			role?: string;
			startedAt?: number;
			updatedAt?: number;
			currentAction?: string;
			toolActivity?: string;
			toolRecentActivity?: string[];
			recentActivity?: string[];
			assistantSummary?: string;
			progress?: string;
			rationale?: string;
			nextStep?: string;
			verifying?: string;
			stateDeltas?: string[];
		},
		options?: { mode?: "compact" | "expanded" },
	) => string[],
): string[] {
	return buildCookStartupProgressLines(activity, buildInlineRunningLines, "This step only synthesizes the startup plan for Start/Cancel confirmation.");
}

export function buildEvaluationRoleContextLines(
	snapshot: CompletionStateSnapshot,
	role: string,
	deps: {
		asString: (value: unknown) => string | undefined;
		currentTaskType: (snapshot: CompletionStateSnapshot) => string | undefined;
		currentEvaluationProfile: (snapshot: CompletionStateSnapshot) => string | undefined;
		activeSliceContext: (snapshot: CompletionStateSnapshot) => {
			sliceId?: string;
			status?: string;
			goal?: string;
			contractIds: string[];
			acceptance: string[];
			implementationSurfaces: string[];
			verificationCommands: string[];
			lockedNotes: string[];
			mustFixFindings: string[];
			remainingBefore: string[];
			basisCommit?: string;
			releaseBlockerCountBefore?: number;
			highValueGapCountBefore?: number;
		};
		verificationEvidenceContext: (snapshot: CompletionStateSnapshot) => {
			path: string;
			status: string;
			subjectType?: string;
			sliceId?: string;
			contractIds: string[];
			outcome?: string;
			recordedAt?: string;
			headSha?: string;
			basisCommit?: string;
			verificationCommands: string[];
			structuredSummary: string;
			summary: string;
		};
	},
): string[] {
	const context = deps.activeSliceContext(snapshot);
	const evidence = deps.verificationEvidenceContext(snapshot);
	const activeSlicePath = path.relative(snapshot.files.root, snapshot.files.activePath) || ".agent/current/active-slice.json";
	const planPath = path.relative(snapshot.files.root, snapshot.files.planPath) || ".agent/current/plan.json";
	const statePath = path.relative(snapshot.files.root, snapshot.files.statePath) || ".agent/current/state.json";
	const stopHistoryPath = path.relative(snapshot.files.root, snapshot.files.stopHistoryPath) || ".agent/current/stop-check-history.jsonl";
	const lines = [
		`Canonical evaluation handoff for ${role}:`,
		`- task_type: ${deps.currentTaskType(snapshot) ?? "(missing)"}`,
		`- evaluation_profile: ${deps.currentEvaluationProfile(snapshot) ?? "(missing)"}`,
		`- latest_completed_slice: ${deps.asString(snapshot.state?.latest_completed_slice) ?? "(none)"}`,
		`- active_slice_id: ${context.sliceId ?? "(none)"}`,
		`- active_slice_status: ${context.status ?? "(unknown)"}`,
		`- active_slice_contract_path: ${activeSlicePath}`,
		`- active_slice_contract_focus: read acceptance_criteria, implementation_surfaces, verification_commands, locked_notes, must_fix_findings, basis_commit, and before-slice counters directly from ${activeSlicePath}`,
		`- canonical_plan_path: ${planPath}`,
		`- verification_evidence_path: ${evidence.path}`,
		`- verification_evidence_status: ${evidence.status}`,
		`- verification_evidence_focus: read structured evidence fields directly from ${evidence.path}`,
		`- verification_evidence_structured: ${evidence.structuredSummary}`,
		`- verification_evidence_summary: ${evidence.summary}`,
	];
	if (role === "completion-stop-judge") {
		lines.push(`- required_stop_judges: ${snapshot.profile?.required_stop_judges ?? "(missing)"}`);
		lines.push(`- stop_aggregation_policy: ${deps.asString(snapshot.profile?.stop_aggregation_policy) ?? "(missing)"}`);
		lines.push(`- canonical_state_path: ${statePath}`);
		lines.push(`- stop_check_history_path: ${stopHistoryPath}`);
	}
	return lines;
}

export function buildEvaluationRoleReminderText(
	snapshot: CompletionStateSnapshot,
	role: string,
	deps: Parameters<typeof buildEvaluationRoleContextLines>[2],
): string {
	return buildEvaluationRoleContextLines(snapshot, role, deps).join(" ");
}

type CompletionHistoryCounts = {
	reviewed: number;
	audited: number;
	accepted: number;
	reopened: number;
	judgments: number;
};

type CompletionVerificationEvidenceSummary = {
	path: string;
	status: string;
	subjectType?: string;
	sliceId?: string;
	contractIds: string[];
	outcome?: string;
	recordedAt?: string;
	headSha?: string;
	basisCommit?: string;
	verificationCommands: string[];
	structuredSummary: string;
	summary: string;
};

export function buildSystemReminder(args: {
	missionAnchor?: string;
	taskType?: string;
	evaluationProfile?: string;
	currentPhase?: string;
	continuationPolicy?: string;
	nextMandatoryRole?: string;
	nextMandatoryAction?: string;
	remainingSliceCount: number | string;
	exactActiveContract: boolean;
	activeContractDrift: string;
	activePriority?: number;
	activeWhyNow?: string;
	implementationSurfaces: string[];
	verificationCommands: string[];
	activePriorityLine?: string;
	activeWhyNowLine?: string;
	implementationSurfacesLine?: string;
	verificationCommandsLine?: string;
	startupVerifierPostureLine?: string;
	evidence: CompletionVerificationEvidenceSummary;
}): string {
	const lines = [
		"Completion workflow detected.",
		"Canonical truth lives in .agent/current/{state,plan,active-slice,verification-evidence}.json.",
		`Mission anchor: ${args.missionAnchor ?? "(unknown)"}`,
		`Task type: ${args.taskType ?? "(missing)"}`,
		`Evaluation profile: ${args.evaluationProfile ?? "(missing)"}`,
		`Current phase: ${args.currentPhase ?? "unknown"}`,
		`Continuation policy: ${args.continuationPolicy ?? "unknown"}`,
		`Next mandatory role: ${args.nextMandatoryRole ?? "unknown"}`,
		`Next mandatory action: ${args.nextMandatoryAction ?? "unknown"}`,
		`Remaining slice count: ${args.remainingSliceCount}`,
		"After compaction or recovery, re-read canonical .agent state instead of relying on memory.",
		"If continuation_policy == continue, dispatch the next mandatory role directly.",
		"If requires_reground == true and next_mandatory_role == completion-regrounder, auto-dispatch regrounder unless canonical state proves a real external blocker.",
		"Stop only when continuation_policy is await_user_input, blocked, paused, or done.",
		"If canonical state is stale, invalid, ambiguous, or missing, use completion-regrounder.",
	];
	if (args.exactActiveContract) {
		lines.push("For selected/in-progress/committed/done slices, .agent/current/active-slice.json is the canonical contract.");
		lines.push(`Active slice contract drift: ${args.activeContractDrift}`);
	}
	if (args.activePriorityLine) lines.push(args.activePriorityLine);
	else if (args.activePriority !== undefined) lines.push(`Active slice priority: ${args.activePriority}`);
	if (args.activeWhyNowLine) lines.push(args.activeWhyNowLine);
	else if (args.activeWhyNow) lines.push(`Active slice why_now: ${args.activeWhyNow}`);
	if (args.implementationSurfacesLine) lines.push(args.implementationSurfacesLine);
	else if (args.implementationSurfaces.length > 0) lines.push(`Implementation surfaces: ${args.implementationSurfaces.join(", ")}`);
	if (args.verificationCommandsLine) lines.push(args.verificationCommandsLine);
	else if (args.verificationCommands.length > 0) lines.push(`Verification commands: ${args.verificationCommands.join(" | ")}`);
	if (args.startupVerifierPostureLine) lines.push(args.startupVerifierPostureLine);
	lines.push(`Evidence artifact: ${args.evidence.path} (${args.evidence.status})`);
	lines.push(`Evidence structured: ${args.evidence.structuredSummary}`);
	lines.push(`Evidence summary: ${args.evidence.summary}`);
	return lines.join(" ");
}

export function buildResumeCapsule(args: {
	missionAnchor?: string;
	taskType?: string;
	evaluationProfile?: string;
	currentPhase?: string;
	continuationPolicy?: string;
	continuationReason?: string;
	requiresReground: boolean | string;
	nextMandatoryRole?: string;
	nextMandatoryAction?: string;
	remainingSliceCount: number | string;
	remainingStopJudges: number | string;
	history: CompletionHistoryCounts;
	activeSliceMatchesPlan: "yes" | "no" | "unknown";
	activeSliceContractDrift: string;
	implementerHandoffSnapshot: "present" | "missing_or_unclear";
	startupVerifierPostureLine?: string;
	evidence: CompletionVerificationEvidenceSummary;
	activeSlice: {
		sliceId?: string;
		status?: string;
		goal?: string;
		priority?: number;
		whyNow?: string;
		contractIds: string[];
		blockedOn: string[];
		lockedNotes: string[];
		mustFixFindings: string[];
		implementationSurfaces: string[];
		verificationCommands: string[];
		implementationSurfacesLine?: string;
		verificationCommandsLine?: string;
		basisCommit?: string;
		remainingContractIdsBefore: string[];
		releaseBlockerCountBefore?: number;
		highValueGapCountBefore?: number;
		acceptanceCriteria: string[];
	};
}): string {
	const lines = [
		"Authoritative completion resume capsule:",
		"",
		"<completion-state>",
		`mission_anchor: ${args.missionAnchor ?? "(unknown)"}`,
		`task_type: ${args.taskType ?? "(missing)"}`,
		`evaluation_profile: ${args.evaluationProfile ?? "(missing)"}`,
		`current_phase: ${args.currentPhase ?? "unknown"}`,
		`continuation_policy: ${args.continuationPolicy ?? "unknown"}`,
		`continuation_reason: ${args.continuationReason ?? "(unknown)"}`,
		`requires_reground: ${args.requiresReground}`,
		`next_mandatory_role: ${args.nextMandatoryRole ?? "unknown"}`,
		`next_mandatory_action: ${args.nextMandatoryAction ?? "unknown"}`,
		`remaining_slice_count: ${args.remainingSliceCount}`,
		`remaining_stop_judges: ${args.remainingStopJudges}`,
		`active_slice_matches_plan: ${args.activeSliceMatchesPlan}`,
		`active_slice_contract_drift_fields: ${args.activeSliceContractDrift}`,
		`implementer_handoff_snapshot: ${args.implementerHandoffSnapshot}`,
		`history_counts: reviewed=${args.history.reviewed}, audited=${args.history.audited}, accepted=${args.history.accepted}, reopened=${args.history.reopened}, judgments=${args.history.judgments}`,
		...(args.startupVerifierPostureLine ? [args.startupVerifierPostureLine] : []),
		"",
		"verification_evidence:",
		`- path: ${args.evidence.path}`,
		`- status: ${args.evidence.status}`,
		`- subject_type: ${args.evidence.subjectType ?? "(missing)"}`,
		`- slice_id: ${args.evidence.sliceId ?? "(none)"}`,
		`- contract_ids: ${args.evidence.contractIds.length > 0 ? args.evidence.contractIds.join(", ") : "(none)"}`,
		`- outcome: ${args.evidence.outcome ?? "(missing)"}`,
		`- recorded_at: ${args.evidence.recordedAt ?? "(missing)"}`,
		`- head_sha: ${args.evidence.headSha ?? "(missing)"}`,
		`- basis_commit: ${args.evidence.basisCommit ?? "(missing)"}`,
		`- verification_commands: ${args.evidence.verificationCommands.length > 0 ? args.evidence.verificationCommands.join(" | ") : "(none)"}`,
		`- structured_summary: ${args.evidence.structuredSummary}`,
		`- summary: ${args.evidence.summary}`,
		"",
		"active_slice:",
		`- slice_id: ${args.activeSlice.sliceId ?? "(none)"}`,
		`- status: ${args.activeSlice.status ?? "unknown"}`,
		`- goal: ${args.activeSlice.goal ?? "(unknown)"}`,
		`- priority: ${args.activeSlice.priority ?? "(unknown)"}`,
		`- why_now: ${args.activeSlice.whyNow ?? "(unknown)"}`,
		`- contract_ids: ${args.activeSlice.contractIds.length > 0 ? args.activeSlice.contractIds.join(", ") : "(none)"}`,
	];
	if (args.activeSlice.blockedOn.length > 0) lines.push(`- blocked_on: ${args.activeSlice.blockedOn.join(", ")}`);
	if (args.activeSlice.lockedNotes.length > 0) lines.push(`- locked_notes: ${args.activeSlice.lockedNotes.join(" | ")}`);
	if (args.activeSlice.mustFixFindings.length > 0) lines.push(`- must_fix_findings: ${args.activeSlice.mustFixFindings.join(" | ")}`);
	if (args.activeSlice.implementationSurfacesLine) {
		lines.push(args.activeSlice.implementationSurfacesLine);
	} else if (args.activeSlice.implementationSurfaces.length > 0) {
		lines.push(`- implementation_surfaces: ${args.activeSlice.implementationSurfaces.join(" | ")}`);
	}
	if (args.activeSlice.verificationCommandsLine) {
		lines.push(args.activeSlice.verificationCommandsLine);
	} else if (args.activeSlice.verificationCommands.length > 0) {
		lines.push(`- verification_commands: ${args.activeSlice.verificationCommands.join(" | ")}`);
	}
	lines.push(`- basis_commit: ${args.activeSlice.basisCommit ?? "(none)"}`);
	lines.push(`- remaining_contract_ids_before: ${args.activeSlice.remainingContractIdsBefore.length > 0 ? args.activeSlice.remainingContractIdsBefore.join(", ") : "(none)"}`);
	lines.push(`- release_blocker_count_before: ${args.activeSlice.releaseBlockerCountBefore ?? "(unknown)"}`);
	lines.push(`- high_value_gap_count_before: ${args.activeSlice.highValueGapCountBefore ?? "(unknown)"}`);
	lines.push("", "acceptance_criteria:");
	if (args.activeSlice.acceptanceCriteria.length === 0) lines.push("- (none)");
	else lines.push(...args.activeSlice.acceptanceCriteria.map((item) => `- ${item}`));
	lines.push(
		"",
		"Rules:",
		"- Treat this block as continuity support derived from canonical .agent state.",
		"- For selected/in-progress/committed/done slices, .agent/current/active-slice.json is the canonical implementation contract and the selected plan slice must mirror it exactly.",
		"- Preserve exact slice_id, goal, contract_ids, acceptance criteria, blocked_on, priority, why_now, implementation surfaces, verification commands, locked notes, must-fix findings, basis_commit, and before-slice counters where still true.",
		"- When populated, .agent/current/verification-evidence.json is the durable canonical verification record for the selected slice or current HEAD and should be consumed instead of temp-only artifacts or conversational summaries.",
		"- After compaction, re-read .agent/current/state.json, .agent/current/plan.json, .agent/current/active-slice.json, .agent/current/slice-history.jsonl, .agent/current/stop-check-history.jsonl, and .agent/current/verification-evidence.json before resuming long-running completion work.",
		"- Invoke completion-regrounder before continuing when requires_reground is true or unknown.",
		"- Invoke completion-regrounder before continuing when next_mandatory_role or next_mandatory_action is unknown or ambiguous.",
		"- Invoke completion-regrounder before continuing when active_slice_matches_plan is no, active_slice_contract_drift_fields is not none, or implementer_handoff_snapshot is missing_or_unclear.",
		"- If continuation_policy is continue, do not stop after a slice or ask whether to continue. Dispatch the next mandatory role directly.",
		"- requires_reground == true with next_mandatory_role == completion-regrounder is still a continue-state handoff when canonical reconciliation can proceed safely without new user input.",
		"- Only stop for the user when continuation_policy is await_user_input, blocked, paused, or done.",
		"- Reserve blocked for cases where canonical reconciliation still needs user input, conflict resolution, ownership clarification, or another external unblock action.",
		"- `/cook park` is available anytime an active workflow exists, including while continuation_policy is continue, to record a parked paused posture for ordinary direct edits; resume still requires canonical reground.",
		"- When canonical state is stopped (await_user_input, blocked, or paused), rerun /cook or /cook resume to continue, or /cook cancel to close the workflow.",
		"- If you are completion-implementer after compaction, resume from the canonical active-slice implementation contract instead of asking the user to resend the original caller payload.",
		"- Do not replace canonical .agent state with summary inference.",
		"</completion-state>",
	);
	return lines.join("\n");
}
