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
	profile: JsonRecord;
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
	first_slice_goal?: string;
	first_slice_non_goals?: string[];
	implementation_surfaces?: string[];
	verification_commands?: string[];
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
	reason?: string;
};

export type CookHandoffSidecarStatus =
	| "pending_review"
	| "confirmed"
	| "awaiting_terminal_launch"
	| "kickoff_started";

export type CookHandoffSidecar = {
	workspace_root: string;
	branch?: string;
	path: string;
	prepared_at: string;
	confirmation_id: string;
	handoff_sha256: string;
	status: CookHandoffSidecarStatus;
	source: string;
	mission_preview?: string;
	confirmed_at?: string;
	confirmed_by?: string;
	last_start_error?: string;
};

export type DispatchInFlightInfo = {
	role: CompletionRole;
	slice_id: string | null;
	head_sha: string;
	claimed_at: string;
	dispatch_key: string;
};

export type WorkflowDispatch = {
	workspace_root: string;
	role: CompletionRole | null;
	dispatch_allowed: boolean;
	reason: string;
	system_context: string;
	task_prompt: string;
	cursor_agent: string;
	subagent_type: CompletionRole | "generalPurpose";
	continuation_policy?: string;
	workflow_entry_status?: string;
	workflow_closed?: boolean;
	driver_continue?: boolean;
	driver_continue_reason?: string;
	dispatch_key?: string;
	head_sha?: string;
	slice_id?: string | null;
	in_flight?: DispatchInFlightInfo | null;
	claim_required?: boolean;
	next_steps: string[];
};
