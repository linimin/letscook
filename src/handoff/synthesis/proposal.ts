import {
	buildContextProposalAnalystPrompt,
	buildContextProposalGoalText,
} from "./prompt-surfaces.ts";
import type { StartupIntentHints } from "./startup-intent.ts";
import type { StartupAnalysisConfidence, StartupAnalysisVerdict, StartupWorkflowRelation } from "./completion-types.ts";

const DEFAULT_TASK_TYPE = "completion-workflow";
const DEFAULT_EVALUATION_PROFILE = "completion-rubric-v1";

type JsonRecord = Record<string, unknown>;

export type ContextProposalAnalysis = {
	taskType?: string;
	evaluationProfile?: string;
	startupVerdict?: StartupAnalysisVerdict;
	workflowRelation?: StartupWorkflowRelation;
	confidence?: StartupAnalysisConfidence;
	diagnostics: string[];
	critique: string[];
	risks: string[];
	possibleNoise: string[];
	alternateMissions: string[];
	suppressedCompletedTopics: string[];
	suppressedNegatedTopics: string[];
};

export type ContextProposalStartupHints = StartupIntentHints;

export type ContextProposalAlternate = {
	mission: string;
	scope: string[];
	constraints: string[];
	acceptance: string[];
	analysis: ContextProposalAnalysis;
	goalText: string;
	basisPreview: string;
	source: "session" | "analyst" | "handoff_capsule" | "deferred_primary_agent_handoff";
	startupHints?: ContextProposalStartupHints;
};

export type ContextProposal = ContextProposalAlternate & {
	alternateProposals: ContextProposalAlternate[];
};

export type ContextProposalSection = "mission" | "scope" | "constraints" | "acceptance" | "critique" | "risks";

export type RecentDiscussionEntry = {
	role: "user" | "assistant" | "custom" | "summary";
	text: string;
};

export type RecentSessionMessage = RecentDiscussionEntry & {
	messageId?: string;
	timestampMs?: number;
	isCommand: boolean;
};

export type CookHandoffCapsule = {
	kind: "cook_handoff";
	source: "primary_agent";
	captured_at: string;
	source_turn_id: string;
	mission: string;
	scope: string[];
	constraints: string[];
	non_goals: string[];
	acceptance: string[];
	risks: string[];
	notes: string[];
	handoff_kind: "implementation_workflow_handoff";
	first_slice_goal?: string;
	first_slice_non_goals: string[];
	implementation_surfaces: string[];
	verification_commands: string[];
	why_this_slice_first?: string;
	verification_truth_mode?: string;
	deterministic_verifier_ready?: boolean;
	verification_latency?: string;
	verification_noise_risk?: string;
	verifier_gap?: string;
	recommended_first_slice_kind?: string;
	task_type?: string;
	evaluation_profile?: string;
	why_cook_now?: string;
};

export type CookHandoffProposalAssessment =
	| {
		status: "none";
	  }
	| {
		status: "startable";
		proposal: ContextProposal;
	  };

export type ContextProposalDecision = {
	missionAnchor: string;
	goalText: string;
	analysis: ContextProposalAnalysis;
};

export type ContextProposalConfirmAction = "start" | "cancel";

export type ContextProposalConfirmationActionItem = {
	id: ContextProposalConfirmAction;
	label: string;
	description: string;
};

export type ContextProposalConfirmationLayout = {
	title: string;
	intro: string;
	proposalHeading: string;
	proposalBody: string;
	critiqueHeading?: string;
	critiqueBody?: string;
	routingHeading?: string;
	routingBody?: string;
	actionsHeading: string;
	actions: ContextProposalConfirmationActionItem[];
	footer: string;
};

export type ContextProposalConfirmOptions = {
	title: string;
	nonInteractiveBehavior?: "accept" | "cancel";
};

export type ContextProposalWorkflowContext = {
	currentMissionAnchor?: string;
	latestCompletedSlice?: string;
	latestVerifiedSlice?: string;
	activeSliceGoal?: string;
	activeSliceWhyNow?: string;
	verificationGoal?: string;
	verificationSummary?: string;
	continuationPolicy?: string;
};

type ProposalCommonDeps = {
	asString: (value: unknown) => string | undefined;
	asStringArray: (value: unknown) => string[];
	assessMissionAnchor: (text: string, projectName: string) => { derived: string };
	normalizeMissionAnchorText: (text: string) => string;
	isWeakMissionAnchor: (text: string) => boolean;
	missionAnchorsStrictlyEquivalent: (left: string, right: string) => boolean;
};

type ProposalParseDeps = ProposalCommonDeps & {
	stripCodeBlocks: (text: string) => string;
};

type AnalystParseDeps = ProposalCommonDeps & {
	extractJsonObjectFromText: (text: string) => string | undefined;
	isRecord: (value: unknown) => value is JsonRecord;
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

function localAsBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized === "true") return true;
	if (normalized === "false") return false;
	return undefined;
}

function localIsRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractTextFromMessageContent(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.map((item) => {
			if (!localIsRecord(item)) return "";
			if (item.type !== "text") return "";
			return localAsString(item.text) ?? "";
		})
		.filter((item) => item.length > 0)
		.join("\n")
		.trim();
}

export function normalizeMissionAnchorText(value: string): string {
	return value
		.replace(/^\/(?:cook|complete)\s+/i, "")
		.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
		.replace(/^\s*(please|pls|can you|could you|help me|i want to|we need to|let'?s|continue to|continue|resume)\s+/i, "")
		.replace(/\s+/g, " ")
		.replace(/[。！？.!?]+$/u, "")
		.trim();
}

export function isWeakMissionAnchor(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	if (normalized.length < 8) return true;
	if (["continue", "resume", "fix", "fix it", "work on this", "help", "do it", "try again"].includes(normalized)) return true;
	if (/^(continue|resume|fix|help|work on)(\s+.*)?$/i.test(normalized) && normalized.split(/\s+/).length <= 3) return true;
	return false;
}

export function deriveMissionAnchor(rawGoal: string, projectName: string): string {
	const normalized = normalizeMissionAnchorText(rawGoal);
	if (!normalized || isWeakMissionAnchor(normalized)) {
		return `Drive ${projectName} to truthful, verifiable completion.`;
	}
	const mission = normalized.replace(/\s+/g, " ").trim();
	return /[.!?。！？]$/u.test(mission) ? mission : `${mission}.`;
}

export function assessMissionAnchor(rawGoal: string, projectName: string): { derived: string } {
	return { derived: deriveMissionAnchor(rawGoal, projectName) };
}

export function stripCodeBlocks(text: string): string {
	return text.replace(/```[\s\S]*?```/g, " ");
}

const MISSION_SCOPE_FILTER_STOPWORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"goal",
	"goals",
	"in",
	"into",
	"is",
	"it",
	"its",
	"mission",
	"of",
	"on",
	"or",
	"scope",
	"that",
	"the",
	"their",
	"this",
	"to",
	"using",
	"with",
	"workflow",
]);

function missionScopeFilterTokens(text: string): string[] {
	const normalized = normalizeProposalLine(text).toLowerCase();
	const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
	return tokens.filter((token) => {
		if (/^[\p{Script=Han}]+$/u.test(token)) return token.length >= 2;
		if (token.length < 2) return false;
		return !MISSION_SCOPE_FILTER_STOPWORDS.has(token);
	});
}

export function isSessionScopeItemMissionRelevant(item: string, mission: string): boolean {
	const normalizedItem = normalizeProposalLine(item).toLowerCase();
	const normalizedMission = normalizeMissionAnchorText(mission).toLowerCase();
	if (!normalizedItem || !normalizedMission) return true;
	if (normalizedItem.includes(normalizedMission) || normalizedMission.includes(normalizedItem)) return true;
	const itemTokens = [...new Set(missionScopeFilterTokens(normalizedItem))];
	const missionTokens = new Set(missionScopeFilterTokens(normalizedMission));
	if (itemTokens.length === 0 || missionTokens.size === 0) return true;
	const overlap = itemTokens.filter((token) => missionTokens.has(token));
	if (overlap.length >= 2) return true;
	return overlap.some((token) => token.length >= 6 || /[\p{Script=Han}]/u.test(token));
}

function missionAnchorSemanticTokens(text: string): string[] {
	return [...new Set(missionScopeFilterTokens(normalizeMissionAnchorText(text).toLowerCase()))];
}

function missionAnchorOrderedTokenOverlapRatio(leftTokens: string[], rightTokens: string[]): number {
	if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
	const dp = new Array(rightTokens.length + 1).fill(0);
	for (const leftToken of leftTokens) {
		let previous = 0;
		for (let index = 0; index < rightTokens.length; index += 1) {
			const nextPrevious = dp[index + 1];
			if (leftToken === rightTokens[index]) {
				dp[index + 1] = previous + 1;
			} else {
				dp[index + 1] = Math.max(dp[index + 1], dp[index]);
			}
			previous = nextPrevious;
		}
	}
	return dp[rightTokens.length] / Math.max(leftTokens.length, rightTokens.length);
}

