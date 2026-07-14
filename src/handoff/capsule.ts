import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import {
	asString,
	asStringArray,
	isRecord,
	resolveAgentPaths,
	sha256Hex,
	writeJsonFile,
} from "../control-plane/state.ts";
import type { CookHandoffCapsule, CookHandoffSidecar, JsonRecord } from "../types.ts";

export const COOK_HANDOFF_SCHEMA_EXAMPLE: CookHandoffCapsule = {
	kind: "cook_handoff",
	source: "primary_agent",
	captured_at: new Date().toISOString(),
	source_turn_id: "cursor-handoff",
	mission: "Implement the agreed feature with tests",
	scope: ["src/feature/", "tests/"],
	constraints: ["Keep changes minimal"],
	non_goals: ["Unrelated refactors"],
	acceptance: ["Tests pass", "Behavior matches mission"],
	risks: ["Edge cases in error handling"],
	notes: [],
	handoff_kind: "implementation_workflow_handoff",
	task_type: "completion-workflow",
	evaluation_profile: "completion-rubric-v1",
	why_cook_now: "Multi-step implementation with review rounds",
};

export function normalizeCookHandoffCapsule(input: Record<string, unknown>): JsonRecord {
	const capsule = isRecord(input.capsule) ? input.capsule : input;
	return {
		kind: "cook_handoff",
		source: asString(capsule.source) ?? "primary_agent",
		captured_at: asString(capsule.captured_at) ?? new Date().toISOString(),
		source_turn_id: asString(capsule.source_turn_id) ?? "cursor-handoff",
		mission: asString(capsule.mission) ?? "",
		scope: asStringArray(capsule.scope),
		constraints: asStringArray(capsule.constraints),
		non_goals: asStringArray(capsule.non_goals),
		acceptance: asStringArray(capsule.acceptance),
		risks: asStringArray(capsule.risks),
		notes: asStringArray(capsule.notes),
		handoff_kind: asString(capsule.handoff_kind) ?? "implementation_workflow_handoff",
		task_type: asString(capsule.task_type) ?? "completion-workflow",
		evaluation_profile: asString(capsule.evaluation_profile) ?? "completion-rubric-v1",
		why_cook_now: asString(capsule.why_cook_now),
	};
}

export function validateCookHandoffSchema(capsule: JsonRecord): { ok: true } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	if (capsule.kind !== "cook_handoff") errors.push("kind must be cook_handoff");
	if (!asString(capsule.mission)) errors.push("mission is required");
	if (asStringArray(capsule.scope).length === 0) errors.push("scope must be non-empty");
	if (asStringArray(capsule.acceptance).length === 0) errors.push("acceptance must be non-empty");
	if ((asString(capsule.handoff_kind) ?? "") !== "implementation_workflow_handoff") {
		errors.push("handoff_kind must be implementation_workflow_handoff");
	}
	return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function assessCookHandoffStartability(capsule: JsonRecord): { startable: boolean; errors: string[] } {
	const schema = validateCookHandoffSchema(capsule);
	if (!schema.ok) return { startable: false, errors: schema.errors };
	const mission = asString(capsule.mission) ?? "";
	if (mission.length < 8) return { startable: false, errors: ["mission is too short to be startable"] };
	return { startable: true, errors: [] };
}

export async function writeCookHandoffFile(
	root: string,
	capsule: JsonRecord,
	meta: { workspace_root: string; branch?: string },
): Promise<{ handoffPath: string; confirmationId: string; handoffSha256: string }> {
	const files = resolveAgentPaths(root);
	const handoffText = `${JSON.stringify(capsule, null, 2)}\n`;
	const handoffSha256 = sha256Hex(handoffText);
	const confirmationId = randomUUID();
	await fsp.mkdir(files.tmpDir, { recursive: true });
	await fsp.writeFile(files.handoffPath, handoffText, "utf8");
	const sidecar: CookHandoffSidecar = {
		workspace_root: meta.workspace_root,
		branch: meta.branch,
		path: path.relative(root, files.handoffPath) || "cursor-handoff.json",
		prepared_at: new Date().toISOString(),
		confirmation_id: confirmationId,
		handoff_sha256: handoffSha256,
		status: "pending_review",
		source: "letscook-mcp",
		mission_preview: asString(capsule.mission),
	};
	await writeJsonFile(files.pendingSidecarPath, sidecar);
	return { handoffPath: files.handoffPath, confirmationId, handoffSha256 };
}

