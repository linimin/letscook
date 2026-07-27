import { promises as fsp } from "node:fs";
import * as path from "node:path";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import { asString, asStringArray } from "../control-plane/state.ts";
import type { LetscookToolContext } from "../tools/context.ts";
import type { CookHandoffSidecar, JsonRecord } from "../types.ts";
import type { CookWorkspaceContext } from "../worktree.ts";
import { getCookWorkspaceContext } from "../worktree.ts";
import {
	buildConfirmationPreview,
	cancelPendingHandoff,
	markHandoffConfirmed,
	normalizeCookHandoffCapsule,
	readCookHandoffSidecar,
} from "./capsule.ts";
import { cancelCookHandoff, startCookWorkflowFromHandoff } from "./start-workflow.ts";
import { loadWorkflowSnapshot, isWorkflowActivelyRunning, isWorkflowParked } from "../control-plane/state.ts";

export type PendingHandoff = {
	workspaceRoot: string;
	sidecar: CookHandoffSidecar;
	capsule: JsonRecord;
	layout: JsonRecord;
	workspaceContext: CookWorkspaceContext;
};

export type AskQuestionHandoffPayload = {
	title: string;
	questions: Array<{
		id: string;
		prompt: string;
		options: Array<{ id: string; label: string }>;
	}>;
};

export type HandoffConfirmationOptions = {
	isolationConfirmRequired: boolean;
};

export const DEFER_WORKTREE_NEXT_STEPS = [
	"Run Cursor `/worktree <short task summary>` in this chat",
	"Then run `/cook` again in the worktree chat",
	"Do not press Plan Build locally",
] as const;

function bulletLines(items: string[]): string {
	return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- (none)";
}

export function buildIsolationConfirmationSection(context: CookWorkspaceContext): string {
	const branchLabel = context.branch || "(detached or unknown)";
	return [
		"## Workspace isolation",
		"",
		`You are on the **main checkout** (branch: \`${branchLabel}\`).`,
		"",
		"Starting cook here will edit this checkout directly. Risks:",
		"- Long workflows may leave a dirty worktree mixed with unrelated local changes",
		"- There is no `/apply-worktree` sandbox to discard or merge later",
		"- Slice commits land on your current branch without an isolated rollback path",
		"",
		"For high-risk or multi-slice work, prefer Cursor `/worktree` first.",
	].join("\n");
}

export function formatConfirmationBrief(
	layout: JsonRecord,
	options?: HandoffConfirmationOptions,
): string {
	const layoutText = asString(layout.layout_text);
	let body = "";
	if (layoutText) {
		body = layoutText;
	} else {
		const nested = layout.layout;
		if (nested && typeof nested === "object" && !Array.isArray(nested)) {
			const intro = asString((nested as JsonRecord).intro);
			const proposalBody = asString((nested as JsonRecord).proposalBody);
			if (intro || proposalBody) {
				body = [intro, proposalBody].filter(Boolean).join("\n\n");
			}
		}
		if (!body) {
			const lines = [
				`**Mission:** ${asString(layout.mission) ?? "(missing)"}`,
				"",
				"**Scope:**",
				bulletLines(asStringArray(layout.scope)),
				"",
				"**Constraints:**",
				bulletLines(asStringArray(layout.constraints)),
				"",
				"**Acceptance:**",
				bulletLines(asStringArray(layout.acceptance)),
			];
			const risks = asStringArray(layout.risks);
			if (risks.length > 0) {
				lines.push("", "**Risks:**", bulletLines(risks));
			}
			const whyCookNow = asString(layout.why_cook_now);
			if (whyCookNow) {
				lines.push("", `**Why cook now:** ${whyCookNow}`);
			}
			body = lines.join("\n");
		}
	}

	if (options?.isolationConfirmRequired) {
		const isolationSection = asString(layout.isolation_section);
		if (isolationSection) {
			return `${isolationSection}\n\n${body}`;
		}
	}
	return body;
}

