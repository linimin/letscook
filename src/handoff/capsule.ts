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
import {
	analysisFromCapsule,
	buildHandoffConfirmationLayout,
	formatConfirmationLayoutText,
	proposalFromCapsule,
} from "./confirmation-layout.ts";
import type { ContextProposal } from "./synthesis/proposal.ts";
import { createProposalDeps, extractCookHandoffProposalFromText } from "./synthesis/proposal-deps.ts";
import {
	COMPLETION_COOK_HANDOFF_CONTRACT_ID,
	getStructuredContract,
} from "./structured-contracts.ts";
import type { CookHandoffCapsule, CookHandoffSidecar, JsonRecord } from "../types.ts";

export const COOK_HANDOFF_MAX_AGE_MS = 45 * 60 * 1000;
export const COOK_HANDOFF_PENDING_SIDECAR_PATH = ".agent/tmp/cursor-handoff.pending.json";

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

function localAsBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized === "true") return true;
	if (normalized === "false") return false;
	return undefined;
}

export function cookHandoffBlockFromJsonText(jsonText: string): string {
	return `\`\`\`cook_handoff\n${jsonText}\n\`\`\``;
}

export function isTimestampFreshEnough(isoTimestamp: string | undefined, nowMs = Date.now()): boolean {
	if (!isoTimestamp) return false;
	const parsed = Date.parse(isoTimestamp);
	if (!Number.isFinite(parsed)) return false;
	return nowMs - parsed <= COOK_HANDOFF_MAX_AGE_MS;
}

export function isPendingHandoffFresh(args: {
	preparedAt?: string;
	capturedAt?: string;
	nowMs?: number;
}): boolean {
	const nowMs = args.nowMs ?? Date.now();
	if (args.preparedAt && isTimestampFreshEnough(args.preparedAt, nowMs)) return true;
	if (args.capturedAt && isTimestampFreshEnough(args.capturedAt, nowMs)) return true;
	return false;
}

export function normalizeCookHandoffCapsule(
	input: Record<string, unknown>,
	meta?: { sourceTurnId?: string; capturedAt?: string },
): JsonRecord {
	const capsule = isRecord(input.capsule) ? input.capsule : input;
	const mission = asString(capsule.mission);
	return {
		kind: "cook_handoff",
		source: asString(capsule.source) ?? "primary_agent",
		captured_at: asString(capsule.captured_at) ?? meta?.capturedAt ?? new Date().toISOString(),
		source_turn_id: asString(capsule.source_turn_id) ?? meta?.sourceTurnId ?? "cursor-handoff",
		mission: mission ?? "",
		scope: asStringArray(capsule.scope),
		constraints: asStringArray(capsule.constraints),
		non_goals: asStringArray(capsule.non_goals ?? capsule.nonGoals),
		acceptance: asStringArray(capsule.acceptance),
		risks: asStringArray(capsule.risks),
		notes: asStringArray(capsule.notes),
		handoff_kind: asString(capsule.handoff_kind ?? capsule.handoffKind) ?? "implementation_workflow_handoff",
		first_slice_goal: asString(capsule.first_slice_goal ?? capsule.firstSliceGoal),
		first_slice_non_goals: asStringArray(capsule.first_slice_non_goals ?? capsule.firstSliceNonGoals),
		implementation_surfaces: asStringArray(capsule.implementation_surfaces ?? capsule.implementationSurfaces),
		verification_commands: asStringArray(capsule.verification_commands ?? capsule.verificationCommands),
		why_this_slice_first: asString(capsule.why_this_slice_first ?? capsule.whyThisSliceFirst),
		verification_truth_mode: asString(capsule.verification_truth_mode ?? capsule.verificationTruthMode),
		deterministic_verifier_ready: localAsBoolean(
			capsule.deterministic_verifier_ready ?? capsule.deterministicVerifierReady,
		),
		verification_latency: asString(capsule.verification_latency ?? capsule.verificationLatency),
		verification_noise_risk: asString(capsule.verification_noise_risk ?? capsule.verificationNoiseRisk),
		verifier_gap: asString(capsule.verifier_gap ?? capsule.verifierGap),
		recommended_first_slice_kind: asString(
			capsule.recommended_first_slice_kind ?? capsule.recommendedFirstSliceKind,
		),
		task_type: asString(capsule.task_type) ?? "completion-workflow",
		evaluation_profile: asString(capsule.evaluation_profile) ?? "completion-rubric-v1",
		why_cook_now: asString(capsule.why_cook_now),
		reason: asString(capsule.reason),
	};
}

