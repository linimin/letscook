import type { CompletionRole } from "../types.ts";

const RUBRIC_DIMENSIONS = [
	"Contract coverage",
	"Correctness risk",
	"Verification evidence",
	"Docs/state parity",
];

const REVIEWER_REQUIRED_FIELDS = [
	"MISSION ANCHOR",
	"Remaining contract IDs",
	"Findings",
	"Acceptable as-is",
	"Smallest follow-up slice",
];

const AUDITOR_REQUIRED_FIELDS = [
	"MISSION ANCHOR",
	"Remaining contract IDs",
	"Why the project is still not done",
	"Open top-level contract IDs",
	"Blocker count",
	"High-value gap count",
	"Tracked and unignored worktree is clean",
	"Worktree blockers",
	"Next mandatory slice",
];

const STOP_JUDGE_REQUIRED_FIELDS = [
	"MISSION ANCHOR",
	"Remaining contract IDs",
	"Can the project stop now",
	"Exact remaining open top-level contract IDs",
	"Blocker count",
	"High-value gap count",
	"Latest completed slice commit",
	"Docs/config/runbooks match shipped behavior",
	"Tracked and unignored worktree is clean",
	"Brief justification",
];

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseYesNo(value: string | undefined): boolean | undefined {
	if (!value) return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized.startsWith("yes")) return true;
	if (normalized.startsWith("no")) return false;
	return undefined;
}

function isNoneLike(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return (
		normalized === "none" ||
		normalized.startsWith("none ") ||
		normalized === "(none)" ||
		normalized === "n/a" ||
		normalized === "not applicable"
	);
}

export function parseReportFields(text: string): Record<string, string> {
	const fields: Record<string, string> = {};
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const normalized = line.replace(/^-\s*/, "").replace(/^`/, "").replace(/`$/, "");
		const match = normalized.match(/^([A-Za-z][A-Za-z0-9 _/-]*?):\s*(.*)$/);
		if (!match) continue;
		const [, key, value] = match;
		fields[key!.trim()] = value!.trim();
	}
	return fields;
}

function missingFields(required: string[], fields: Record<string, string>): string[] {
	return required.filter((field) => !asString(fields[field]));
}

function validateRubric(fields: Record<string, string>): string[] {
	const errors: string[] = [];
	for (const dimension of RUBRIC_DIMENSIONS) {
		const value = asString(fields[dimension]);
		if (!value) errors.push(`Missing rubric dimension: ${dimension}`);
	}
	return errors;
}

export function validateRoleReport(role: CompletionRole, output: string, fields: Record<string, string>): string[] {
	const errors: string[] = [];
	const evaluatorRoles = new Set<CompletionRole>([
		"completion-reviewer",
		"completion-auditor",
		"completion-stop-judge",
	]);
	if (!evaluatorRoles.has(role)) {
		if (output.trim().length < 20) errors.push("Role report output is too short to transcribe faithfully");
		return errors;
	}

	if (!asString(fields["MISSION ANCHOR"])) errors.push("Missing MISSION ANCHOR");

	if (role === "completion-reviewer") {
		errors.push(...missingFields(REVIEWER_REQUIRED_FIELDS, fields));
		errors.push(...validateRubric(fields));
		const acceptable = parseYesNo(fields["Acceptable as-is"]);
		const followUp = fields["Smallest follow-up slice"];
		if (acceptable === true && followUp && !isNoneLike(followUp)) {
			errors.push("Reviewer cannot mark Acceptable as-is: yes with a non-none follow-up slice");
		}
	}

	if (role === "completion-auditor") {
		errors.push(...missingFields(AUDITOR_REQUIRED_FIELDS, fields));
		errors.push(...validateRubric(fields));
		const clean = parseYesNo(fields["Tracked and unignored worktree is clean"]);
		const blockers = fields["Worktree blockers"];
		if (clean === true && blockers && !isNoneLike(blockers)) {
			errors.push("Auditor cannot mark worktree clean: yes while listing worktree blockers");
		}
	}

	if (role === "completion-stop-judge") {
		errors.push(...missingFields(STOP_JUDGE_REQUIRED_FIELDS, fields));
		errors.push(...validateRubric(fields));
	}

	if (errors.length === 0 && output.trim().length < 40) {
		errors.push("Role report output is too short to transcribe faithfully");
	}

	return errors;
}

export function stopJudgeHistoryRecord(args: {
	role: CompletionRole;
	reportFields: Record<string, string>;
	headSha?: string;
	waveId?: number;
}): Record<string, unknown> | null {
	if (args.role !== "completion-stop-judge") return null;
	return {
		record_type: "judgment",
		role: args.role,
		wave_id: args.waveId ?? 0,
		head_sha: args.headSha ?? null,
		verdict: asString(args.reportFields["Can the project stop now"]),
		blocker_count: asString(args.reportFields["Blocker count"]),
		summary: asString(args.reportFields["Brief justification"]),
		timestamp: new Date().toISOString(),
	};
}