export function buildAskQuestionHandoffPayload(
	layout: JsonRecord,
	options?: HandoffConfirmationOptions,
): AskQuestionHandoffPayload {
	const brief = formatConfirmationBrief(layout, options);
	if (options?.isolationConfirmRequired) {
		return {
			title: "Confirm letscook handoff (main checkout)",
			questions: [
				{
					id: "handoff_confirm",
					prompt: `Review the startup brief and choose how to proceed.\n\n${brief}`,
					options: [
						{ id: "start_on_main", label: "Start on this checkout (main)" },
						{ id: "defer_worktree", label: "Create worktree first (cancel and use /worktree)" },
						{ id: "cancel", label: "Cancel handoff" },
						{ id: "edit", label: "Edit handoff or plan first" },
					],
				},
			],
		};
	}
	return {
		title: "Confirm letscook handoff",
		questions: [
			{
				id: "handoff_confirm",
				prompt: `Review the startup brief and choose how to proceed.\n\n${brief}`,
				options: [
					{ id: "start", label: "Start cook workflow (Recommended)" },
					{ id: "cancel", label: "Cancel handoff" },
					{ id: "edit", label: "Edit handoff or plan first" },
				],
			},
		],
	};
}

export function buildHandoffElicitationParams(
	layout: JsonRecord,
	options?: HandoffConfirmationOptions,
): ElicitRequestFormParams {
	if (options?.isolationConfirmRequired) {
		return {
			mode: "form",
			message: `Review the letscook startup brief:\n\n${formatConfirmationBrief(layout, options)}\n\nChoose an action below.`,
			requestedSchema: {
				type: "object",
				properties: {
					action: {
						type: "string",
						title: "Handoff decision",
						description:
							"Start on main checkout, defer to a worktree, cancel, or go back to edit.",
						enum: ["start_on_main", "defer_worktree", "cancel", "edit"],
						enumNames: [
							"Start on this checkout (main)",
							"Create worktree first",
							"Cancel handoff",
							"Edit handoff or plan first",
						],
						default: "defer_worktree",
					},
				},
				required: ["action"],
			},
		};
	}
	return {
		mode: "form",
		message: `Review the letscook startup brief:\n\n${formatConfirmationBrief(layout, options)}\n\nChoose an action below.`,
		requestedSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					title: "Handoff decision",
					description: "Start the six-role completion workflow, cancel, or go back to edit.",
					enum: ["start", "cancel", "edit"],
					enumNames: ["Start cook workflow", "Cancel handoff", "Edit handoff or plan first"],
					default: "start",
				},
			},
			required: ["action"],
		},
	};
}

export async function readPendingHandoff(workspaceRoot: string): Promise<PendingHandoff | undefined> {
	const resolvedRoot = path.resolve(workspaceRoot);
	const sidecar = await readCookHandoffSidecar(resolvedRoot);
	if (!sidecar) return undefined;
	const handoffRaw = await fsp.readFile(path.join(resolvedRoot, ".agent/tmp/cursor-handoff.json"), "utf8");
	const capsule = normalizeCookHandoffCapsule(JSON.parse(handoffRaw) as Record<string, unknown>);
	const workspaceContext = getCookWorkspaceContext({ workspaceRoot: resolvedRoot });
	const layout = buildConfirmationPreview(capsule);
	if (workspaceContext.isolation_confirm_required) {
		layout.isolation_section = buildIsolationConfirmationSection(workspaceContext);
	}
	return {
		workspaceRoot: resolvedRoot,
		sidecar,
		capsule,
		layout,
		workspaceContext,
	};
}

function clientSupportsFormElicitation(ctx: LetscookToolContext): boolean {
	return Boolean(ctx.getClientCapabilities?.()?.elicitation?.form && ctx.elicitInput);
}

type ConfirmationAction = "start" | "cancel" | "edit" | "defer_worktree";

function readElicitationAction(
	content: unknown,
	options?: { isolationConfirmRequired?: boolean },
): ConfirmationAction {
	const action = asString((content as JsonRecord | undefined)?.action)?.toLowerCase();
	if (action === "start_on_main") return "start";
	if (action === "defer_worktree") return "defer_worktree";
	if (action === "cancel" || action === "edit") return action;
	if (action === "start") return "start";
	return options?.isolationConfirmRequired ? "defer_worktree" : "start";
}

function confirmationOptionsFor(pending: PendingHandoff): HandoffConfirmationOptions {
	return { isolationConfirmRequired: pending.workspaceContext.isolation_confirm_required };
}

