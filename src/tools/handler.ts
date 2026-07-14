import { promises as fsp } from "node:fs";
import * as path from "node:path";
import {
	assessCookHandoffStartability,
	buildConfirmationPreview,
	cancelPendingHandoff,
	COOK_HANDOFF_SCHEMA_EXAMPLE,
	markHandoffConfirmed,
	markHandoffKickoffStarted,
	normalizeCookHandoffCapsule,
	readCookHandoffSidecar,
	resolveWorkspaceRoot,
	validateCookHandoffSchema,
	writeCookHandoffFile,
} from "../handoff/capsule.ts";
import {
	cancelWorkflow,
	getWorkflowDispatch,
	getWorkflowStatus,
	parkWorkflow,
	pollWorkflowUpdates,
	resumeWorkflow,
	submitRoleResult,
} from "../orchestrator/dispatch.ts";
import { scaffoldWorkflowFromHandoff } from "../control-plane/state.ts";
import { asString, loadWorkflowSnapshot } from "../control-plane/state.ts";
import { ensureCookWorktree, findGitRepoRoot } from "../worktree.ts";

function textResult(payload: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
	};
}

function toolError(message: string, code?: string) {
	return textResult({ ok: false, error: message, code });
}

function requireWorkspaceRoot(args: Record<string, unknown>): string {
	return resolveWorkspaceRoot({
		workspaceRoot: typeof args.workspace_root === "string" ? args.workspace_root : undefined,
		requireExplicit: true,
	});
}