export async function readCookHandoffSidecar(root: string): Promise<CookHandoffSidecar | undefined> {
	const files = resolveAgentPaths(root);
	try {
		const raw = await fsp.readFile(files.pendingSidecarPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed)) return undefined;
		const confirmationId = asString(parsed.confirmation_id);
		const handoffSha256 = asString(parsed.handoff_sha256);
		const workspaceRoot = asString(parsed.workspace_root);
		if (!confirmationId || !handoffSha256 || !workspaceRoot) return undefined;
		const status = asString(parsed.status);
		return {
			workspace_root: workspaceRoot,
			branch: asString(parsed.branch),
			path: asString(parsed.path) ?? "cursor-handoff.json",
			prepared_at: asString(parsed.prepared_at) ?? new Date().toISOString(),
			confirmation_id: confirmationId,
			handoff_sha256: handoffSha256,
			status: status === "confirmed" || status === "kickoff_started" ? status : "pending_review",
			source: asString(parsed.source) ?? "letscook-mcp",
			mission_preview: asString(parsed.mission_preview),
			confirmed_at: asString(parsed.confirmed_at),
		};
	} catch {
		return undefined;
	}
}

export async function markHandoffConfirmed(root: string, confirmationId: string): Promise<CookHandoffSidecar> {
	const sidecar = await readCookHandoffSidecar(root);
	if (!sidecar) throw new Error("no pending handoff sidecar");
	if (sidecar.confirmation_id !== confirmationId) throw new Error("confirmation_id mismatch");
	const next: CookHandoffSidecar = {
		...sidecar,
		status: "confirmed",
		confirmed_at: new Date().toISOString(),
	};
	await writeJsonFile(resolveAgentPaths(root).pendingSidecarPath, next);
	return next;
}

export async function markHandoffKickoffStarted(root: string, confirmationId: string): Promise<void> {
	const sidecar = await readCookHandoffSidecar(root);
	if (!sidecar) return;
	if (sidecar.confirmation_id !== confirmationId) return;
	await writeJsonFile(resolveAgentPaths(root).pendingSidecarPath, {
		...sidecar,
		status: "kickoff_started",
	});
}

export async function cancelPendingHandoff(root: string): Promise<void> {
	const files = resolveAgentPaths(root);
	await fsp.rm(files.pendingSidecarPath, { force: true });
}

export function buildConfirmationPreview(capsule: JsonRecord): JsonRecord {
	return {
		mission: asString(capsule.mission),
		scope: asStringArray(capsule.scope),
		constraints: asStringArray(capsule.constraints),
		acceptance: asStringArray(capsule.acceptance),
		risks: asStringArray(capsule.risks),
		why_cook_now: asString(capsule.why_cook_now),
		task_type: asString(capsule.task_type),
		evaluation_profile: asString(capsule.evaluation_profile),
	};
}

export function resolveWorkspaceRoot(args: {
	workspaceRoot?: string;
	requireExplicit?: boolean;
}): string {
	const fromArg = asString(args.workspaceRoot);
	if (fromArg) return path.resolve(fromArg);
	const fromEnv = asString(process.env.WORKSPACE_ROOT);
	if (fromEnv) return path.resolve(fromEnv);
	if (args.requireExplicit) throw new Error("workspace_root is required");
	return path.resolve(process.cwd());
}