function buildAskQuestionFallback(pending: PendingHandoff): JsonRecord {
	const options = confirmationOptionsFor(pending);
	return {
		ok: true,
		elicitation_unavailable: true,
		user_action_required: "ask_question",
		workspace_root: pending.workspaceRoot,
		confirmation_id: pending.sidecar.confirmation_id,
		isolation_confirm_required: options.isolationConfirmRequired,
		confirmation_brief: formatConfirmationBrief(pending.layout, options),
		layout: pending.layout,
		ask_question: buildAskQuestionHandoffPayload(pending.layout, options),
		next_steps: options.isolationConfirmRequired
			? [
					"Call AskQuestion with ask_question payload",
					"On start_on_main: confirm_cook_handoff({ workspace_root, skip_elicitation: true, confirmation_action: 'start' })",
					"Then start_cook_workflow({ workspace_root, confirmation_id, action: 'start', isolation_choice: 'main_checkout_acknowledged' })",
					"On defer_worktree: confirm_cook_handoff({ workspace_root, skip_elicitation: true, confirmation_action: 'defer_worktree' })",
					"On cancel: start_cook_workflow({ workspace_root, action: 'cancel' })",
					"On edit: revise capsule/plan and call prepare_cook_handoff again",
				]
			: [
					"Call AskQuestion with ask_question payload",
					"On start: confirm_cook_handoff({ workspace_root, skip_elicitation: true, confirmation_action: 'start' })",
					"Then start_cook_workflow({ workspace_root, confirmation_id, action: 'start' })",
					"On cancel: start_cook_workflow({ workspace_root, action: 'cancel' })",
					"On edit: revise capsule/plan and call prepare_cook_handoff again",
				],
	};
}

async function handleConfirmationAction(
	pending: PendingHandoff,
	action: ConfirmationAction,
	confirmationMethod: "mcp_elicitation" | "ask_question",
	options?: { deferStart?: boolean },
): Promise<JsonRecord> {
	if (action === "defer_worktree") {
		await cancelPendingHandoff(pending.workspaceRoot);
		return {
			ok: true,
			confirmed: false,
			action: "defer_worktree",
			confirmation_method: confirmationMethod,
			user_action_required: "run_worktree_first",
			workspace_root: pending.workspaceRoot,
			confirmation_id: pending.sidecar.confirmation_id,
			layout: pending.layout,
			next_steps: [...DEFER_WORKTREE_NEXT_STEPS],
		};
	}
	if (action === "cancel") {
		await cancelPendingHandoff(pending.workspaceRoot);
		return {
			ok: true,
			confirmed: false,
			action: "cancel",
			confirmation_method: confirmationMethod,
			workspace_root: pending.workspaceRoot,
			confirmation_id: pending.sidecar.confirmation_id,
			layout: pending.layout,
		};
	}
	if (action === "edit") {
		return {
			ok: true,
			confirmed: false,
			action: "edit",
			confirmation_method: confirmationMethod,
			user_action_required: "revise_handoff",
			workspace_root: pending.workspaceRoot,
			confirmation_id: pending.sidecar.confirmation_id,
			layout: pending.layout,
			next_steps: [
				"Revise the plan or cook_handoff capsule with the user",
				"Call prepare_cook_handoff again, then confirm_cook_handoff",
			],
		};
	}
	if (action === "start" && !pending.workspaceContext.ready_for_cook) {
		return {
			ok: false,
			error: "workspace is not ready for cook",
			code: "workspace_not_ready",
			workspace_root: pending.workspaceRoot,
			confirmation_id: pending.sidecar.confirmation_id,
			next_steps: pending.workspaceContext.next_steps,
		};
	}

	const existingWorkflow = await loadWorkflowSnapshot(pending.workspaceRoot);
	if (action === "start" && existingWorkflow && isWorkflowParked(existingWorkflow)) {
		if (options?.deferStart) {
			return {
				ok: true,
				confirmed: false,
				workflow_parked: true,
				action: pending.workspaceContext.isolation_confirm_required ? "start_on_main" : "start",
				confirmation_method: confirmationMethod,
				workspace_root: pending.workspaceRoot,
				confirmation_id: pending.sidecar.confirmation_id,
				layout: pending.layout,
				next_steps: [
					"Workflow is parked; call resume_workflow to continue the existing workflow, or cancel_workflow before preparing a new cook",
				],
			};
		}
		return {
			ok: false,
			error: "workflow is parked",
			code: "workflow_parked",
			workspace_root: pending.workspaceRoot,
			confirmation_id: pending.sidecar.confirmation_id,
			next_steps: [
				"Resume with resume_workflow to continue the parked workflow",
				"Or cancel_workflow before confirming a new cook start",
			],
		};
	}

	const isolationChoice = pending.workspaceContext.isolation_confirm_required
		? "main_checkout_acknowledged"
		: undefined;
	if (pending.sidecar.status === "kickoff_started" || (await loadWorkflowSnapshot(pending.workspaceRoot))) {
		const activeWorkflow = await loadWorkflowSnapshot(pending.workspaceRoot);
		if (activeWorkflow && isWorkflowActivelyRunning(activeWorkflow)) {
			if (options?.deferStart) {
				return {
					ok: true,
					confirmed: false,
					workflow_already_active: true,
					action: pending.workspaceContext.isolation_confirm_required ? "start_on_main" : "start",
					confirmation_method: confirmationMethod,
					workspace_root: pending.workspaceRoot,
					confirmation_id: pending.sidecar.confirmation_id,
					layout: pending.layout,
					next_steps: [
						"Workflow already active; continue with get_workflow_dispatch → claim_workflow_dispatch → submit_role_result",
					],
				};
			}
			return {
				ok: false,
				error: "workflow already active",
				code: "workflow_active",
				workspace_root: pending.workspaceRoot,
				confirmation_id: pending.sidecar.confirmation_id,
			};
		}
	}
	await markHandoffConfirmed(pending.workspaceRoot, pending.sidecar.confirmation_id);
	if (options?.deferStart) {
		return {
			ok: true,
			confirmed: true,
			action: pending.workspaceContext.isolation_confirm_required ? "start_on_main" : "start",
			confirmation_method: confirmationMethod,
			workspace_root: pending.workspaceRoot,
			confirmation_id: pending.sidecar.confirmation_id,
			layout: pending.layout,
			next_steps: pending.workspaceContext.isolation_confirm_required
				? [
						"start_cook_workflow({ workspace_root, confirmation_id, action: 'start', isolation_choice: 'main_checkout_acknowledged' })",
					]
				: ["start_cook_workflow({ workspace_root, confirmation_id, action: 'start' })"],
		};
	}
	const started = await startCookWorkflowFromHandoff(
		pending.workspaceRoot,
		pending.sidecar.confirmation_id,
		{ isolationChoice },
	);
	return {
		ok: true,
		confirmed: true,
		action: pending.workspaceContext.isolation_confirm_required ? "start_on_main" : "start",
		confirmation_method: confirmationMethod,
		...started,
	};
}