function missionAnchorBigramOverlapRatio(leftTokens: string[], rightTokens: string[]): number {
	if (leftTokens.length < 2 || rightTokens.length < 2) return 0;
	const leftBigrams = new Set(leftTokens.slice(0, -1).map((token, index) => `${token} ${leftTokens[index + 1]}`));
	const rightBigrams = new Set(rightTokens.slice(0, -1).map((token, index) => `${token} ${rightTokens[index + 1]}`));
	if (leftBigrams.size === 0 || rightBigrams.size === 0) return 0;
	let overlap = 0;
	for (const bigram of leftBigrams) {
		if (rightBigrams.has(bigram)) overlap += 1;
	}
	return overlap / Math.max(leftBigrams.size, rightBigrams.size);
}

export function missionAnchorsStrictlyEquivalent(left: string, right: string): boolean {
	return normalizeMissionAnchorText(left).toLowerCase() === normalizeMissionAnchorText(right).toLowerCase();
}

const MISSION_NEGATION_CUE_REGEX = /(?:^|[^\p{L}\p{N}_])(?:no|not|without|never|cannot|don['’]?t)(?=$|[^\p{L}\p{N}_])/u;

function missionAnchorHasNegationCue(text: string): boolean {
	return MISSION_NEGATION_CUE_REGEX.test(text);
}

export function missionAnchorsLikelyEquivalent(left: string, right: string): boolean {
	const normalizedLeft = normalizeMissionAnchorText(left).toLowerCase();
	const normalizedRight = normalizeMissionAnchorText(right).toLowerCase();
	if (!normalizedLeft || !normalizedRight) return false;
	const leftHasNegationCue = missionAnchorHasNegationCue(normalizedLeft);
	const rightHasNegationCue = missionAnchorHasNegationCue(normalizedRight);
	if (leftHasNegationCue !== rightHasNegationCue) return false;
	if (normalizedLeft === normalizedRight) return true;
	if (!leftHasNegationCue && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))) return true;
	const leftTokens = missionAnchorSemanticTokens(normalizedLeft);
	const rightTokens = missionAnchorSemanticTokens(normalizedRight);
	if (leftTokens.length === 0 || rightTokens.length === 0) return false;
	const rightSet = new Set(rightTokens);
	const overlap = leftTokens.filter((token) => rightSet.has(token));
	if (overlap.length < 3) return false;
	const maxLen = Math.max(leftTokens.length, rightTokens.length);
	if (overlap.length / maxLen < 0.75) return false;
	if (missionAnchorOrderedTokenOverlapRatio(leftTokens, rightTokens) < 0.75) return false;
	if (Math.min(leftTokens.length, rightTokens.length) < 4) return true;
	return missionAnchorBigramOverlapRatio(leftTokens, rightTokens) >= 0.5;
}

export function collectRecentSessionMessages(ctx: { sessionManager: any }, deps: {
	isRecord: (value: unknown) => boolean;
	asString?: (value: unknown) => string | undefined;
	asNumber?: (value: unknown) => number | undefined;
	isStaleContextError?: (error: unknown) => boolean;
}, limit = 24): RecentSessionMessage[] {
	let branch: any[] = [];
	try {
		branch = ctx.sessionManager?.getBranch?.() ?? [];
	} catch (error) {
		if (deps.isStaleContextError?.(error)) return [];
		throw error;
	}
	const asStringValue = deps.asString ?? localAsString;
	const asNumberValue = deps.asNumber ?? localAsNumber;
	const entries: RecentSessionMessage[] = [];
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (!deps.isRecord(entry) || entry.type !== "message" || !deps.isRecord(entry.message)) continue;
		const message = entry.message as JsonRecord;
		const messageRole = asStringValue(message.role);
		if (messageRole !== "user" && messageRole !== "assistant" && messageRole !== "custom" && messageRole !== "summary") continue;
		const text = extractTextFromMessageContent(message.content);
		if (!text) continue;
		const trimmed = text.trim();
		if (!trimmed) continue;
		entries.push({
			role: messageRole as RecentDiscussionEntry["role"],
			text: trimmed,
			messageId: asStringValue((entry as JsonRecord).id),
			timestampMs: asNumberValue(message.timestamp),
			isCommand: /^\//.test(trimmed),
		});
		if (entries.length >= limit) break;
	}
	return entries;
}

export function collectRecentDiscussionEntries(ctx: { sessionManager: any }, deps: {
	isRecord: (value: unknown) => boolean;
	asString?: (value: unknown) => string | undefined;
	asNumber?: (value: unknown) => number | undefined;
	isStaleContextError?: (error: unknown) => boolean;
}, limit = 8): RecentDiscussionEntry[] {
	return collectRecentSessionMessages(ctx, deps, Math.max(limit * 3, limit))
		.filter((entry) => (entry.role === "user" || entry.role === "custom") && !entry.isCommand)
		.slice(0, limit)
		.map((entry) => ({ role: entry.role, text: entry.text }));
}

export function serializeRecentDiscussionEntries(entries: RecentDiscussionEntry[]): string {
	return entries
		.slice()
		.reverse()
		.map((entry, index) => `[${index + 1}] ${entry.role.toUpperCase()}\n${entry.text}`)
		.join("\n\n");
}

const RECENT_DISCUSSION_IMPLEMENTATION_INTENT_REGEX =
	/(?:\b(?:fix|update|add|remove|restore|refactor|ship|support|wire|route|rewrite|replace|preserve|filter|separate|refresh|reroute|suppress|align|convert|reconcile|repair|correct|implement|build|land|block|allow|keep|edit|document|write)\b|(?:修正|修復|修复|更新|新增|移除|恢復|恢复|重構|重构|調整|调整|過濾|过滤|分離|分离|刷新|替換|替换|抑制|對齊|对齐|實作|实现|落地|修補|修补|阻止|允許|允许|轉換|转换|保留|保持))/iu;

export function hasRecentDiscussionImplementationIntent(text: string, stripCodeBlocksFn: (text: string) => string): boolean {
	const cleaned = stripCodeBlocksFn(text).replace(/\r/g, " ").trim();
	if (!cleaned) return false;
	return hasStructuredContextProposalSignal(cleaned, stripCodeBlocksFn) || RECENT_DISCUSSION_IMPLEMENTATION_INTENT_REGEX.test(cleaned);
}

function recentDiscussionWindows(
	recentEntries: RecentDiscussionEntry[],
	stripCodeBlocksFn: (text: string) => string,
): RecentDiscussionEntry[][] {
	if (recentEntries.length === 0) return [];
	const windows: RecentDiscussionEntry[][] = [];
	const seen = new Set<string>();
	const pushWindow = (entries: RecentDiscussionEntry[]) => {
		if (entries.length === 0) return;
		const key = entries.map((entry) => `${entry.role}:${entry.text}`).join("\n---\n");
		if (seen.has(key)) return;
		seen.add(key);
		windows.push(entries);
	};
	const latestEntry = recentEntries[0];
	if (hasRecentDiscussionImplementationIntent(latestEntry.text, stripCodeBlocksFn)) {
		pushWindow([latestEntry]);
	}
	const recentIntentWindow = recentEntries.filter((entry, index) => index < 3);
	if (recentIntentWindow.some((entry) => hasRecentDiscussionImplementationIntent(entry.text, stripCodeBlocksFn))) {
		pushWindow(recentIntentWindow);
	}
	pushWindow(recentEntries);
	return windows;
}

export function extractJsonObjectFromText(text: string): string | undefined {
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
	if (unfenced.startsWith("{") && unfenced.endsWith("}")) return unfenced;
	const start = unfenced.indexOf("{");
	const end = unfenced.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	return unfenced.slice(start, end + 1);
}

export function normalizeProposalLine(line: string): string {
	return line
		.replace(/^[-*+]\s+/, "")
		.replace(/^\d+[.)]\s+/, "")
		.replace(/^\[.?\]\s+/, "")
		.replace(/^>\s*/, "")
		.replace(/^[`*_~]+|[`*_~]+$/g, "")
		.replace(/^\*\*(.+)\*\*$/u, "$1")
		.replace(/^__([^_]+)__$/u, "$1")
		.trim();
}

function detectProposalSection(line: string): ContextProposalSection | undefined {
	const normalized = normalizeProposalLine(line)
		.toLowerCase()
		.replace(/[:：]$/, "")
		.trim();
	if (!normalized) return undefined;
	if (["mission", "goal", "objective", "summary", "目標", "任務", "計劃", "计划", "方案"].includes(normalized)) return "mission";
	if (["scope", "plan", "steps", "implementation", "範圍", "范围", "實作", "实现", "步驟", "步骤"].includes(normalized)) return "scope";
	if (["constraints", "constraint", "guardrails", "non-goals", "限制", "約束", "约束", "非目標", "非目标"].includes(normalized)) return "constraints";
	if (["acceptance", "acceptance criteria", "deliverables", "verification", "驗收", "验收", "交付", "驗證", "验证"].includes(normalized)) return "acceptance";
	if (["critique", "critic", "concerns", "concern", "warnings", "warning", "notes", "note", "評論", "评论", "提醒"].includes(normalized)) return "critique";
	if (["risk", "risks", "hazards", "hazard", "failure modes", "failure mode", "風險", "风险"].includes(normalized)) return "risks";
	return undefined;
}

