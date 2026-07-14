export const COMPLETION_HELPER_NAMES = ["scout", "critic"] as const;
export type CompletionHelperName = (typeof COMPLETION_HELPER_NAMES)[number];

export const COMPLETION_HELPER_FAILURE_KINDS = ["timeout", "aborted", "process_error", "invalid_output", "policy"] as const;
export type CompletionHelperFailureKind = (typeof COMPLETION_HELPER_FAILURE_KINDS)[number];

export const HELPER_PROXY_TOOL_NAMES = [
	"completion_helper_read",
	"completion_helper_grep",
	"completion_helper_find",
	"completion_helper_ls",
] as const;
export type HelperProxyToolName = (typeof HELPER_PROXY_TOOL_NAMES)[number];

export const STRUCTURED_HELPER_OUTPUT_LIMITS = {
	summaryMaxBytes: 500,
	evidenceMaxItems: 12,
	pathsMaxItems: 12,
	openQuestionsMaxItems: 8,
	totalMaxBytes: 16 * 1024,
} as const;

export type StructuredHelperOutput = {
	/** Contract: completion.helper.scout.v1 / completion.helper.critic.v1 */
	summary: string;
	evidence: string[];
	paths: string[];
	open_questions: string[];
};

export type CompletionHelperRequest = {
	helper: CompletionHelperName;
	task: string;
	cwd?: string;
	timeoutMs?: number;
};

export type CompletionHelperProgressEvent = {
	kind: "start" | "stage" | "tool" | "result" | "timeout" | "aborted" | "failure";
	message: string;
	details?: Record<string, unknown>;
};

export type CompletionHelperSuccess = {
	ok: true;
	helper: CompletionHelperName;
	output: StructuredHelperOutput;
	rawText?: string;
	stderr?: string;
	artifactDir: string;
	resolvedCwd: string;
	usedModel?: string;
	exitCode?: number;
};

export type CompletionHelperFailure = {
	ok: false;
	helper: CompletionHelperName;
	failureKind: CompletionHelperFailureKind;
	message: string;
	rawText?: string;
	stderr?: string;
	artifactDir: string;
	resolvedCwd: string;
	usedModel?: string;
	exitCode?: number;
};

export type CompletionHelperResult = CompletionHelperSuccess | CompletionHelperFailure;

export type CompletionHelperPolicy = {
	readonly: boolean;
	allowedCallerRoles: string[];
	toolAllowlist: string[];
	defaultTimeoutMs: number;
	maxTimeoutMs: number;
};

export function isCompletionHelperName(value: unknown): value is CompletionHelperName {
	return typeof value === "string" && COMPLETION_HELPER_NAMES.includes(value as CompletionHelperName);
}

export function isCompletionHelperFailureKind(value: unknown): value is CompletionHelperFailureKind {
	return typeof value === "string" && COMPLETION_HELPER_FAILURE_KINDS.includes(value as CompletionHelperFailureKind);
}

export function utf8Length(value: string): number {
	return Buffer.byteLength(value, "utf8");
}
