import { promises as fsp } from "node:fs";
import * as path from "node:path";
import {
	assessCookHandoffStartability,
	buildConfirmationPreview,
	COOK_HANDOFF_SCHEMA_EXAMPLE,
	normalizeCookHandoffCapsule,
	readCookHandoffSidecar,
	resolveWorkspaceRoot,
	validateCookHandoffSchema,
	writeCookHandoffFile,
} from "../handoff/capsule.ts";
import { confirmCookHandoff, formatConfirmationBrief, buildIsolationConfirmationSection } from "../handoff/confirmation.ts";
import {
	getHandoffSynthesisPrompt,
	submitStartupAnalysis,
	synthesizeCookHandoff,
	validateCookHandoffTool,
} from "../handoff/synthesize.ts";
import { cancelCookHandoff, startCookWorkflowFromHandoff } from "../handoff/start-workflow.ts";
import type { LetscookToolContext } from "./context.ts";
import {
	cancelWorkflow,
	claimWorkflowDispatch,
	getWorkflowDispatch,
	getWorkflowStatus,
	parkWorkflow,
	pollWorkflowUpdates,
	resumeWorkflow,
	submitRoleResult,
} from "../orchestrator/dispatch.ts";
import { asString, loadWorkflowSnapshot } from "../control-plane/state.ts";
import { listCursorPlans, previewPlanToCookHandoff } from "../handoff/plan-to-capsule.ts";
import {
	buildFinishCookWorkflowGuide,
	cursorWorktreesHomeHint,
	defaultCursorWorktreesJsonExample,
	findGitRepoRoot,
	findMainGitRepoRoot,
	getCookWorkspaceContext,
	resolveCookWorkspace,
} from "../worktree.ts";

function confirmationLayoutForWorkspace(workspaceRoot: string, capsule: ReturnType<typeof normalizeCookHandoffCapsule>) {
	const layout = buildConfirmationPreview(capsule);
	const workspaceContext = getCookWorkspaceContext({ workspaceRoot });
	const isolationConfirmRequired = workspaceContext.isolation_confirm_required;
	if (isolationConfirmRequired) {
		layout.isolation_section = buildIsolationConfirmationSection(workspaceContext);
	}
	return { layout, confirmOptions: { isolationConfirmRequired } };
}

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

