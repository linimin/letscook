import * as fs from "node:fs";
import * as path from "node:path";
import type { CompletionRole, JsonRecord, WorkflowSnapshot } from "../types.ts";
import { asString, resolveAgentPaths } from "../control-plane/state.ts";

const ROLE_SET = new Set<string>([
	"completion-bootstrapper",
	"completion-regrounder",
	"completion-implementer",
	"completion-reviewer",
	"completion-auditor",
	"completion-stop-judge",
]);

function isCompletionRole(value: string | undefined): value is CompletionRole {
	return Boolean(value && ROLE_SET.has(value));
}

function candidateSlices(plan: JsonRecord): JsonRecord[] {
	const slices = plan.candidate_slices;
	return Array.isArray(slices) ? slices.filter((s): s is JsonRecord => typeof s === "object" && s !== null) : [];
}

function allSlicesDone(plan: JsonRecord): boolean {
	const slices = candidateSlices(plan);
	if (slices.length === 0) return false;
	return slices.every((slice) => asString(slice.status)?.toLowerCase() === "done");
}

function hasVerifierScripts(root: string): boolean {
	const files = resolveAgentPaths(root);
	return (
		fs.existsSync(path.join(files.agentDir, "verify_completion_stop.sh")) &&
		fs.existsSync(path.join(files.agentDir, "verify_completion_control_plane.sh"))
	);
}

function readJsonlTail(filePath: string, role?: string): JsonRecord | undefined {
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		const lines = raw.split("\n").filter(Boolean);
		for (let i = lines.length - 1; i >= 0; i -= 1) {
			const parsed = JSON.parse(lines[i]!) as JsonRecord;
			if (!role || asString(parsed.role) === role) return parsed;
		}
	} catch {
		// ignore
	}
	return undefined;
}

function latestCommittedSliceId(snapshot: WorkflowSnapshot): string | undefined {
	return (
		asString(snapshot.state.latest_completed_slice) ??
		asString(snapshot.active.slice_id) ??
		undefined
	);
}

function sliceHasReview(snapshot: WorkflowSnapshot, sliceId: string): boolean {
	const record = readJsonlTail(snapshot.files.sliceHistoryPath, "completion-reviewer");
	return asString(record?.slice_id) === sliceId || Boolean(record && asString(record.verdict));
}

function sliceHasAudit(snapshot: WorkflowSnapshot, sliceId: string): boolean {
	const record = readJsonlTail(snapshot.files.sliceHistoryPath, "completion-auditor");
	return asString(record?.slice_id) === sliceId || Boolean(record && asString(record.verdict));
}

function latestRoleRecordForSlice(snapshot: WorkflowSnapshot, role: string, sliceId: string): JsonRecord | undefined {
	try {
		const raw = fs.readFileSync(snapshot.files.sliceHistoryPath, "utf8");
		const lines = raw.split("\n").filter(Boolean);
		for (let i = lines.length - 1; i >= 0; i -= 1) {
			const parsed = JSON.parse(lines[i]!) as JsonRecord;
			if (asString(parsed.role) !== role) continue;
			if (asString(parsed.slice_id) !== sliceId) continue;
			return parsed;
		}
	} catch {
		// ignore
	}
	return undefined;
}

function reviewRejectsSlice(snapshot: WorkflowSnapshot, sliceId: string): boolean {
	const record = latestRoleRecordForSlice(snapshot, "completion-reviewer", sliceId);
	const fields = record?.report_fields;
	if (!fields || typeof fields !== "object") return false;
	const acceptable = asString((fields as JsonRecord)["Acceptable as-is"]);
	return Boolean(acceptable?.toLowerCase().startsWith("no"));
}

function rejectedReviewDispatch(): MandatoryDispatchResult {
	return {
		role: "completion-regrounder",
		action: "Reopen the rejected slice or cut the follow-up slice from the latest review",
		reason: "review_rejected",
	};
}

function missingAuditDispatch(): MandatoryDispatchResult {
	return {
		role: "completion-auditor",
		action: "Audit the whole project at HEAD after the accepted slice",
		reason: "missing_audit",
	};
}

export type MandatoryDispatchResult = {
	role: CompletionRole | null;
	action: string;
	reason: string;
};