export async function confirmCookHandoff(
	workspaceRoot: string,
	ctx: LetscookToolContext,
	options?: {
		skip_elicitation?: boolean;
		confirmation_action?: ConfirmationAction | "start_on_main";
	},
): Promise<JsonRecord> {
	const pending = await readPendingHandoff(workspaceRoot);
	if (!pending) {
		return { ok: false, error: "no pending handoff", code: "no_pending_handoff" };
	}

	const confirmOptions = confirmationOptionsFor(pending);

	if (options?.confirmation_action) {
		const action: ConfirmationAction =
			options.confirmation_action === "start_on_main" ? "start" : options.confirmation_action;
		return handleConfirmationAction(pending, action, "ask_question", { deferStart: true });
	}

	if (!options?.skip_elicitation && clientSupportsFormElicitation(ctx) && ctx.elicitInput) {
		try {
			const result = await ctx.elicitInput(buildHandoffElicitationParams(pending.layout, confirmOptions));
			if (result.action === "cancel" || result.action === "decline") {
				return handleConfirmationAction(pending, "cancel", "mcp_elicitation");
			}
			if (result.action === "accept") {
				return handleConfirmationAction(
					pending,
					readElicitationAction(result.content, confirmOptions),
					"mcp_elicitation",
				);
			}
			return buildAskQuestionFallback(pending);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const shouldFallback =
				message.includes("does not support form elicitation") ||
				message.includes("Request timed out") ||
				message.includes("timed out");
			if (!shouldFallback) throw error;
		}
	}

	return buildAskQuestionFallback(pending);
}

export { cancelCookHandoff };