export function validateCookHandoffSchema(capsule: JsonRecord): { ok: true } | { ok: false; errors: string[] } {
	const contract = getStructuredContract(COMPLETION_COOK_HANDOFF_CONTRACT_ID);
	if (!contract?.parseDetails) {
		return { ok: false, errors: ["cook handoff structured contract is unavailable"] };
	}
	const parsed = contract.parseDetails({ capsule });
	if (!parsed.ok) return parsed;
	const handoffKind = asString(capsule.handoff_kind);
	if (handoffKind === "unable_to_prepare") return { ok: true };
	if (!asString(capsule.mission)) return { ok: false, errors: ["mission is required"] };
	if (asStringArray(capsule.scope).length === 0) return { ok: false, errors: ["scope must be non-empty"] };
	if (asStringArray(capsule.acceptance).length === 0) {
		return { ok: false, errors: ["acceptance must be non-empty"] };
	}
	return { ok: true };
}

export function assessCookHandoffStartability(
	capsule: JsonRecord,
	projectName = "project",
): { startable: boolean; proposal?: ContextProposal; errors: string[]; warnings: string[] } {
	const schema = validateCookHandoffSchema(capsule);
	if (!schema.ok) return { startable: false, errors: schema.errors, warnings: [] };
	const handoffKind = asString(capsule.handoff_kind);
	if (handoffKind === "unable_to_prepare") {
		return {
			startable: false,
			errors: [asString(capsule.reason) ?? "handoff marked unable_to_prepare"],
			warnings: [],
		};
	}
	const deps = createProposalDeps();
	const block = cookHandoffBlockFromJsonText(JSON.stringify(capsule, null, 2));
	const proposal = extractCookHandoffProposalFromText(block, projectName, deps, {
		messageId: asString(capsule.source_turn_id) ?? "cursor-handoff",
		timestampMs: Date.parse(asString(capsule.captured_at) ?? "") || Date.now(),
		source: "handoff_capsule",
	});
	if (!proposal) {
		return {
			startable: false,
			errors: ["cook handoff capsule is present but not startable after full proposal assessment"],
			warnings: [],
		};
	}
	return { startable: true, proposal, errors: [], warnings: [] };
}

export async function assertHandoffMatchesSidecar(root: string, sidecar: CookHandoffSidecar): Promise<void> {
	if (!sidecar.handoff_sha256) throw new Error("handoff integrity hash missing from sidecar");
	const handoffPath = path.resolve(root, sidecar.path);
	const raw = await fsp.readFile(handoffPath, "utf8");
	const currentHash = sha256Hex(raw);
	if (currentHash !== sidecar.handoff_sha256) {
		throw new Error("handoff content changed since prepare; rerun prepare_cook_handoff");
	}
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

function parseSidecarStatus(status: string | undefined): CookHandoffSidecar["status"] {
	if (
		status === "confirmed" ||
		status === "awaiting_terminal_launch" ||
		status === "kickoff_started" ||
		status === "pending_review"
	) {
		return status;
	}
	return "pending_review";
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
		return {
			workspace_root: workspaceRoot,
			branch: asString(parsed.branch),
			path: asString(parsed.path) ?? "cursor-handoff.json",
			prepared_at: asString(parsed.prepared_at) ?? new Date().toISOString(),
			confirmation_id: confirmationId,
			handoff_sha256: handoffSha256,
			status: parseSidecarStatus(asString(parsed.status)),
			source: asString(parsed.source) ?? "letscook-mcp",
			mission_preview: asString(parsed.mission_preview),
			confirmed_at: asString(parsed.confirmed_at),
			confirmed_by: asString(parsed.confirmed_by),
			last_start_error: asString(parsed.last_start_error ?? parsed.last_spawn_error),
		};
	} catch {
		return undefined;
	}
}

export async function markHandoffConfirmed(
	root: string,
	confirmationId: string,
	confirmedBy?: string,
): Promise<CookHandoffSidecar> {
	const sidecar = await readCookHandoffSidecar(root);
	if (!sidecar) throw new Error("no pending handoff sidecar");
	if (sidecar.confirmation_id !== confirmationId) throw new Error("confirmation_id mismatch");
	const next: CookHandoffSidecar = {
		...sidecar,
		status: "confirmed",
		confirmed_at: new Date().toISOString(),
		confirmed_by: confirmedBy ?? "letscook-mcp",
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
	const proposal = proposalFromCapsule(capsule);
	const analysis = analysisFromCapsule(capsule, proposal);
	const layout = buildHandoffConfirmationLayout({ proposal, analysis });
	return {
		layout,
		layout_text: formatConfirmationLayoutText(layout),
		mission: asString(capsule.mission),
		scope: asStringArray(capsule.scope),
		constraints: asStringArray(capsule.constraints),
		acceptance: asStringArray(capsule.acceptance),
		risks: asStringArray(capsule.risks),
		why_cook_now: asString(capsule.why_cook_now),
		task_type: asString(capsule.task_type),
		evaluation_profile: asString(capsule.evaluation_profile),
		first_slice_goal: asString(capsule.first_slice_goal),
		implementation_surfaces: asStringArray(capsule.implementation_surfaces),
		verification_commands: asStringArray(capsule.verification_commands),
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
