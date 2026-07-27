import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { scaffoldWorkflowFromHandoff, loadWorkflowSnapshot, isWorkflowParked, isWorkflowActivelyRunning, asString } from "../control-plane/state.ts";
import { getWorkflowDispatch } from "../orchestrator/dispatch.ts";
import {
	cancelPendingHandoff,
	markHandoffConfirmed,
	markHandoffKickoffStarted,
	normalizeCookHandoffCapsule,
	readCookHandoffSidecar,
} from "./capsule.ts";

export type StartCookWorkflowResult = {
	workspace_root: string;
	confirmation_id: string;
	workflow_session_id?: string;
	orchestrator: string;
	monitoring: { enabled: boolean; mode: string };
	dispatch: Awaited<ReturnType<typeof getWorkflowDispatch>>;
	next_steps: string[];
};

async function readHandoffCapsule(workspaceRoot: string) {
	const handoffRaw = await fsp.readFile(path.join(workspaceRoot, ".agent/tmp/cursor-handoff.json"), "utf8");
	return normalizeCookHandoffCapsule(JSON.parse(handoffRaw) as Record<string, unknown>);
}

export async function startCookWorkflowFromHandoff(
	workspaceRoot: string,
	confirmationId: string,
	options?: { isolationChoice?: string },
): Promise<StartCookWorkflowResult> {
	const resolvedRoot = path.resolve(workspaceRoot);
	const sidecar = await readCookHandoffSidecar(resolvedRoot);
	if (!sidecar) throw new Error("no pending handoff sidecar");
	if (sidecar.workspace_root !== resolvedRoot) throw new Error("workspace_root does not match sidecar");
	if (sidecar.confirmation_id !== confirmationId) throw new Error("confirmation_id mismatch");
	if (sidecar.status !== "confirmed") {
		throw new Error("handoff not confirmed: call confirm_cook_handoff before start_cook_workflow");
	}

	const capsule = await readHandoffCapsule(resolvedRoot);
	if (options?.isolationChoice) {
		capsule.isolation_choice = options.isolationChoice;
	}
	const existing = await loadWorkflowSnapshot(resolvedRoot);
	if (existing) {
		if (isWorkflowParked(existing)) {
			throw new Error(
				"workflow is parked: call resume_workflow to continue, or cancel_workflow before start_cook_workflow",
			);
		}
		if (isWorkflowActivelyRunning(existing)) {
			throw new Error(
				"workflow already active: continue with get_workflow_dispatch or cancel_workflow before start_cook_workflow",
			);
		}
	}
	const projectName = path.basename(resolvedRoot);
	const snapshot = await scaffoldWorkflowFromHandoff(resolvedRoot, capsule, projectName);
	await markHandoffKickoffStarted(resolvedRoot, confirmationId);
	const dispatch = await getWorkflowDispatch(resolvedRoot);

	return {
		workspace_root: resolvedRoot,
		confirmation_id: confirmationId,
		workflow_session_id: asString(snapshot.state.workflow_session_id),
		orchestrator: "letscook-mcp",
		monitoring: { enabled: true, mode: "cursor_subagent_loop" },
		dispatch,
		next_steps: [
			"Call get_workflow_dispatch for preflight on the first mandatory role",
			"Call claim_workflow_dispatch before launching the bundled cursor_agent Task",
			"Call submit_role_result when the agent completes",
			"Repeat until workflow is closed",
		],
	};
}

export async function cancelCookHandoff(workspaceRoot: string): Promise<{ cancelled: true }> {
	await cancelPendingHandoff(path.resolve(workspaceRoot));
	return { cancelled: true };
}