function matchInlineProposalSection(line: string): { section: ContextProposalSection; content: string } | undefined {
	const normalized = normalizeProposalLine(line);
	const match = normalized.match(/^([^:：]+)[:：]\s*(.+)$/u);
	if (!match) return undefined;
	const [, rawLabel, rawContent] = match;
	const section = detectProposalSection(rawLabel);
	const content = rawContent.trim();
	if (!section || !content) return undefined;
	return { section, content };
}

function bulletText(line: string): string | undefined {
	if (!/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) return undefined;
	const normalized = normalizeProposalLine(line);
	return normalized.length > 0 ? normalized : undefined;
}

function looksLikeConstraint(text: string): boolean {
	return /(do not|don't|must not|avoid|without|keep\b|preserve|retain|remain|不要|不可|不能|不應|不应|保持|保留|避免)/i.test(text);
}

function looksLikeAcceptance(text: string): boolean {
	return /(test|tests|testing|verify|verification|validated|README|docs?|documentation|regression|observability|驗證|验证|測試|测试|文件|文檔|文档|回歸|回归)/i.test(text);
}

function uniqueProposalItems(items: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of items) {
		const normalized = normalizeProposalLine(item).replace(/\s+/g, " ").trim();
		if (!normalized) continue;
		const key = normalized.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(normalized);
	}
	return result;
}

function normalizeContextProposalHint(value: unknown, asString: (value: unknown) => string | undefined): string | undefined {
	const normalized = asString(value)?.replace(/\s+/g, " ").trim();
	return normalized || undefined;
}

function normalizeContextProposalTaskTypeHint(value: unknown, asString: (value: unknown) => string | undefined): string | undefined {
	const normalized = normalizeContextProposalHint(value, asString);
	if (!normalized) return undefined;
	const canonical = normalized.toLowerCase().replace(/[\s/]+/g, "-");
	return canonical === DEFAULT_TASK_TYPE ? DEFAULT_TASK_TYPE : normalized;
}

function normalizeContextProposalEvaluationProfileHint(value: unknown, asString: (value: unknown) => string | undefined): string | undefined {
	const normalized = normalizeContextProposalHint(value, asString);
	if (!normalized) return undefined;
	const canonical = normalized.toLowerCase().replace(/[\s/]+/g, "-");
	return canonical === DEFAULT_EVALUATION_PROFILE ? DEFAULT_EVALUATION_PROFILE : normalized;
}

export function buildContextProposalAnalysis(args: {
	taskType?: unknown;
	evaluationProfile?: unknown;
	startupVerdict?: StartupAnalysisVerdict;
	workflowRelation?: StartupWorkflowRelation;
	confidence?: StartupAnalysisConfidence;
	diagnostics?: string[];
	critique?: string[];
	risks?: string[];
	possibleNoise?: string[];
	alternateMissions?: string[];
	suppressedCompletedTopics?: string[];
	suppressedNegatedTopics?: string[];
	hintTexts?: string[];
}, deps: Pick<ProposalCommonDeps, "asString">): ContextProposalAnalysis {
	const diagnostics = uniqueProposalItems(args.diagnostics ?? []);
	const critique = uniqueProposalItems(args.critique ?? []);
	const risks = uniqueProposalItems(args.risks ?? []);
	const possibleNoise = uniqueProposalItems(args.possibleNoise ?? []);
	const alternateMissions = uniqueProposalItems(args.alternateMissions ?? []);
	const suppressedCompletedTopics = uniqueProposalItems(args.suppressedCompletedTopics ?? []);
	const suppressedNegatedTopics = uniqueProposalItems(args.suppressedNegatedTopics ?? []);
	const taskType = normalizeContextProposalTaskTypeHint(args.taskType, deps.asString);
	const evaluationProfile = normalizeContextProposalEvaluationProfileHint(args.evaluationProfile, deps.asString);
	return {
		taskType,
		evaluationProfile,
		startupVerdict: args.startupVerdict,
		workflowRelation: args.workflowRelation,
		confidence: args.confidence,
		diagnostics,
		critique,
		risks,
		possibleNoise,
		alternateMissions,
		suppressedCompletedTopics,
		suppressedNegatedTopics,
	};
}

function mergeContextProposalAnalysis(
	sources: Array<ContextProposalAnalysis | undefined>,
	_hintTexts: string[] = [],
): ContextProposalAnalysis {
	const diagnostics = uniqueProposalItems(sources.flatMap((source) => source?.diagnostics ?? []));
	const critique = uniqueProposalItems(sources.flatMap((source) => source?.critique ?? []));
	const risks = uniqueProposalItems(sources.flatMap((source) => source?.risks ?? []));
	const possibleNoise = uniqueProposalItems(sources.flatMap((source) => source?.possibleNoise ?? []));
	const alternateMissions = uniqueProposalItems(sources.flatMap((source) => source?.alternateMissions ?? []));
	const suppressedCompletedTopics = uniqueProposalItems(sources.flatMap((source) => source?.suppressedCompletedTopics ?? []));
	const suppressedNegatedTopics = uniqueProposalItems(sources.flatMap((source) => source?.suppressedNegatedTopics ?? []));
	const taskType = sources.map((source) => source?.taskType).find((value): value is string => Boolean(value));
	const evaluationProfile = sources
		.map((source) => source?.evaluationProfile)
		.find((value): value is string => Boolean(value));
	return {
		taskType,
		evaluationProfile,
		startupVerdict: sources.map((source) => source?.startupVerdict).find((value): value is StartupAnalysisVerdict => Boolean(value)),
		workflowRelation: sources.map((source) => source?.workflowRelation).find((value): value is StartupWorkflowRelation => Boolean(value)),
		confidence: sources.map((source) => source?.confidence).find((value): value is StartupAnalysisConfidence => Boolean(value)),
		diagnostics,
		critique,
		risks,
		possibleNoise,
		alternateMissions,
		suppressedCompletedTopics,
		suppressedNegatedTopics,
	};
}

export function finalizeContextProposalAnalysis(
	analysis: ContextProposalAnalysis | undefined,
	hintTexts: string[] = [],
): ContextProposalAnalysis {
	const merged = mergeContextProposalAnalysis(analysis ? [analysis] : [], hintTexts);
	return {
		taskType: merged.taskType ?? DEFAULT_TASK_TYPE,
		evaluationProfile: merged.evaluationProfile ?? DEFAULT_EVALUATION_PROFILE,
		startupVerdict: merged.startupVerdict,
		workflowRelation: merged.workflowRelation,
		confidence: merged.confidence,
		diagnostics: merged.diagnostics,
		critique: merged.critique,
		risks: merged.risks,
		possibleNoise: merged.possibleNoise,
		alternateMissions: merged.alternateMissions,
		suppressedCompletedTopics: merged.suppressedCompletedTopics,
		suppressedNegatedTopics: merged.suppressedNegatedTopics,
	};
}

function matchContextProposalRoutingHint(
	line: string,
): { field: "taskType" | "evaluationProfile"; value: string } | undefined {
	const normalized = normalizeProposalLine(line);
	const match = normalized.match(/^(task[\s_-]*type|evaluation[\s_-]*profile)[:：]\s*(.+)$/iu);
	if (!match) return undefined;
	const label = match[1].toLowerCase().replace(/[\s_-]+/g, "");
	const value = match[2].trim();
	if (!value) return undefined;
	return label === "tasktype" ? { field: "taskType", value } : { field: "evaluationProfile", value };
}

const CONTEXT_PROPOSAL_GENERIC_PLANNING_MISSION_REGEX =
	/(?:\b(?:start(?:ing)?|begin|continue|continu(?:e|ing)|resume|implement(?:ing)?|execute|execut(?:e|ing)|carry out|work on|ship|build(?:ing)?)\b.*\b(?:this|that|the|current|latest)\s+(?:plan|proposal|spec(?:ification)?|design(?: doc(?:ument)?)?|migration plan)\b|(?:開始|著手|繼續|继续|恢復|恢复)?(?:實作|实现|執行|执行|落地|完成)(?:這個|这个|此|該|该)?(?:方案|計畫|计划|提案|規劃|规划|設計|设计))/iu;
const CONTEXT_PROPOSAL_PLANNING_ONLY_DELIVERABLE_REGEX =
	/(?:\b(?:write|draft|prepare|create|produce|share|deliver|document|review)\b.*\b(?:plan|spec(?:ification)?|design(?: doc(?:ument)?)?|migration plan|proposal)\b|(?:撰寫|撰写|編寫|编写|起草|準備|准备|產出|产出|整理|分享|交付|審查|审查).*(?:計畫|计划|規格|规格|設計文件|设计文档|提案|方案))/iu;