export function resolveMandatoryDispatch(snapshot: WorkflowSnapshot): MandatoryDispatchResult {
	const root = snapshot.files.root;
	if (!hasVerifierScripts(root)) {
		return {
			role: "completion-bootstrapper",
			action: "Scaffold or repair local verifier scripts and canonical helper surfaces",
			reason: "missing_verifier_scripts",
		};
	}

	const continuation = asString(snapshot.state.continuation_policy);
	if (continuation === "await_user_input" || continuation === "blocked") {
		return { role: null, action: "Await user input or unblock", reason: continuation };
	}

	if (snapshot.state.requires_reground === true || asString(snapshot.state.current_phase) === "reground") {
		const activeStatus = asString(snapshot.active.status)?.toLowerCase();
		if (activeStatus === "selected" || activeStatus === "in_progress") {
			return {
				role: "completion-implementer",
				action: "Implement the selected slice and land one commit",
				reason: "slice_selected",
			};
		}
	}

	const activeStatus = asString(snapshot.active.status)?.toLowerCase() ?? "idle";
	const sliceId = asString(snapshot.active.slice_id);

	if ((activeStatus === "selected" || activeStatus === "in_progress") && sliceId) {
		const basisCommit = asString(snapshot.active.basis_commit);
		if (!basisCommit) {
			return {
				role: "completion-implementer",
				action: "Implement the selected slice and land one commit",
				reason: "slice_in_progress_without_commit",
			};
		}
		if (!sliceHasReview(snapshot, sliceId)) {
			return {
				role: "completion-reviewer",
				action: "Review the latest committed slice",
				reason: "missing_review",
			};
		}
		if (!sliceHasAudit(snapshot, sliceId)) {
			if (reviewRejectsSlice(snapshot, sliceId)) return rejectedReviewDispatch();
			return missingAuditDispatch();
		}
		return {
			role: "completion-regrounder",
			action: "Reconcile canonical plan after review and audit",
			reason: "post_eval_reground",
		};
	}

	if (activeStatus === "idle" || !sliceId) {
		const remainingJudges =
			typeof snapshot.state.remaining_stop_judges === "number" ? snapshot.state.remaining_stop_judges : 0;
		if (allSlicesDone(snapshot.plan) && remainingJudges > 0) {
			return {
				role: "completion-stop-judge",
				action: `Record stop-judge verdict for wave ${snapshot.state.current_stop_wave_id ?? 0}`,
				reason: "stop_wave",
			};
		}
		return {
			role: "completion-regrounder",
			action: "Reconcile canonical state and select next slice",
			reason: "no_active_slice",
		};
	}

	const committedId = latestCommittedSliceId(snapshot);
	if (committedId && !sliceHasReview(snapshot, committedId)) {
		return { role: "completion-reviewer", action: "Review latest commit", reason: "missing_review" };
	}
	if (committedId && !sliceHasAudit(snapshot, committedId)) {
		if (reviewRejectsSlice(snapshot, committedId)) return rejectedReviewDispatch();
		return missingAuditDispatch();
	}

	return {
		role: "completion-regrounder",
		action: "Reconcile canonical state from repo truth",
		reason: "default_reground",
	};
}

export function mandatoryNextRoleAfterCompletion(
	role: CompletionRole,
	snapshot: WorkflowSnapshot,
	reportFields: JsonRecord,
): CompletionRole | null {
	const resolved = resolveMandatoryDispatch(snapshot);
	let nextRole = resolved.role;

	if (role === "completion-stop-judge") {
		const remaining = typeof snapshot.state.remaining_stop_judges === "number" ? snapshot.state.remaining_stop_judges : 2;
		const nextRemaining = Math.max(0, remaining - 1);
		const verdict = asString(reportFields.verdict)?.toLowerCase();
		if (nextRemaining > 0 && verdict !== "can_stop") {
			return "completion-stop-judge";
		}
		if (nextRemaining > 0) return "completion-stop-judge";
		return "completion-regrounder";
	}

	const advisory = asString(reportFields.recommended_next_role);
	if (isCompletionRole(advisory)) nextRole = advisory;

	if (role === "completion-regrounder") {
		const activeStatus = asString(snapshot.active.status)?.toLowerCase();
		if (activeStatus === "selected" || activeStatus === "in_progress") return "completion-implementer";
	}

	if (role === "completion-reviewer") {
		const acceptable = asString(reportFields["Acceptable as-is"])?.toLowerCase();
		if (acceptable?.startsWith("no")) return "completion-regrounder";
		if (acceptable?.startsWith("yes")) return "completion-auditor";
	}

	if (!nextRole) return null;
	return nextRole;
}