export async function handleLetscookTool(
	name: string,
	args: Record<string, unknown>,
	ctx: LetscookToolContext = {},
) {
	try {
		switch (name) {
			case "get_cook_workspace_context": {
				const context = getCookWorkspaceContext({
					workspaceRoot: typeof args.workspace_root === "string" ? args.workspace_root : undefined,
					cwd: typeof args.repo_root === "string" ? args.repo_root : process.cwd(),
				});
				return textResult({
					ok: true,
					...context,
					cursor_worktrees_home: cursorWorktreesHomeHint(),
					worktrees_json_example: defaultCursorWorktreesJsonExample(),
				});
			}
			case "resolve_cook_workspace": {
				const mode = args.mode === "cursor_native" || args.mode === "auto" ? args.mode : "auto";
				return textResult(
					await resolveCookWorkspace({
						mode,
						workspaceRoot: typeof args.workspace_root === "string" ? args.workspace_root : undefined,
						repoRoot: typeof args.repo_root === "string" ? args.repo_root : undefined,
					}),
				);
			}
			case "finish_cook_workflow": {
				const workspaceRoot = requireWorkspaceRoot(args);
				const status = await getWorkflowStatus(workspaceRoot);
				const guide = buildFinishCookWorkflowGuide({
					workspaceRoot,
					workflowClosed: status.workflow_closed === true,
				});
				return textResult({
					workflow_status: status,
					...guide,
				});
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
				const { layout, confirmOptions } = confirmationLayoutForWorkspace(workspaceRoot, capsule);
				return textResult({
					ok: true,
					workspace_root: workspaceRoot,
					confirmation_id: written.confirmationId,
					handoff_sha256: written.handoffSha256,
					confirmation_preview: layout,
					confirmation_brief: formatConfirmationBrief(layout, confirmOptions),
					next_steps: [
						"Call confirm_cook_handoff({ workspace_root }) for MCP elicitation or AskQuestion fallback",
					],
				});
			}
			case "confirm_cook_handoff": {
				const workspaceRoot = requireWorkspaceRoot(args);
				const confirmationActionRaw = asString(args.confirmation_action);
				const confirmationAction =
					confirmationActionRaw === "start_on_main" ? "start" : confirmationActionRaw;
				const allowedActions = new Set(["start", "start_on_main", "cancel", "edit", "defer_worktree"]);
				const result = await confirmCookHandoff(workspaceRoot, ctx, {
					skip_elicitation: args.skip_elicitation === true,
					...(confirmationActionRaw && allowedActions.has(confirmationActionRaw)
						? { confirmation_action: confirmationAction as "start" | "cancel" | "edit" | "defer_worktree" }
						: {}),
				});
				if (result.ok === false) return toolError(asString(result.error) ?? "confirm failed", asString(result.code));
				return textResult(result);
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
				const { layout, confirmOptions } = confirmationLayoutForWorkspace(workspaceRoot, capsule);
				return textResult({
					ok: true,
					workspace_root: workspaceRoot,
					confirmation_id: sidecar.confirmation_id,
					layout,
					confirmation_brief: formatConfirmationBrief(layout, confirmOptions),
					next_steps: ["Call confirm_cook_handoff({ workspace_root }) to show native confirmation UI"],
				});
			}
			case "start_cook_workflow": {
				const workspaceRoot = requireWorkspaceRoot(args);
				const action = asString(args.action) ?? "start";
				if (action === "cancel") {
					return textResult({ ok: true, ...(await cancelCookHandoff(workspaceRoot)) });
				}
				const confirmationId = asString(args.confirmation_id);
				if (!confirmationId) return toolError("confirmation_id is required to start", "missing_confirmation_id");
				const sidecar = await readCookHandoffSidecar(workspaceRoot);
				if (!sidecar) return toolError("no pending handoff sidecar", "no_pending_handoff");
				if (sidecar.workspace_root !== path.resolve(workspaceRoot)) {
					return toolError("workspace_root does not match sidecar", "workspace_mismatch");
				}
				if (sidecar.status !== "confirmed") {
					return toolError(
						"handoff not confirmed: call confirm_cook_handoff before start_cook_workflow",
						"confirmation_required",
					);
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
				const isolationChoice = asString(args.isolation_choice);
				const workspaceContext = getCookWorkspaceContext({ workspaceRoot });
				if (
					workspaceContext.isolation_confirm_required &&
					isolationChoice !== "main_checkout_acknowledged"
				) {
					return toolError(
						"isolation_choice must be main_checkout_acknowledged on main checkout; use confirm_cook_handoff first",
						"isolation_required",
					);
				}
				return textResult({
					ok: true,
					...(await startCookWorkflowFromHandoff(workspaceRoot, confirmationId, {
						...(isolationChoice ? { isolationChoice } : {}),
					})),
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
			case "get_handoff_synthesis_prompt":
				return textResult(
					getHandoffSynthesisPrompt({
						workspace_root: typeof args.workspace_root === "string" ? args.workspace_root : undefined,
						project_name: typeof args.project_name === "string" ? args.project_name : undefined,
						discussion_summary: typeof args.discussion_summary === "string" ? args.discussion_summary : undefined,
						inline_intent: typeof args.inline_intent === "string" ? args.inline_intent : undefined,
						workflow_context_lines: Array.isArray(args.workflow_context_lines)
							? args.workflow_context_lines.filter((v): v is string => typeof v === "string")
							: undefined,
					}),
				);
			case "submit_startup_analysis":
				if (typeof args.structured_analysis !== "object" || args.structured_analysis === null) {
					return toolError("structured_analysis is required", "missing_structured_analysis");
				}
				return textResult(
					submitStartupAnalysis({
						project_name: typeof args.project_name === "string" ? args.project_name : undefined,
						structured_analysis: args.structured_analysis as Record<string, unknown>,
					}),
				);
			case "synthesize_cook_handoff":
				return textResult(
					synthesizeCookHandoff({
						workspace_root: typeof args.workspace_root === "string" ? args.workspace_root : undefined,
						project_name: typeof args.project_name === "string" ? args.project_name : undefined,
						discussion_summary: typeof args.discussion_summary === "string" ? args.discussion_summary : undefined,
						inline_intent: typeof args.inline_intent === "string" ? args.inline_intent : undefined,
						explicit_capsule:
							typeof args.explicit_capsule === "object" && args.explicit_capsule !== null
								? (args.explicit_capsule as Record<string, unknown>)
								: undefined,
						structured_analysis:
							typeof args.structured_analysis === "object" && args.structured_analysis !== null
								? (args.structured_analysis as Record<string, unknown>)
								: undefined,
						plan_capsule:
							typeof args.plan_capsule === "object" && args.plan_capsule !== null
								? (args.plan_capsule as Record<string, unknown>)
								: undefined,
						workflow_context_lines: Array.isArray(args.workflow_context_lines)
							? args.workflow_context_lines.filter((v): v is string => typeof v === "string")
							: undefined,
					}),
				);
			case "validate_cook_handoff": {
				if (typeof args.capsule !== "object" || args.capsule === null) {
					return toolError("capsule is required", "missing_capsule");
				}
				return textResult(
					validateCookHandoffTool(
						args.capsule as Record<string, unknown>,
						typeof args.project_name === "string" ? args.project_name : undefined,
					),
				);
			}
			case "list_cursor_plans": {
				const repoRoot =
					typeof args.repo_root === "string"
						? path.resolve(args.repo_root)
						: (findMainGitRepoRoot(process.cwd()) ?? findGitRepoRoot(process.cwd()) ?? process.cwd());
				const plans = await listCursorPlans({
					repoRoot,
					includeGlobal: args.include_global === true,
					planHint: typeof args.plan_hint === "string" ? args.plan_hint : undefined,
				});
				return textResult({ ok: true, repo_root: repoRoot, plans });
			}
			case "preview_plan_to_cook_handoff":
				return textResult(
					await previewPlanToCookHandoff({
						planPath: typeof args.plan_path === "string" ? args.plan_path : undefined,
						openPlanPath: typeof args.open_plan_path === "string" ? args.open_plan_path : undefined,
						planHint: typeof args.plan_hint === "string" ? args.plan_hint : undefined,
						repoRoot:
							typeof args.repo_root === "string"
								? path.resolve(args.repo_root)
								: (findMainGitRepoRoot(process.cwd()) ?? findGitRepoRoot(process.cwd()) ?? process.cwd()),
						overrides:
							typeof args.overrides === "object" && args.overrides !== null
								? (args.overrides as Record<string, unknown>)
								: undefined,
					}),
				);
			case "get_workflow_dispatch":
				return textResult({ ok: true, ...(await getWorkflowDispatch(requireWorkspaceRoot(args))) });
			case "claim_workflow_dispatch":
				return textResult({
					ok: true,
					...(await claimWorkflowDispatch({
						workspace_root: requireWorkspaceRoot(args),
						force: args.force === true,
					})),
				});
			case "submit_role_result":
				return textResult({
					ok: true,
					...(await submitRoleResult({
						workspace_root: requireWorkspaceRoot(args),
						role: asString(args.role) ?? "",
						raw_output: asString(args.raw_output) ?? "",
						dispatch_key: asString(args.dispatch_key),
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
