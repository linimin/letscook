export const ROLE_NAMES = [
	"completion-bootstrapper",
	"completion-regrounder",
	"completion-implementer",
	"completion-reviewer",
	"completion-auditor",
	"completion-stop-judge",
] as const;

export type CompletionRole = (typeof ROLE_NAMES)[number];
export type JsonRecord = Record<string, unknown>;

export const STARTUP_ANALYSIS_VERDICTS = ["startable", "needs_clarification", "planning_only", "not_repo_change", "unsafe"] as const;
export type StartupAnalysisVerdict = (typeof STARTUP_ANALYSIS_VERDICTS)[number];

export const STARTUP_WORKFLOW_RELATIONS = ["new_workflow", "continue_current_workflow", "replace_current_workflow", "unclear"] as const;
export type StartupWorkflowRelation = (typeof STARTUP_WORKFLOW_RELATIONS)[number];

export const STARTUP_ANALYSIS_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type StartupAnalysisConfidence = (typeof STARTUP_ANALYSIS_CONFIDENCE_LEVELS)[number];

export type ValidatedStartupAnalysis = {
	verdict: StartupAnalysisVerdict;
	workflowRelation: StartupWorkflowRelation;
	confidence: StartupAnalysisConfidence;
	mission: string;
	scope: string[];
	constraints: string[];
	acceptance: string[];
	diagnostics: string[];
	critique: string[];
	risks: string[];
	possibleNoise: string[];
	alternateMissions: string[];
	suppressedCompletedTopics: string[];
	suppressedNegatedTopics: string[];
	taskType?: string;
	evaluationProfile?: string;
	basisPreview: string;
};

export type CompletionFiles = {
	root: string;
	agentDir: string;
	currentDir: string;
	tmpDir: string;
	statePath: string;
	planPath: string;
	activePath: string;
	sliceHistoryPath: string;
	stopHistoryPath: string;
	startupBriefPath: string;
	verificationEvidencePath: string;
	compactionMarkerPath: string;
	driverPromptPath: string;
};

export type CompletionStateSnapshot = {
	files: CompletionFiles;
	workflow?: JsonRecord;
	profile?: JsonRecord;
	state?: JsonRecord;
	plan?: JsonRecord;
	active?: JsonRecord;
	startupBrief?: JsonRecord;
	verificationEvidence?: JsonRecord;
	activeSlice?: JsonRecord;
};

export type CompletionWorkflowStateProbe = {
	files: CompletionFiles;
	state: JsonRecord;
	isClosed: boolean;
};

export type AgentDefinition = {
	name: string;
	description?: string;
	tools?: string[];
	model?: string;
	cursorModel?: string;
	roleBackend?: string;
	systemPrompt: string;
	filePath: string;
};

export type LiveRoleActivity = {
	role: string;
	status: "running" | "ok" | "error";
	currentAction?: string;
	toolActivity?: string;
	toolRecentActivity: string[];
	recentActivity: string[];
	assistantSummary?: string;
	lastAssistantText?: string;
	progress?: string;
	rationale?: string;
	nextStep?: string;
	verifying?: string;
	stateDeltas: string[];
	startedAt: number;
	updatedAt: number;
};

export type CompletionStatusSurface = {
	snapshotPresent: boolean;
	statusText?: string;
	widgetLines: string[];
	currentPhase?: string;
	sliceId?: string;
	nextMandatoryRole?: string;
	remainingContractCount?: number;
	releaseBlockerCount?: number;
	highValueGapCount?: number;
	remainingStopJudgeCount?: number;
	requiredStopJudges?: number;
	stopAggregationPolicy?: string;
	activeRole?: string;
	livePreview?: string;
	liveState?: "active" | "waiting" | "stalled";
	liveIdleMs?: number;
	liveToolActivity?: string;
	liveAssistantSummary?: string;
	liveProgress?: string;
	liveRationale?: string;
	liveNextStep?: string;
	liveVerifying?: string;
	liveStateDeltas?: string[];
	liveDetailsLines?: string[];
};
