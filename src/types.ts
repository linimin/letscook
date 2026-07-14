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

export type AgentPaths = {
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
	handoffPath: string;
	pendingSidecarPath: string;
	workflowEventsPath: string;
};

export type WorkflowSnapshot = {
	files: AgentPaths;
	state: JsonRecord;
	plan: JsonRecord;
	active: JsonRecord;
	startupBrief: JsonRecord;
};

export type CookHandoffCapsule = {
	kind: "cook_handoff";
	source: string;
	captured_at: string;
	source_turn_id?: string;
	mission: string;
	scope: string[];
	constraints: string[];
	non_goals?: string[];
	acceptance: string[];
	risks?: string[];
	notes?: string[];
	handoff_kind: string;
	task_type?: string;
	evaluation_profile?: string;
	why_cook_now?: string;
};

export type CookHandoffSidecar = {
	workspace_root: string;
	branch?: string;
	path: string;
	prepared_at: string;
	confirmation_id: string;
	handoff_sha256: string;
	status: "pending_review" | "confirmed" | "kickoff_started";
	source: string;
	mission_preview?: string;
	confirmed_at?: string;
};

export type WorkflowDispatch = {
	workspace_root: string;
	role: CompletionRole | null;
	dispatch_allowed: boolean;
	reason: string;
	system_context: string;
	task_prompt: string;
	cursor_agent: string;
	subagent_type: "generalPurpose" | "explore" | "shell";
	continuation_policy?: string;
	workflow_entry_status?: string;
	next_steps: string[];
};
