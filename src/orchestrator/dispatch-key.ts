import { spawnSync } from "node:child_process";
import type { CompletionRole, JsonRecord, WorkflowSnapshot } from "../types.ts";
import { asString } from "../control-plane/state.ts";

export type DispatchInFlight = {
	role: CompletionRole;
	slice_id: string | null;
	head_sha: string;
	claimed_at: string;
	dispatch_key: string;
};

export function resolveGitHead(workspaceRoot: string): string | undefined {
	const result = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: workspaceRoot,
		encoding: "utf8",
	});
	if (result.status !== 0) return undefined;
	const head = result.stdout.trim();
	return head.length > 0 ? head : undefined;
}

export function buildDispatchKey(role: CompletionRole, sliceId: string | null | undefined, headSha: string): string {
	const slicePart = sliceId && sliceId.trim().length > 0 ? sliceId.trim() : "none";
	return `${role}:${slicePart}:${headSha}`;
}

export function buildDispatchKeyForContext(
	role: CompletionRole,
	sliceId: string | null | undefined,
	headSha: string,
	snapshot: WorkflowSnapshot,
): string {
	if (role === "completion-stop-judge") {
		const waveId =
			typeof snapshot.state.current_stop_wave_id === "number" ? snapshot.state.current_stop_wave_id : 0;
		const remaining =
			typeof snapshot.state.remaining_stop_judges === "number" ? snapshot.state.remaining_stop_judges : 2;
		const required =
			typeof snapshot.profile?.required_stop_judges === "number"
				? snapshot.profile.required_stop_judges
				: 2;
		const judgeSlot = Math.max(0, required - remaining);
		const slicePart = sliceId && sliceId.trim().length > 0 ? sliceId.trim() : "none";
		return `${role}:${slicePart}:wave${waveId}:slot${judgeSlot}:${headSha}`;
	}
	return buildDispatchKey(role, sliceId, headSha);
}

export function activeSliceId(snapshot: WorkflowSnapshot): string | null {
	return asString(snapshot.active.slice_id) ?? null;
}

export function readDispatchInFlight(snapshot: WorkflowSnapshot): DispatchInFlight | null {
	const raw = snapshot.state.dispatch_in_flight;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const record = raw as JsonRecord;
	const role = asString(record.role);
	const headSha = asString(record.head_sha);
	const claimedAt = asString(record.claimed_at);
	const dispatchKey = asString(record.dispatch_key);
	if (!role || !headSha || !claimedAt || !dispatchKey) return null;
	const sliceId = asString(record.slice_id) ?? null;
	return {
		role: role as CompletionRole,
		slice_id: sliceId,
		head_sha: headSha,
		claimed_at: claimedAt,
		dispatch_key: dispatchKey,
	};
}

export function shouldAutoClearInFlight(
	inFlight: DispatchInFlight,
	role: CompletionRole,
	sliceId: string | null,
	_headSha: string,
): boolean {
	if (inFlight.role !== role) return true;
	if (inFlight.slice_id !== sliceId) return true;
	return false;
}

export function isStaleInFlight(
	inFlight: DispatchInFlight,
	currentRole: CompletionRole,
	currentSliceId: string | null,
	_currentHead: string,
): boolean {
	if (inFlight.role !== currentRole) return true;
	if (inFlight.slice_id !== currentSliceId) return true;
	return false;
}