export async function handleLetscookTool(name: string, args: Record<string, unknown>) {
	try {
		switch (name) {
			case "ensure_cook_worktree": {
				const repoRoot = path.resolve(
					typeof args.repo_root === "string"
						? args.repo_root
						: (findGitRepoRoot(process.cwd()) ?? process.cwd()),
				);
				const slug = typeof args.slug === "string" ? args.slug : "task";
				const branch = typeof args.branch === "string" ? args.branch : `cook/${slug}`;
				const result = await ensureCookWorktree({
					repoRoot,
					branch,
					slug,
					baseRef: typeof args.base_ref === "string" ? args.base_ref : "HEAD",
				});
				return textResult({ ok: true, ...result });
			}
			case "prepare_cook_handoff": {
				const workspaceRoot = requireWorkspaceRoot(args);
				const capsule = normalizeCookHandoffCapsule(args);
				const schema = validateCookHandoffSchema(capsule);
				if (!schema.ok) return toolError(schema.errors.join("; "), "schema_invalid");
				const assessment = assessCookHandoffStartability(capsule);
				if (!assessment.startable) return toolError(assessment.errors.join("; "), "not_startable");
				const written = await writeCookHandoffFile(workspaceRoot, capsule, {
					workspace_root: workspaceRoot,
					branch: typeof args.branch === "string" ? args.branch : undefined,
				});
				return textResult({
					ok: true,
					workspace_root: workspaceRoot,
					confirmation_id: written.confirmationId,
					handoff_sha256: written.handoffSha256,
					confirmation_preview: buildConfirmationPreview(capsule),
					next_steps: [
						"Show confirmation_preview to the user",
						"On Start, call start_cook_workflow with workspace_root and confirmation_id",
					],
				});
			}
			case "preview_cook_handoff_confirmation": {
				const workspaceRoot = requireWorkspaceRoot(args);
				const sidecar = await readCookHandoffSidecar(workspaceRoot);
				if (!sidecar) return toolError("no pending handoff", "no_pending_handoff");
				const handoffRaw = await fsp.readFile(
					path.join(workspaceRoot, ".agent/tmp/cursor-handoff.json"),
					"utf8",
				);
				const capsule = normalizeCookHandoffCapsule(JSON.parse(handoffRaw) as Record<string, unknown>);
				return textResult({
					ok: true,
					workspace_root: workspaceRoot,
					confirmation_id: sidecar.confirmation_id,
					layout: buildConfirmationPreview(capsule),
				});
			}
			case "start_cook_workflow": {
				const workspaceRoot = requireWorkspaceRoot(args);
				const action = asString(args.action) ?? "start";
				if (action === "cancel") {
					await cancelPendingHandoff(workspaceRoot);
					return textResult({ ok: true, cancelled: true });
				}
				const confirmationId = asString(args.confirmation_id);
				if (!confirmationId) return toolError("confirmation_id is required to start", "missing_confirmation_id");
				const sidecar = await readCookHandoffSidecar(workspaceRoot);
				if (!sidecar) return toolError("no pending handoff sidecar", "no_pending_handoff");
				if (sidecar.workspace_root !== path.resolve(workspaceRoot)) {
					return toolError("workspace_root does not match sidecar", "workspace_mismatch");
				}
				if (args.dry_run === true) {
					return textResult({
						ok: true,
						dry_run: true,
						workspace_root: workspaceRoot,
						confirmation_id: confirmationId,
						would_scaffold: true,
					});
				}
				await markHandoffConfirmed(workspaceRoot, confirmationId);
				const handoffRaw = await fsp.readFile(
					path.join(workspaceRoot, ".agent/tmp/cursor-handoff.json"),
					"utf8",
				);
				const capsule = normalizeCookHandoffCapsule(JSON.parse(handoffRaw) as Record<string, unknown>);
				const projectName = path.basename(workspaceRoot);
				const snapshot = await scaffoldWorkflowFromHandoff(workspaceRoot, capsule, projectName);
				await markHandoffKickoffStarted(workspaceRoot, confirmationId);
				const dispatch = await getWorkflowDispatch(workspaceRoot);
				return textResult({
					ok: true,
					workspace_root: workspaceRoot,
					workflow_session_id: asString(snapshot.state.workflow_session_id),
					orchestrator: "letscook-mcp",
					monitoring: { enabled: true, mode: "cursor_subagent_loop" },
					dispatch,
					next_steps: [
						"Call get_workflow_dispatch to fetch the first mandatory role",
						"Dispatch a Cursor subagent (Task) with returned system_context + task_prompt",
						"Call submit_role_result when the subagent completes",
						"Repeat until dispatch.dispatch_allowed is false",
					],
				});
			}
			case "get_cook_handoff_status": {
				const workspaceRoot = requireWorkspaceRoot(args);
				const sidecar = await readCookHandoffSidecar(workspaceRoot);
				const workflow = await loadWorkflowSnapshot(workspaceRoot);
				return textResult({
					ok: true,
					workspace_root: workspaceRoot,
					sidecar: sidecar ?? null,
					workflow_active: Boolean(workflow),
				});
			}
			case "get_cook_handoff_schema":
				return textResult({ ok: true, example: COOK_HANDOFF_SCHEMA_EXAMPLE });
			case "get_workflow_dispatch":
				return textResult({ ok: true, ...(await getWorkflowDispatch(requireWorkspaceRoot(args))) });
			case "submit_role_result":
				return textResult({
					ok: true,
					...(await submitRoleResult({
						workspace_root: requireWorkspaceRoot(args),
						role: asString(args.role) ?? "",
						raw_output: asString(args.raw_output) ?? "",
						ok: args.ok !== false,
						structured: typeof args.structured === "object" && args.structured !== null ? (args.structured as Record<string, unknown>) : undefined,
					})),
				});
			case "get_workflow_status":
				return textResult(await getWorkflowStatus(requireWorkspaceRoot(args)));
			case "poll_workflow_updates":
				return textResult(
					await pollWorkflowUpdates(
						requireWorkspaceRoot(args),
						typeof args.since_event_id === "string" ? args.since_event_id : undefined,
					),
				);
			case "park_workflow":
				return textResult(await parkWorkflow(requireWorkspaceRoot(args), asString(args.reason)));
			case "resume_workflow":
				return textResult(await resumeWorkflow(requireWorkspaceRoot(args)));
			case "cancel_workflow":
				return textResult(await cancelWorkflow(requireWorkspaceRoot(args), asString(args.reason)));
			default:
				return toolError(`unknown tool: ${name}`, "unknown_tool");
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return toolError(message, "tool_failed");
	}
}
