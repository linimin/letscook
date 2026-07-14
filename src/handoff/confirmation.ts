import { promises as fsp } from "node:fs";
import * as path from "node:path";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import { asString, asStringArray } from "../control-plane/state.ts";
import type { LetscookToolContext } from "../tools/context.ts";
import type { CookHandoffSidecar, JsonRecord } from "../types.ts";
import {
	buildConfirmationPreview,
	cancelPendingHandoff,
	normalizeCookHandoffCapsule,
	readCookHandoffSidecar,
} from "./capsule.ts";
import { cancelCookHandoff, startCookWorkflowFromHandoff } from "./start-workflow.ts";

export type PendingHandoff = {
	workspaceRoot: string;
	sidecar: CookHandoffSidecar;
	capsule: JsonRecord;
	layout: JsonRecord;
};

export type AskQuestionHandoffPayload = {
	title: string;
	questions: Array<{
		id: string;
		prompt: string;
		options: Array<{ id: string; label: string }>;
	}>;
};

function bulletLines(items: string[]): string {
	return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- (none)";
}

export function formatConfirmationBrief(layout: JsonRecord): string {
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
	return lines.join("\n");
}

export function buildAskQuestionHandoffPayload(layout: JsonRecord): AskQuestionHandoffPayload {
	const brief = formatConfirmationBrief(layout);
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

export function buildHandoffElicitationParams(layout: JsonRecord): ElicitRequestFormParams {
	return {
		mode: "form",
		message: `Review the letscook startup brief:\n\n${formatConfirmationBrief(layout)}\n\nChoose an action below.`,
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
	return {
		workspaceRoot: resolvedRoot,
		sidecar,
		capsule,
		layout: buildConfirmationPreview(capsule),
	};
}

function clientSupportsFormElicitation(ctx: LetscookToolContext): boolean {
	return Boolean(ctx.getClientCapabilities?.()?.elicitation?.form && ctx.elicitInput);
}

function readElicitationAction(content: unknown): "start" | "cancel" | "edit" {
	const action = asString((content as JsonRecord | undefined)?.action)?.toLowerCase();
	if (action === "cancel" || action === "edit") return action;
	return "start";
}

function buildAskQuestionFallback(pending: PendingHandoff): JsonRecord {
	return {
		ok: true,
		elicitation_unavailable: true,
		user_action_required: "ask_question",
		workspace_root: pending.workspaceRoot,
		confirmation_id: pending.sidecar.confirmation_id,
		confirmation_brief: formatConfirmationBrief(pending.layout),
		layout: pending.layout,
		ask_question: buildAskQuestionHandoffPayload(pending.layout),
		next_steps: [
			"Call AskQuestion with ask_question payload",
			"On start: start_cook_workflow({ workspace_root, confirmation_id, action: 'start' })",
			"On cancel: start_cook_workflow({ workspace_root, action: 'cancel' })",
			"On edit: revise capsule/plan and call prepare_cook_handoff again",
		],
	};
}

async function handleConfirmationAction(
	pending: PendingHandoff,
	action: "start" | "cancel" | "edit",
	confirmationMethod: "mcp_elicitation" | "ask_question",
): Promise<JsonRecord> {
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

	const started = await startCookWorkflowFromHandoff(pending.workspaceRoot, pending.sidecar.confirmation_id);
	return {
		ok: true,
		confirmed: true,
		action: "start",
		confirmation_method: confirmationMethod,
		...started,
	};
}

export async function confirmCookHandoff(
	workspaceRoot: string,
	ctx: LetscookToolContext,
	options?: { skip_elicitation?: boolean },
): Promise<JsonRecord> {
	const pending = await readPendingHandoff(workspaceRoot);
	if (!pending) {
		return { ok: false, error: "no pending handoff", code: "no_pending_handoff" };
	}

	if (!options?.skip_elicitation && clientSupportsFormElicitation(ctx) && ctx.elicitInput) {
		try {
			const result = await ctx.elicitInput(buildHandoffElicitationParams(pending.layout));
			if (result.action === "cancel" || result.action === "decline") {
				return handleConfirmationAction(pending, "cancel", "mcp_elicitation");
			}
			if (result.action === "accept") {
				return handleConfirmationAction(
					pending,
					readElicitationAction(result.content),
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