const CONTEXT_PROPOSAL_DOCS_ONLY_SIGNAL_REGEX = /(?:\b(?:docs? only|documentation only)\b|(?:只改文件|僅文件|仅文件))/iu;
const CONTEXT_PROPOSAL_NO_IMPLEMENTATION_SIGNAL_REGEX =
	/(?:\b(?:no code(?: changes?)?|without code(?: changes?)?|do not implement|don't implement|planning only|proposal only|spec only|design[- ]doc only|no runtime changes?)\b|(?:不改(?:動)?代碼|不改代码|不要實作|不要实现|只規劃|只规划|僅規劃|仅规划|不改(?:動)?執行|不改运行))/iu;
const CONTEXT_PROPOSAL_IMPLEMENTATION_SOURCE_REGEX =
	/(?:\b(?:normalize|fix|update|add|remove|restore|refactor|ship|support|wire|route|rewrite|replace|preserve|filter|separate|refresh|reroute|suppress|align|convert|reconcile|repair|correct|implement|build|land|block|allow|keep|edit(?:ing)?|document(?:ing)?|writ(?:e|ing))\b|(?:修正|修復|修复|更新|新增|移除|恢復|恢复|重構|重构|調整|调整|正規化|规范化|規範化|过滤|過濾|分離|分离|刷新|替換|替换|抑制|對齊|对齐|實作|实现|落地|修補|修补|阻止|允許|允许|轉換|转换|保留|保持))/iu;

function contextProposalBodyTexts(proposal: Pick<ContextProposal, "scope" | "constraints" | "acceptance">): string[] {
	return [...proposal.scope, ...proposal.constraints, ...proposal.acceptance];
}

function isGenericPlanningMissionAnchor(text: string, deps: Pick<ProposalCommonDeps, "normalizeMissionAnchorText">): boolean {
	const normalized = deps.normalizeMissionAnchorText(text);
	if (!normalized) return false;
	return CONTEXT_PROPOSAL_GENERIC_PLANNING_MISSION_REGEX.test(normalized);
}

function hasExplicitPlanningOnlyDeliverable(texts: string[]): boolean {
	return texts.some((text) => CONTEXT_PROPOSAL_PLANNING_ONLY_DELIVERABLE_REGEX.test(normalizeProposalLine(text)));
}

function normalizeImplementationMissionSourceText(text: string): string {
	const normalized = normalizeProposalLine(text);
	if (!normalized) return "";
	return normalized
		.replace(new RegExp(`${CONTEXT_PROPOSAL_DOCS_ONLY_SIGNAL_REGEX.source}[\\s:：;,/\\-]*`, "giu"), " ")
		.replace(/\s+([,.;:!?])/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

function hasClearNoImplementationSignal(texts: string[]): boolean {
	return texts.some((text) => CONTEXT_PROPOSAL_NO_IMPLEMENTATION_SIGNAL_REGEX.test(normalizeProposalLine(text)));
}

function implementationMissionSourceCandidateText(text: string): string | undefined {
	const normalized = normalizeImplementationMissionSourceText(text);
	if (!normalized) return undefined;
	if (hasExplicitPlanningOnlyDeliverable([normalized])) return undefined;
	if (hasClearNoImplementationSignal([normalized])) return undefined;
	if (!CONTEXT_PROPOSAL_IMPLEMENTATION_SOURCE_REGEX.test(normalized)) return undefined;
	return normalized;
}

function pickImplementationMissionSource(proposal: Pick<ContextProposal, "scope" | "constraints" | "acceptance">): string | undefined {
	for (const item of proposal.scope) {
		const candidate = implementationMissionSourceCandidateText(item);
		if (candidate) return candidate;
	}
	for (const item of proposal.acceptance) {
		const candidate = implementationMissionSourceCandidateText(item);
		if (candidate) return candidate;
	}
	return undefined;
}

function hasPlanningArtifactOnlyContext(
	proposal: Pick<ContextProposal, "mission" | "scope" | "constraints" | "acceptance">,
): boolean {
	const texts = [proposal.mission, ...contextProposalBodyTexts(proposal)];
	if (!hasExplicitPlanningOnlyDeliverable(texts)) return false;
	return !pickImplementationMissionSource(proposal);
}

function finalizeContextProposal(proposal: ContextProposal, projectName: string, deps: ProposalCommonDeps): ContextProposal | undefined {
	if (hasPlanningArtifactOnlyContext(proposal)) return undefined;
	if (!isGenericPlanningMissionAnchor(proposal.mission, deps)) return proposal;
	const missionSource = pickImplementationMissionSource(proposal);
	if (!missionSource) return undefined;
	const nextMission = deps.assessMissionAnchor(missionSource, projectName).derived;
	const normalizedNextMission = deps.normalizeMissionAnchorText(nextMission);
	if (!normalizedNextMission || deps.isWeakMissionAnchor(normalizedNextMission)) return undefined;
	if (deps.missionAnchorsStrictlyEquivalent(nextMission, proposal.mission)) return proposal;
	return {
		...proposal,
		mission: nextMission,
		goalText: buildContextProposalGoalText({
			mission: nextMission,
			scope: proposal.scope,
			constraints: proposal.constraints,
			acceptance: proposal.acceptance,
		}),
	};
}

function proposalLikelyReopensCompletedWork(proposal: ContextProposal): boolean {
	const corpus = [proposal.mission, proposal.basisPreview, ...proposal.scope, ...proposal.constraints, ...proposal.acceptance]
		.map((text) => normalizeProposalLine(text).toLowerCase())
		.filter(Boolean)
		.join("\n");
	return /(again|reopen|follow[- ]?up|next round|another round|rerun|revisit|再次|重新|下一輪|下一轮|延續|延续|回歸|回归)/iu.test(corpus);
}

function missionTextOverlapsTopic(mission: string, topic: string): boolean {
	if (!mission || !topic) return false;
	const missionTokens = missionAnchorSemanticTokens(mission);
	const topicTokens = missionAnchorSemanticTokens(topic);
	if (missionTokens.length === 0 || topicTokens.length === 0) return false;
	const topicSet = new Set(topicTokens);
	const overlap = missionTokens.filter((token) => topicSet.has(token));
	return overlap.length >= Math.min(2, Math.min(missionTokens.length, topicTokens.length));
}

function proposalOverlapsTopic(proposal: ContextProposal | ContextProposalAlternate, topic: string): boolean {
	if (!topic.trim()) return false;
	if (missionTextOverlapsTopic(proposal.mission, topic)) return true;
	const bodyTexts = [proposal.basisPreview, ...proposal.scope, ...proposal.constraints, ...proposal.acceptance].filter(Boolean);
	return bodyTexts.some((text) => missionTextOverlapsTopic(text, topic) || missionTextOverlapsTopic(topic, text));
}

function extractSuppressedNegatedTopics(proposal: ContextProposal): string[] {
	return uniqueProposalItems(
		proposal.constraints.filter((item) => looksLikeConstraint(item) && CONTEXT_PROPOSAL_IMPLEMENTATION_SOURCE_REGEX.test(normalizeProposalLine(item))),
	);
}

function applyWorkflowContextToProposal(
	proposal: ContextProposal | undefined,
	context: ContextProposalWorkflowContext | undefined,
	deps: ProposalCommonDeps,
): ContextProposal | undefined {
	if (!proposal) return proposal;
	const possibleNoise = [...proposal.analysis.possibleNoise];
	const alternateMissions = [...proposal.analysis.alternateMissions];
	const suppressedCompletedTopics = [...proposal.analysis.suppressedCompletedTopics];
	const suppressedNegatedTopics = [...proposal.analysis.suppressedNegatedTopics, ...extractSuppressedNegatedTopics(proposal)];
	if (!context) {
		return {
			...proposal,
			analysis: finalizeContextProposalAnalysis(
				{
					...proposal.analysis,
					possibleNoise,
					alternateMissions,
					suppressedCompletedTopics,
					suppressedNegatedTopics,
				},
				[proposal.goalText, proposal.mission],
			),
		};
	}
	const completedTopics = [
		context.latestCompletedSlice?.trim(),
		context.latestVerifiedSlice?.trim(),
		context.verificationGoal?.trim(),
		context.verificationSummary?.trim(),
	].filter((value): value is string => Boolean(value));
	for (const topic of completedTopics) {
		if (proposalOverlapsTopic(proposal, topic) && !proposalLikelyReopensCompletedWork(proposal)) {
			suppressedCompletedTopics.push(topic);
			possibleNoise.push(`already completed: ${topic}`);
			return undefined;
		}
	}
	const activeTopics = [context.activeSliceGoal?.trim(), context.activeSliceWhyNow?.trim()].filter((value): value is string => Boolean(value));
	for (const topic of activeTopics) {
		if (proposalOverlapsTopic(proposal, topic) && proposal.analysis.alternateMissions.length === 0) {
			possibleNoise.push(`overlaps canonical active slice: ${topic}`);
		}
	}
	const currentMissionAnchor = context.currentMissionAnchor?.trim();
	if (
		context.continuationPolicy === "done" &&
		currentMissionAnchor &&
		deps.missionAnchorsStrictlyEquivalent(proposal.mission, currentMissionAnchor) &&
		!proposalLikelyReopensCompletedWork(proposal)
	) {
		suppressedCompletedTopics.push(currentMissionAnchor);
		possibleNoise.push(`historical completed mission: ${currentMissionAnchor}`);
		return undefined;
	}
	return {
		...proposal,
		analysis: finalizeContextProposalAnalysis(
			{
				...proposal.analysis,
				possibleNoise,
				alternateMissions,
				suppressedCompletedTopics,
				suppressedNegatedTopics,
			},
			[proposal.goalText, proposal.mission, ...completedTopics, ...activeTopics, currentMissionAnchor ?? ""],
		),
	};
}

export function shouldTreatBareActiveWorkflowProposalAsClearRefocus(proposal: ContextProposal): boolean {
	if (proposal.analysis.alternateMissions.length > 0) return false;
	if (proposal.source === "session") {
		return proposal.scope.length > 0 && proposal.constraints.length > 0 && proposal.acceptance.length > 0;
	}
	return (
		proposal.scope.length > 0 &&
		proposal.constraints.length > 0 &&
		proposal.acceptance.length > 0 &&
		proposal.analysis.possibleNoise.length === 0
	);
}

export function parseContextProposalAnalystOutput(
	raw: string,
	projectName: string,
	deps: AnalystParseDeps = {
		extractJsonObjectFromText,
		isRecord: localIsRecord,
		asString: localAsString,
		asStringArray: localAsStringArray,
		assessMissionAnchor,
		normalizeMissionAnchorText,
		isWeakMissionAnchor,
		missionAnchorsStrictlyEquivalent,
	},
): ContextProposal | undefined {
	const jsonText = deps.extractJsonObjectFromText(raw);
	if (!jsonText) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch {
		return undefined;
	}
	if (!deps.isRecord(parsed)) return undefined;
	const missionSource = deps.asString(parsed.mission) ?? deps.asString(parsed.goal) ?? deps.asString(parsed.summary);
	if (!missionSource) return undefined;
	const assessment = deps.assessMissionAnchor(missionSource, projectName);
	const normalizedMission = deps.normalizeMissionAnchorText(missionSource);
	if (!normalizedMission || deps.isWeakMissionAnchor(normalizedMission)) return undefined;
	const mission = assessment.derived;
	const scope = uniqueProposalItems(deps.asStringArray(parsed.scope));
	const constraints = uniqueProposalItems(deps.asStringArray(parsed.constraints));
	const acceptance = uniqueProposalItems(deps.asStringArray(parsed.acceptance));
	const alternateMissions = deps.asStringArray(parsed.alternate_missions ?? parsed.alternateMissions);
	const analysis = buildContextProposalAnalysis(
		{
			taskType: parsed.task_type ?? parsed.taskType,
			evaluationProfile: parsed.evaluation_profile ?? parsed.evaluationProfile,
			diagnostics: deps.asStringArray(parsed.diagnostics),
			critique: deps.asStringArray(parsed.critique),
			risks: deps.asStringArray(parsed.risks ?? parsed.risk),
			possibleNoise: deps.asStringArray(parsed.possible_noise ?? parsed.possibleNoise),
			alternateMissions,
			suppressedCompletedTopics: deps.asStringArray(parsed.completed_topics ?? parsed.completedTopics),
			suppressedNegatedTopics: deps.asStringArray(parsed.negated_topics ?? parsed.negatedTopics),
			hintTexts: [raw, mission, ...scope, ...constraints, ...acceptance],
		},
		deps,
	);
	const goalText = buildContextProposalGoalText({ mission, scope, constraints, acceptance });
	return finalizeContextProposal(
		{
			mission,
			scope,
			constraints,
			acceptance,
			analysis,
			goalText,
			basisPreview: raw.replace(/\s+/g, " ").trim(),
			source: "analyst",
			alternateProposals: alternateMissions.map((alternateMission) => ({
				mission: alternateMission,
				scope: [],
				constraints: [],
				acceptance: [],
				analysis: finalizeContextProposalAnalysis(undefined, [alternateMission]),
				goalText: buildContextProposalGoalText({ mission: alternateMission, scope: [], constraints: [], acceptance: [] }),
				basisPreview: raw.replace(/\s+/g, " ").trim(),
				source: "analyst",
			})),
		},
		projectName,
		deps,
	);
}

export function buildContextProposalAnalystPromptFromEntries(
	projectName: string,
	recentEntries: RecentDiscussionEntry[],
	contextLines: string[] = [],
	serializeEntries: (entries: RecentDiscussionEntry[]) => string = serializeRecentDiscussionEntries,
): string {
	return buildContextProposalAnalystPrompt(projectName, serializeEntries(recentEntries), contextLines);
}

export function parseContextProposal(text: string, projectName: string, deps: ProposalParseDeps): ContextProposal | undefined {
	const cleaned = deps.stripCodeBlocks(text).replace(/\r/g, "").trim();
	if (!cleaned) return undefined;
	const lines = cleaned
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) return undefined;

	let section: ContextProposalSection | undefined;
	let missionLine: string | undefined;
	let taskTypeHint: string | undefined;
	let evaluationProfileHint: string | undefined;
	const scope: string[] = [];
	const constraints: string[] = [];
	const acceptance: string[] = [];
	const critique: string[] = [];
	const risks: string[] = [];
	let structuredSignalCount = 0;

	for (const rawLine of lines) {
		const routingHint = matchContextProposalRoutingHint(rawLine);
		if (routingHint) {
			structuredSignalCount += 1;
			if (routingHint.field === "taskType") taskTypeHint = routingHint.value;
			else evaluationProfileHint = routingHint.value;
			continue;
		}
		const inlineSection = matchInlineProposalSection(rawLine);
		if (inlineSection) {
			section = inlineSection.section;
			structuredSignalCount += 1;
			if (inlineSection.section === "mission" && !missionLine) {
				missionLine = inlineSection.content;
			} else if (inlineSection.section === "constraints") {
				constraints.push(inlineSection.content);
			} else if (inlineSection.section === "acceptance") {
				acceptance.push(inlineSection.content);
			} else if (inlineSection.section === "scope") {
				scope.push(inlineSection.content);
			} else if (inlineSection.section === "critique") {
				critique.push(inlineSection.content);
			} else if (inlineSection.section === "risks") {
				risks.push(inlineSection.content);
			}
			continue;
		}
		const headerSection = detectProposalSection(rawLine);
		if (headerSection) {
			section = headerSection;
			structuredSignalCount += 1;
			continue;
		}
		const bullet = bulletText(rawLine);
		if (bullet) {
			structuredSignalCount += 1;
			if (section === "mission" && !missionLine) {
				missionLine = bullet;
				continue;
			}
			if (section === "constraints") {
				constraints.push(bullet);
				continue;
			}
			if (section === "acceptance") {
				acceptance.push(bullet);
				continue;
			}
			if (section === "scope") {
				scope.push(bullet);
				continue;
			}
			if (section === "critique") {
				critique.push(bullet);
				continue;
			}
			if (section === "risks") {
				risks.push(bullet);
				continue;
			}
			if (!missionLine) {
				missionLine = bullet;
				continue;
			}
			if (looksLikeAcceptance(bullet)) acceptance.push(bullet);
			else if (looksLikeConstraint(bullet)) constraints.push(bullet);
			else scope.push(bullet);
			continue;
		}
		const normalized = normalizeProposalLine(rawLine);
		if (!normalized) continue;
		if (!missionLine) {
			missionLine = normalized;
			continue;
		}
		if (section === "critique") {
			critique.push(normalized);
			continue;
		}
		if (section === "risks") {
			risks.push(normalized);
			continue;
		}
		if (section === "constraints" || looksLikeConstraint(normalized)) {
			constraints.push(normalized);
			continue;
		}
		if (section === "acceptance" || looksLikeAcceptance(normalized)) {
			acceptance.push(normalized);
			continue;
		}
		if (section === "scope") {
			scope.push(normalized);
		}
	}

	const basisPreview = cleaned.replace(/\s+/g, " ").trim();
	const missionSource = missionLine ?? scope[0] ?? acceptance[0] ?? constraints[0] ?? basisPreview;
	const assessment = deps.assessMissionAnchor(missionSource, projectName);
	const normalizedMission = deps.normalizeMissionAnchorText(missionSource);
	const itemCount = scope.length + constraints.length + acceptance.length + critique.length + risks.length;
	const hasStrongStructure = structuredSignalCount >= 2 || itemCount >= 2;
	if (!normalizedMission || deps.isWeakMissionAnchor(normalizedMission)) return undefined;
	if (!hasStrongStructure && basisPreview.length < 140) return undefined;
	const mission = assessment.derived;
	const analysis = buildContextProposalAnalysis(
		{
			taskType: taskTypeHint,
			evaluationProfile: evaluationProfileHint,
			critique,
			risks,
			hintTexts: [cleaned, mission, ...scope, ...constraints, ...acceptance, ...critique, ...risks],
		},
		deps,
	);
	const goalText = buildContextProposalGoalText({ mission, scope, constraints, acceptance });
	return finalizeContextProposal(
		{
			mission,
			scope,
			constraints,
			acceptance,
			analysis,
			goalText,
			basisPreview,
			source: "session",
			alternateProposals: [],
		},
		projectName,
		deps,
	);
}

export function hasStructuredContextProposalSignal(text: string, stripCodeBlocks: (text: string) => string): boolean {
	const cleaned = stripCodeBlocks(text).replace(/\r/g, "").trim();
	if (!cleaned) return false;
	return /(^|\n)\s*(mission|goal|objective|summary|scope|plan|steps|implementation|constraints?|guardrails|non-goals|acceptance|acceptance criteria|deliverables|verification|critique|concerns?|warnings?|notes?|risks?|hazards?|task[\s_-]*type|evaluation[\s_-]*profile)\s*(?:[:：]\s*|$)/imu.test(
		cleaned,
	);
}

function splitStructuredProposalBlocks(text: string): string[] {
	const lines = text.split("\n");
	const blocks: string[] = [];
	let startIndex = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const rawLine = lines[index].trim();
		const inlineSection = matchInlineProposalSection(rawLine);
		const headerSection = inlineSection?.section ?? detectProposalSection(rawLine);
		if (index > 0 && headerSection === "mission") {
			const block = lines.slice(startIndex, index).join("\n").trim();
			if (block) blocks.push(block);
			startIndex = index;
		}
	}
	const tail = lines.slice(startIndex).join("\n").trim();
	if (tail) blocks.push(tail);
	return blocks;
}

function parseStrictSingleStructuredSessionProposal(text: string, projectName: string, deps: ProposalParseDeps): ContextProposal | undefined {
	const cleaned = deps.stripCodeBlocks(text).replace(/\r/g, "").trim();
	if (!cleaned) return undefined;
	const lines = cleaned
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) return undefined;

	let section: ContextProposalSection | undefined;
	const sectionsPresent = new Set<ContextProposalSection>();
	const missionCandidates: string[] = [];

	for (const rawLine of lines) {
		const inlineSection = matchInlineProposalSection(rawLine);
		if (inlineSection) {
			section = inlineSection.section;
			sectionsPresent.add(section);
			if (section === "mission") missionCandidates.push(inlineSection.content);
			continue;
		}
		const headerSection = detectProposalSection(rawLine);
		if (headerSection) {
			section = headerSection;
			sectionsPresent.add(section);
			continue;
		}
		const normalized = bulletText(rawLine) ?? normalizeProposalLine(rawLine);
		if (normalized && section === "mission") missionCandidates.push(normalized);
	}

	const requiredSections: ContextProposalSection[] = ["mission", "scope", "constraints", "acceptance"];
	if (requiredSections.some((candidate) => !sectionsPresent.has(candidate))) return undefined;

	const distinctMissionAnchors = Array.from(
		new Set(
			missionCandidates
				.map((candidate) => deps.normalizeMissionAnchorText(deps.assessMissionAnchor(candidate, projectName).derived))
				.filter((candidate): candidate is string => Boolean(candidate)),
		),
	);
	if (distinctMissionAnchors.length !== 1) return undefined;

	const proposal = parseContextProposal(cleaned, projectName, deps);
	if (!proposal) return undefined;
	if (
		deps.normalizeMissionAnchorText(proposal.mission) !== distinctMissionAnchors[0] &&
		!isGenericPlanningMissionAnchor(distinctMissionAnchors[0], deps)
	) {
		return undefined;
	}
	if (proposal.scope.length === 0 || proposal.constraints.length === 0 || proposal.acceptance.length === 0) return undefined;
	return { ...proposal, source: "session", alternateProposals: proposal.alternateProposals ?? [] };
}

export function parseStrictStructuredSessionProposal(text: string, projectName: string, deps: ProposalParseDeps): ContextProposal | undefined {
	const cleaned = deps.stripCodeBlocks(text).replace(/\r/g, "").trim();
	if (!cleaned) return undefined;
	const blocks = splitStructuredProposalBlocks(cleaned);
	const proposals = blocks
		.map((block) => parseStrictSingleStructuredSessionProposal(block, projectName, deps))
		.filter((proposal): proposal is ContextProposal => Boolean(proposal));
	if (proposals.length === 0) return undefined;
	const primary = proposals[proposals.length - 1];
	const alternateProposals = proposals
		.slice(0, -1)
		.filter((proposal) => !deps.missionAnchorsStrictlyEquivalent(proposal.mission, primary.mission))
		.map((proposal) => ({
			mission: proposal.mission,
			scope: proposal.scope,
			constraints: proposal.constraints,
			acceptance: proposal.acceptance,
			analysis: proposal.analysis,
			goalText: proposal.goalText,
			basisPreview: proposal.basisPreview,
			source: proposal.source,
		}));
	const alternateMissions = uniqueProposalItems(alternateProposals.map((proposal) => proposal.mission));
	if (alternateMissions.length === 0) return { ...primary, alternateProposals: [] };
	return {
		...primary,
		alternateProposals,
		analysis: finalizeContextProposalAnalysis(
			{
				...primary.analysis,
				alternateMissions,
				possibleNoise: [...primary.analysis.possibleNoise, ...alternateMissions.map((mission) => `alternate recent mission: ${mission}`)],
			},
			[primary.goalText, primary.mission, ...alternateMissions],
		),
	};
}

export function extractContextProposalFromStructuredSession(
	recentEntries: RecentDiscussionEntry[],
	projectName: string,
	deps: ProposalParseDeps,
): ContextProposal | undefined {
	const structuredTexts = recentEntries
		.slice()
		.reverse()
		.map((entry) => entry.text.trim())
		.filter((text) => hasStructuredContextProposalSignal(text, deps.stripCodeBlocks));
	if (structuredTexts.length === 0) return undefined;
	return parseStrictStructuredSessionProposal(structuredTexts.join("\n\n"), projectName, deps);
}

const COOK_HANDOFF_BLOCK_REGEX = /```cook_handoff\s*([\s\S]*?)```/giu;
const COOK_HANDOFF_MAX_AGE_MS = 45 * 60 * 1000;
const COOK_HANDOFF_MAX_LATER_NON_COMMAND_MESSAGES = 2;
const COOK_HANDOFF_NEGATIVE_MISSION_REGEX =
	/(?:\b(?:do not|don't|dont|not|never|avoid|skip|refuse|recognize that|suppress|ignore|block|prevent)\b|(?:不要|別|别|勿|禁止|避免|忽略|阻止))/iu;
const COOK_HANDOFF_WORKFLOW_ONLY_ACCEPTANCE_REGEX =
	/(?:\b(?:confirm|discuss|clarify|decide|review|align(?: on)?|agree(?: on)?|explain|summari(?:s|z)e|describe|plan|proposal|spec(?:ification)?|design(?: doc(?:ument)?)?|next step|handoff|workflow|readiness)\b|(?:確認|确认|討論|讨论|釐清|厘清|決定|决定|審查|审查|對齊|对齐|同意|说明|說明|總結|总结|描述|規劃|规划|提案|方案|工作流|就緒|就绪))/iu;
const COOK_HANDOFF_VERIFICATION_ACCEPTANCE_REGEX =
	/(?:\b(?:test|tests|testing|verify|verification|validated?|regression|coverage|assert(?:ion)?s?|check|checks|smoke|snapshot(?:s)?)\b|(?:測試|测试|驗證|验证|回歸|回归|覆蓋|覆盖|斷言|断言|檢查|检查|快照))/iu;
const COOK_HANDOFF_VERIFICATION_ACTION_REGEX =
	/(?:\b(?:add|update|keep|run|rerun|cover|verify|validate|check|assert|exercise|prove)\b|(?:新增|更新|保持|執行|执行|重跑|覆蓋|覆盖|驗證|验证|檢查|检查|斷言|断言|證明|证明))/iu;

function parseCookHandoffCapsulesFromText(
	text: string,
	messageId: string | undefined,
	timestampMs: number | undefined,
	deps: Pick<ProposalParseDeps, "asString" | "asStringArray">,
): CookHandoffCapsule[] {
	const capsules: CookHandoffCapsule[] = [];
	for (const match of text.matchAll(COOK_HANDOFF_BLOCK_REGEX)) {
		const rawJson = deps.asString(match[1]);
		if (!rawJson) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawJson);
		} catch {
			continue;
		}
		if (!localIsRecord(parsed)) continue;
		if (deps.asString(parsed.kind) !== "cook_handoff") continue;
		if (deps.asString(parsed.source) !== "primary_agent") continue;
		if (deps.asString(parsed.handoff_kind) !== "implementation_workflow_handoff") continue;
		const mission = deps.asString(parsed.mission);
		if (!mission) continue;
		const scope = deps.asStringArray(parsed.scope);
		const constraints = deps.asStringArray(parsed.constraints);
		const nonGoals = deps.asStringArray(parsed.non_goals ?? parsed.nonGoals);
		const acceptance = deps.asStringArray(parsed.acceptance);
		const risks = deps.asStringArray(parsed.risks);
		const notes = deps.asStringArray(parsed.notes);
		const firstSliceGoal = deps.asString(parsed.first_slice_goal ?? parsed.firstSliceGoal);
		const firstSliceNonGoals = deps.asStringArray(parsed.first_slice_non_goals ?? parsed.firstSliceNonGoals);
		const implementationSurfaces = deps.asStringArray(parsed.implementation_surfaces ?? parsed.implementationSurfaces);
		const verificationCommands = deps.asStringArray(parsed.verification_commands ?? parsed.verificationCommands);
		const whyThisSliceFirst = deps.asString(parsed.why_this_slice_first ?? parsed.whyThisSliceFirst);
		const verificationTruthMode = deps.asString(parsed.verification_truth_mode ?? parsed.verificationTruthMode);
		const deterministicVerifierReady = localAsBoolean(parsed.deterministic_verifier_ready ?? parsed.deterministicVerifierReady);
		const verificationLatency = deps.asString(parsed.verification_latency ?? parsed.verificationLatency);
		const verificationNoiseRisk = deps.asString(parsed.verification_noise_risk ?? parsed.verificationNoiseRisk);
		const verifierGap = deps.asString(parsed.verifier_gap ?? parsed.verifierGap);
		const recommendedFirstSliceKind = deps.asString(parsed.recommended_first_slice_kind ?? parsed.recommendedFirstSliceKind);
		const capturedAt = deps.asString(parsed.captured_at) ?? (timestampMs ? new Date(timestampMs).toISOString() : undefined);
		const sourceTurnId = deps.asString(parsed.source_turn_id) ?? messageId;
		if (!capturedAt || !sourceTurnId) continue;
		capsules.push({
			kind: "cook_handoff",
			source: "primary_agent",
			captured_at: capturedAt,
			source_turn_id: sourceTurnId,
			mission,
			scope,
			constraints,
			non_goals: nonGoals,
			acceptance,
			risks,
			notes,
			handoff_kind: "implementation_workflow_handoff",
			first_slice_goal: firstSliceGoal,
			first_slice_non_goals: firstSliceNonGoals,
			implementation_surfaces: implementationSurfaces,
			verification_commands: verificationCommands,
			why_this_slice_first: whyThisSliceFirst,
			verification_truth_mode: verificationTruthMode,
			deterministic_verifier_ready: deterministicVerifierReady,
			verification_latency: verificationLatency,
			verification_noise_risk: verificationNoiseRisk,
			verifier_gap: verifierGap,
			recommended_first_slice_kind: recommendedFirstSliceKind,
			task_type: deps.asString(parsed.task_type),
			evaluation_profile: deps.asString(parsed.evaluation_profile),
			why_cook_now: deps.asString(parsed.why_cook_now),
		});
	}
	return capsules;
}

function buildCookHandoffBasisPreview(capsule: CookHandoffCapsule): string {
	const parts = [capsule.mission, ...capsule.scope, ...capsule.constraints, ...capsule.non_goals, ...capsule.acceptance];
	if (capsule.first_slice_goal) parts.push(`first_slice_goal: ${capsule.first_slice_goal}`);
	parts.push(...capsule.first_slice_non_goals.map((item) => `first_slice_non_goals: ${item}`));
	parts.push(...capsule.implementation_surfaces.map((item) => `implementation_surfaces: ${item}`));
	parts.push(...capsule.verification_commands.map((item) => `verification_commands: ${item}`));
	if (capsule.why_this_slice_first) parts.push(`why_this_slice_first: ${capsule.why_this_slice_first}`);
	if (capsule.verification_truth_mode) parts.push(`verification_truth_mode: ${capsule.verification_truth_mode}`);
	if (capsule.deterministic_verifier_ready !== undefined) parts.push(`deterministic_verifier_ready: ${capsule.deterministic_verifier_ready}`);
	if (capsule.verification_latency) parts.push(`verification_latency: ${capsule.verification_latency}`);
	if (capsule.verification_noise_risk) parts.push(`verification_noise_risk: ${capsule.verification_noise_risk}`);
	if (capsule.verifier_gap) parts.push(`verifier_gap: ${capsule.verifier_gap}`);
	if (capsule.recommended_first_slice_kind) parts.push(`recommended_first_slice_kind: ${capsule.recommended_first_slice_kind}`);
	if (capsule.why_cook_now) parts.push(`why_cook_now: ${capsule.why_cook_now}`);
	return parts.join("\n").trim();
}

function cookHandoffAcceptanceItemIsRepoChangeOrVerificationOriented(item: string): boolean {
	const normalized = normalizeProposalLine(item);
	if (!normalized) return false;
	if (hasExplicitPlanningOnlyDeliverable([normalized])) return false;
	if (hasClearNoImplementationSignal([normalized])) return false;
	if (implementationMissionSourceCandidateText(normalized)) return true;
	if (COOK_HANDOFF_WORKFLOW_ONLY_ACCEPTANCE_REGEX.test(normalized)) return false;
	return COOK_HANDOFF_VERIFICATION_ACCEPTANCE_REGEX.test(normalized) && COOK_HANDOFF_VERIFICATION_ACTION_REGEX.test(normalized);
}

function cookHandoffAcceptanceIsRepoChangeOriented(capsule: CookHandoffCapsule): boolean {
	if (capsule.acceptance.length === 0) return false;
	return capsule.acceptance.some((item) => cookHandoffAcceptanceItemIsRepoChangeOrVerificationOriented(item));
}

function buildCookHandoffCritiqueLines(capsule: CookHandoffCapsule): string[] {
	const critique = [...capsule.notes];
	if (capsule.acceptance.length === 0) {
		critique.push("Startup acceptance was not fully captured at /cook entry; completion-regrounder should reconcile concrete repo-change acceptance before selecting a slice.");
	} else if (!cookHandoffAcceptanceIsRepoChangeOriented(capsule)) {
		critique.push("Startup acceptance remained high-level at /cook entry; completion-regrounder should tighten it against concrete repo truth before selecting a slice.");
	}
	if (capsule.first_slice_goal) critique.push(`First slice goal: ${capsule.first_slice_goal}`);
	else critique.push("Initial slice was not fixed at /cook entry; completion-regrounder should derive it from repo truth.");
	if (capsule.first_slice_non_goals.length > 0) critique.push(`First slice non-goals: ${capsule.first_slice_non_goals.join(" | ")}`);
	if (capsule.implementation_surfaces.length > 0) critique.push(`Implementation surfaces: ${capsule.implementation_surfaces.join(" | ")}`);
	else critique.push("Implementation surfaces were not fixed at /cook entry; completion-regrounder should derive them later.");
	if (capsule.verification_commands.length > 0) critique.push(`Verification commands: ${capsule.verification_commands.join(" | ")}`);
	else critique.push("Verification commands were not fixed at /cook entry; completion-regrounder should derive them later.");
	if (capsule.why_this_slice_first) critique.push(`Why this slice first: ${capsule.why_this_slice_first}`);
	if (capsule.verification_truth_mode) critique.push(`Verification truth mode: ${capsule.verification_truth_mode}`);
	if (capsule.deterministic_verifier_ready !== undefined) {
		critique.push(`Deterministic verifier ready: ${capsule.deterministic_verifier_ready ? "yes" : "no"}`);
	}
	if (capsule.verification_latency) critique.push(`Verification latency: ${capsule.verification_latency}`);
	if (capsule.verification_noise_risk) critique.push(`Verification noise risk: ${capsule.verification_noise_risk}`);
	if (capsule.verifier_gap) critique.push(`Verifier gap: ${capsule.verifier_gap}`);
	if (capsule.recommended_first_slice_kind) {
		critique.push(`Recommended first slice kind: ${capsule.recommended_first_slice_kind}`);
	}
	if (capsule.why_cook_now) critique.push(`Primary-agent /cook handoff rationale: ${capsule.why_cook_now}`);
	return uniqueProposalItems(critique);
}

function laterMessagesInvalidateCookHandoff(
	laterMessages: RecentSessionMessage[],
	deps: Pick<ProposalParseDeps, "stripCodeBlocks">,
): boolean {
	const laterNonCommandMessages = laterMessages.filter((entry) => !entry.isCommand);
	if (laterNonCommandMessages.length > COOK_HANDOFF_MAX_LATER_NON_COMMAND_MESSAGES) return true;
	return laterNonCommandMessages.some((entry) => {
		if (entry.role === "summary") return false;
		if (!hasRecentDiscussionImplementationIntent(entry.text, deps.stripCodeBlocks)) return false;
		return true;
	});
}

function cookHandoffIsFreshEnough(capsule: CookHandoffCapsule, laterMessages: RecentSessionMessage[]): boolean {
	const capturedAtMs = Date.parse(capsule.captured_at);
	if (!Number.isFinite(capturedAtMs)) return false;
	const laterTimestamps = laterMessages.map((entry) => entry.timestampMs).filter((value): value is number => value !== undefined);
	if (laterTimestamps.length === 0) return true;
	return Math.max(...laterTimestamps) - capturedAtMs <= COOK_HANDOFF_MAX_AGE_MS;
}

function buildContextProposalFromCookHandoffCapsule(
	capsule: CookHandoffCapsule,
	projectName: string,
	deps: ProposalParseDeps,
): ContextProposal | undefined {
	const constraints = uniqueProposalItems([...capsule.constraints, ...capsule.non_goals]);
	const normalizedMissionSource = deps.normalizeMissionAnchorText(capsule.mission);
	if (
		!normalizedMissionSource ||
		deps.isWeakMissionAnchor(normalizedMissionSource) ||
		COOK_HANDOFF_NEGATIVE_MISSION_REGEX.test(normalizedMissionSource)
	) {
		return undefined;
	}
	const mission = deps.assessMissionAnchor(capsule.mission, projectName).derived;
	const normalizedMission = deps.normalizeMissionAnchorText(mission);
	if (!normalizedMission || deps.isWeakMissionAnchor(normalizedMission) || COOK_HANDOFF_NEGATIVE_MISSION_REGEX.test(normalizedMission)) {
		return undefined;
	}
	if (capsule.scope.length === 0 && constraints.length === 0 && capsule.acceptance.length === 0) return undefined;
	const goalText = buildContextProposalGoalText({
		mission,
		scope: capsule.scope,
		constraints,
		acceptance: capsule.acceptance,
	});
	const hasStartupHints = Boolean(
		capsule.first_slice_goal ||
			capsule.first_slice_non_goals.length > 0 ||
			capsule.implementation_surfaces.length > 0 ||
			capsule.verification_commands.length > 0 ||
			capsule.why_this_slice_first ||
			capsule.verification_truth_mode ||
			capsule.deterministic_verifier_ready !== undefined ||
			capsule.verification_latency ||
			capsule.verification_noise_risk ||
			capsule.verifier_gap ||
			capsule.recommended_first_slice_kind,
	);
	const startupHints: ContextProposalStartupHints | undefined = hasStartupHints
		? {
			firstSliceGoal: capsule.first_slice_goal,
			firstSliceNonGoals: [...capsule.first_slice_non_goals],
			implementationSurfaces: [...capsule.implementation_surfaces],
			verificationCommands: [...capsule.verification_commands],
			whyThisSliceFirst: capsule.why_this_slice_first,
			verificationTruthMode: capsule.verification_truth_mode,
			deterministicVerifierReady: capsule.deterministic_verifier_ready,
			verificationLatency: capsule.verification_latency,
			verificationNoiseRisk: capsule.verification_noise_risk,
			verifierGap: capsule.verifier_gap,
			recommendedFirstSliceKind: capsule.recommended_first_slice_kind,
		}
		: undefined;
	const proposal: ContextProposal = {
		mission,
		scope: [...capsule.scope],
		constraints,
		acceptance: [...capsule.acceptance],
		analysis: finalizeContextProposalAnalysis(
			{
				taskType: capsule.task_type,
				evaluationProfile: capsule.evaluation_profile,
				diagnostics: [],
				critique: buildCookHandoffCritiqueLines(capsule),
				risks: capsule.risks,
				possibleNoise: [],
				alternateMissions: [],
				suppressedCompletedTopics: [],
				suppressedNegatedTopics: [],
			},
			[
				mission,
				goalText,
				capsule.mission,
				...capsule.scope,
				...constraints,
				...capsule.acceptance,
				capsule.first_slice_goal ?? "",
				...capsule.first_slice_non_goals,
				...capsule.implementation_surfaces,
				...capsule.verification_commands,
				capsule.why_this_slice_first ?? "",
				capsule.verification_truth_mode ?? "",
				capsule.deterministic_verifier_ready === undefined ? "" : `${capsule.deterministic_verifier_ready}`,
				capsule.verification_latency ?? "",
				capsule.verification_noise_risk ?? "",
				capsule.verifier_gap ?? "",
				capsule.recommended_first_slice_kind ?? "",
			],
		),
		goalText,
		basisPreview: buildCookHandoffBasisPreview(capsule),
		source: "handoff_capsule",
		startupHints,
		alternateProposals: [],
	};
	return finalizeContextProposal(proposal, projectName, deps);
}

export function assessLatestCookHandoffProposal(
	recentMessages: RecentSessionMessage[],
	projectName: string,
	deps: ProposalParseDeps,
): CookHandoffProposalAssessment {
	for (let index = 0; index < recentMessages.length; index += 1) {
		const entry = recentMessages[index];
		if (entry.role !== "assistant" || entry.isCommand) continue;
		const capsules = parseCookHandoffCapsulesFromText(entry.text, entry.messageId, entry.timestampMs, deps);
		if (capsules.length === 0) continue;
		for (let capsuleIndex = capsules.length - 1; capsuleIndex >= 0; capsuleIndex -= 1) {
			const capsule = capsules[capsuleIndex];
			const laterMessages = recentMessages.slice(0, index);
			if (!cookHandoffIsFreshEnough(capsule, laterMessages)) continue;
			if (laterMessagesInvalidateCookHandoff(laterMessages, deps)) continue;
			const proposal = buildContextProposalFromCookHandoffCapsule(capsule, projectName, deps);
			if (proposal) return { status: "startable", proposal };
		}
	}
	return { status: "none" };
}

export function extractLatestCookHandoffProposal(
	recentMessages: RecentSessionMessage[],
	projectName: string,
	deps: ProposalParseDeps,
): ContextProposal | undefined {
	const assessment = assessLatestCookHandoffProposal(recentMessages, projectName, deps);
	return assessment.status === "startable" ? assessment.proposal : undefined;
}

export function extractCookHandoffProposalFromText(
	text: string,
	projectName: string,
	deps: ProposalParseDeps,
	options?: {
		messageId?: string;
		timestampMs?: number;
		source?: ContextProposalAlternate["source"];
	},
): ContextProposal | undefined {
	const capsules = parseCookHandoffCapsulesFromText(text, options?.messageId, options?.timestampMs, deps);
	for (let capsuleIndex = capsules.length - 1; capsuleIndex >= 0; capsuleIndex -= 1) {
		const proposal = buildContextProposalFromCookHandoffCapsule(capsules[capsuleIndex], projectName, deps);
		if (!proposal) continue;
		return options?.source && options.source !== proposal.source ? retagContextProposalSource(proposal, options.source) : proposal;
	}
	return undefined;
}

export async function deriveCookContextProposalFromRecentDiscussion(
	projectName: string,
	recentEntries: RecentDiscussionEntry[],
	deps: ProposalParseDeps & {
		analyzeContextProposal?: (recentEntries: RecentDiscussionEntry[]) => Promise<ContextProposal | undefined>;
		workflowContext?: ContextProposalWorkflowContext;
	},
): Promise<ContextProposal | undefined> {
	if (recentEntries.length === 0) return undefined;
	for (const candidateEntries of recentDiscussionWindows(recentEntries, deps.stripCodeBlocks)) {
		const analyzed = applyWorkflowContextToProposal(await deps.analyzeContextProposal?.(candidateEntries), deps.workflowContext, deps) ?? undefined;
		if (analyzed) return analyzed;
		const structured = applyWorkflowContextToProposal(
			extractContextProposalFromStructuredSession(candidateEntries, projectName, deps),
			deps.workflowContext,
			deps,
		);
		if (structured) return structured;
	}
	return undefined;
}

export function retagContextProposalSource(
	proposal: ContextProposal | undefined,
	source: ContextProposalAlternate["source"],
): ContextProposal | undefined {
	if (!proposal) return undefined;
	return {
		...proposal,
		source,
		alternateProposals: proposal.alternateProposals.map((alternate) => ({ ...alternate, source })),
	};
}

export function resolveContextProposalConfirmationAction(
	proposal: ContextProposal,
	action: ContextProposalConfirmAction,
): ContextProposalDecision | undefined {
	if (action === "cancel") return undefined;
	return {
		missionAnchor: proposal.mission,
		goalText: proposal.goalText,
		analysis: finalizeContextProposalAnalysis(proposal.analysis, [proposal.goalText, proposal.mission]),
	};
}
