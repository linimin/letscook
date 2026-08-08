import { promises as fsp } from "node:fs";
import * as path from "node:path";
import type { JsonRecord, WorkflowSnapshot } from "../types.ts";
import { asString, loadWorkflowSnapshot, resolveAgentPaths } from "./state.ts";

export type WorkflowCleanupResult = {
	attempted: boolean;
	removed: boolean;
	path: string;
	reason?: string;
	error?: string;
};

function isTerminalState(state: JsonRecord): boolean {
	const entryStatus = asString(state.workflow_entry_status);
	return (
		entryStatus === "done" ||
		entryStatus === "cancelled" ||
		asString(state.continuation_policy) === "done" ||
		state.project_done === true
	);
}

function ownershipError(snapshot: WorkflowSnapshot, expectedSessionId?: string): string | undefined {
	if (asString(snapshot.profile.protocol_id) !== "completion") {
		return "agent_directory_not_owned_by_completion_protocol";
	}
	if (asString(snapshot.state.orchestrator) !== "letscook-mcp") {
		return "agent_directory_not_owned_by_letscook";
	}

	const stateSessionId = asString(snapshot.state.workflow_session_id);
	if (expectedSessionId && stateSessionId !== expectedSessionId) {
		return "workflow_session_id_mismatch";
	}

	return undefined;
}

/**
 * Remove repo-local completion state after the workflow has reached a terminal
 * posture. The ownership and session checks deliberately fail closed so an
 * unrelated tool's .agent directory can never be removed accidentally.
 */
export async function cleanupClosedWorkflow(
	workspaceRoot: string,
	expectedSessionId?: string,
): Promise<WorkflowCleanupResult> {
	const resolvedRoot = path.resolve(workspaceRoot);
	const files = resolveAgentPaths(resolvedRoot);
	const expectedAgentDir = path.join(resolvedRoot, ".agent");
	const resultBase = { attempted: true, removed: false, path: files.agentDir };

	if (files.agentDir !== expectedAgentDir || path.dirname(files.agentDir) !== resolvedRoot) {
		return { ...resultBase, reason: "unsafe_agent_path" };
	}

	let stat;
	try {
		stat = await fsp.lstat(files.agentDir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { ...resultBase, removed: true, reason: "already_absent" };
		}
		return { ...resultBase, reason: "agent_directory_unreadable", error: String(error) };
	}

	if (stat.isSymbolicLink()) {
		return { ...resultBase, reason: "agent_directory_is_symlink" };
	}
	if (!stat.isDirectory()) {
		return { ...resultBase, reason: "agent_path_is_not_directory" };
	}

	const snapshot = await loadWorkflowSnapshot(resolvedRoot);
	if (!snapshot) {
		return { ...resultBase, reason: "terminal_workflow_state_missing" };
	}
	const ownershipFailure = ownershipError(snapshot, expectedSessionId);
	if (ownershipFailure) {
		return { ...resultBase, reason: ownershipFailure };
	}
	if (!isTerminalState(snapshot.state)) {
		return { ...resultBase, reason: "workflow_not_closed" };
	}
	if (snapshot.state.dispatch_in_flight) {
		return { ...resultBase, reason: "dispatch_in_flight" };
	}

	try {
		await fsp.rm(files.agentDir, { recursive: true, force: true });
		return { ...resultBase, removed: true };
	} catch (error) {
		return {
			...resultBase,
			reason: "remove_failed",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
