import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { scaffoldWorkflowFromHandoff } from "../control-plane/state.ts";
import { asString } from "../control-plane/state.ts";
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
): Promise<StartCookWorkflowResult> {
	const resolvedRoot = path.resolve(workspaceRoot);
	const sidecar = await readCookHandoffSidecar(resolvedRoot);
	if (!sidecar) throw new Error("no pending handoff sidecar");
	if (sidecar.workspace_root !== resolvedRoot) throw new Error("workspace_root does not match sidecar");
	if (sidecar.confirmation_id !== confirmationId) throw new Error("confirmation_id mismatch");

	await markHandoffConfirmed(resolvedRoot, confirmationId);
	const capsule = await readHandoffCapsule(resolvedRoot);
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
			"Call get_workflow_dispatch to fetch the first mandatory role",
			"Invoke the bundled cursor_agent via Task/subagent delegation",
			"Call submit_role_result when the agent completes",
			"Repeat until dispatch.dispatch_allowed is false",
		],
	};
}

export async function cancelCookHandoff(workspaceRoot: string): Promise<{ cancelled: true }> {
	await cancelPendingHandoff(path.resolve(workspaceRoot));
	return { cancelled: true };
}
