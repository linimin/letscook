import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	assessCookHandoffStartability,
	normalizeCookHandoffCapsule,
	validateCookHandoffSchema,
} from "./capsule.ts";
import type { JsonRecord } from "../types.ts";

export type CursorPlanTodo = {
	id: string;
	content: string;
	status: string;
};

export type ParsedCursorPlan = {
	path: string;
	name: string;
	overview: string;
	todos: CursorPlanTodo[];
	body: string;
	isProject: boolean;
};

export type CursorPlanSummary = {
	path: string;
	name: string;
	overview: string;
	modified_at: string;
	todo_total: number;
	todo_pending: number;
	is_project: boolean;
};

export type RankedCursorPlan = CursorPlanSummary & {
	score: number;
	match_reasons: string[];
};

export type PlanResolutionMethod =
	| "explicit_path"
	| "open_plan_path"
	| "plan_hint"
	| "single_plan"
	| "needs_disambiguation";

export type PlanResolution =
	| {
			status: "resolved";
			path: string;
			method: Exclude<PlanResolutionMethod, "needs_disambiguation">;
			plan_hint_used?: string;
			match_reasons?: string[];
			score?: number;
	  }
	| {
			status: "needs_disambiguation";
			method: "needs_disambiguation";
			plan_hint_used?: string;
			candidates: RankedCursorPlan[];
			message: string;
	  };

const PATH_PATTERN =
	/(?:^|[\s(])([`']?)([\w@./-]+(?:\*\*?\/[\w@./*-]+)?[\w@./-]*)\1(?:[\s),.:;]|$)/g;

const SECTION_HEADING =
	/^(?:#{1,3}\s*)?(scope|files(?:\s+to\s+change)?|acceptance|verification|test(?:\s+plan)?|constraints|non-?goals?|risks?|out\s+of\s+scope)\s*:?\s*$/i;

function slugifyPlanName(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug || "plan";
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } | null {
	const trimmed = raw.replace(/^\uFEFF/, "");
	if (!trimmed.startsWith("---")) return null;
	const end = trimmed.indexOf("\n---", 3);
	if (end === -1) return null;
	return {
		frontmatter: trimmed.slice(3, end).trim(),
		body: trimmed.slice(end + 4).replace(/^\r?\n/, ""),
	};
}

function parseScalarField(frontmatter: string, key: string): string | undefined {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "im"));
	if (!match) return undefined;
	let value = match[1].trim();
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		value = value.slice(1, -1);
	}
	return value;
}

function parseBooleanField(frontmatter: string, key: string): boolean {
	const value = parseScalarField(frontmatter, key);
	return value?.toLowerCase() === "true";
}

function parseTodos(frontmatter: string): CursorPlanTodo[] {
	const todos: CursorPlanTodo[] = [];
	const blocks = frontmatter.split(/\n\s*-\s+id:\s*/i).slice(1);
	for (const block of blocks) {
		const id = block.match(/^([^\n]+)/)?.[1]?.trim() ?? "";
		const content =
			block.match(/^\s*content:\s*(.+)$/im)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
		const status = block.match(/^\s*status:\s*(\S+)/im)?.[1]?.trim() ?? "pending";
		if (id && content) todos.push({ id, content, status });
	}
	return todos;
}

function stripInlineMarkdown(value: string): string {
	return value.replace(/^[`']|[`']$/g, "").trim();
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.map((value) => stripInlineMarkdown(value.trim())).filter(Boolean))];
}

function extractPathsFromText(text: string): string[] {
	const paths: string[] = [];
	for (const match of text.matchAll(PATH_PATTERN)) {
		const candidate = match[2];
		if (!candidate.includes("/") && !candidate.includes("*")) continue;
		if (candidate.startsWith("http://") || candidate.startsWith("https://")) continue;
		paths.push(candidate);
	}
	return uniqueStrings(paths);
}

function extractSectionBullets(body: string, labels: string[]): string[] {
	const lines = body.split(/\r?\n/);
	const bullets: string[] = [];
	let inSection = false;

	for (const line of lines) {
		const heading = line.match(SECTION_HEADING);
		if (heading) {
			inSection = labels.some((label) => heading[1].toLowerCase().includes(label.toLowerCase()));
			continue;
		}
		if (/^#{1,3}\s+/.test(line) && !SECTION_HEADING.test(line)) {
			if (inSection) break;
			continue;
		}
		if (!inSection) continue;
		const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
		if (bullet) bullets.push(stripInlineMarkdown(bullet[1].trim()));
	}

	return uniqueStrings(bullets);
}

function firstParagraph(body: string): string {
	const paragraph = body
		.split(/\n\s*\n/)
		.map((chunk) => chunk.trim())
		.find((chunk) => chunk && !chunk.startsWith("#"));
	return paragraph ?? "";
}

export function parseCursorPlanFile(raw: string, planPath: string): ParsedCursorPlan {
	const split = splitFrontmatter(raw);
	if (!split) {
		throw new Error(`plan file is missing YAML frontmatter: ${planPath}`);
	}
	const name = parseScalarField(split.frontmatter, "name") ?? path.basename(planPath, ".plan.md");
	const overview = parseScalarField(split.frontmatter, "overview") ?? "";
	const todos = parseTodos(split.frontmatter);
	return {
		path: planPath,
		name,
		overview,
		todos,
		body: split.body.trim(),
		isProject: parseBooleanField(split.frontmatter, "isProject"),
	};
}

export function planToCookHandoffDraft(
	plan: ParsedCursorPlan,
	overrides: Record<string, unknown> = {},
): { capsule: JsonRecord; mapping_notes: string[]; gaps: string[] } {
	const mapping_notes: string[] = [];
	const pendingTodos = plan.todos.filter((todo) => todo.status !== "completed");
	const todoAcceptance = pendingTodos.map((todo) => todo.content);
	const bodyScope = extractSectionBullets(plan.body, ["scope", "files"]);
	const bodyAcceptance = extractSectionBullets(plan.body, [
		"acceptance",
		"verification",
		"test",
	]);
	const bodyConstraints = extractSectionBullets(plan.body, ["constraints"]);
	const bodyNonGoals = extractSectionBullets(plan.body, ["non-goal", "out of scope"]);
	const bodyRisks = extractSectionBullets(plan.body, ["risk"]);
	const extractedPaths = uniqueStrings([
		...extractPathsFromText(plan.body),
		...extractPathsFromText(plan.todos.map((todo) => todo.content).join("\n")),
		...bodyScope,
	]);

	const mission =
		(typeof overrides.mission === "string" && overrides.mission) ||
		plan.overview ||
		firstParagraph(plan.body) ||
		plan.name;
	if (!plan.overview && !firstParagraph(plan.body)) {
		mapping_notes.push("mission derived from plan name; consider editing overview in the plan file");
	}

	const scope =
		(Array.isArray(overrides.scope) && overrides.scope.length > 0
			? overrides.scope.map(String)
			: extractedPaths.length > 0
				? extractedPaths
				: ["<repo>"]) ?? [];
	if (extractedPaths.length === 0) {
		mapping_notes.push("scope fallback to <repo>; add explicit paths in plan body or todos");
	}

	const acceptance =
		(Array.isArray(overrides.acceptance) && overrides.acceptance.length > 0
			? overrides.acceptance.map(String)
			: uniqueStrings([...bodyAcceptance, ...todoAcceptance])) ?? [];
	if (acceptance.length === 0) {
		mapping_notes.push("acceptance fallback to plan completion; add todos or an Acceptance section");
	}

	const constraints =
		(Array.isArray(overrides.constraints) && overrides.constraints.length > 0
			? overrides.constraints.map(String)
			: bodyConstraints) ?? [];
	const non_goals =
		(Array.isArray(overrides.non_goals) && overrides.non_goals.length > 0
			? overrides.non_goals.map(String)
			: bodyNonGoals) ?? [];
	const risks =
		(Array.isArray(overrides.risks) && overrides.risks.length > 0
			? overrides.risks.map(String)
			: bodyRisks) ?? [];

	const notes = uniqueStrings([
		`source_plan: ${plan.path}`,
		`plan_name: ${plan.name}`,
		plan.isProject ? "plan_scope: project" : "plan_scope: workspace",
		...pendingTodos.slice(0, 8).map((todo) => `todo[${todo.status}]: ${todo.content}`),
	]);

	const capsule = normalizeCookHandoffCapsule({
		kind: "cook_handoff",
		source: "primary_agent",
		captured_at: new Date().toISOString(),
		source_turn_id: path.basename(plan.path),
		mission,
		scope,
		constraints:
			constraints.length > 0
				? constraints
				: ["Follow the saved Cursor plan; keep diffs focused on listed scope"],
		non_goals: non_goals.length > 0 ? non_goals : ["Unrelated refactors outside the plan"],
		acceptance:
			acceptance.length > 0
				? acceptance
				: [`Plan "${plan.name}" implemented with verification steps from the plan body`],
		risks,
		notes,
		handoff_kind: "implementation_workflow_handoff",
		task_type: "completion-workflow",
		evaluation_profile: "completion-rubric-v1",
		why_cook_now:
			"Cursor Plan mode produced a reviewable plan; letscook runs it with review/audit/stop gates instead of one-shot Build.",
		first_slice_goal: pendingTodos[0]?.content ?? mission,
		first_slice_non_goals: non_goals.length > 0 ? non_goals : ["Unrelated refactors outside the plan"],
		implementation_surfaces: scope.length > 0 ? scope : ["<repo>"],
		verification_commands: ["npm test"],
		why_this_slice_first: pendingTodos[0]
			? `First pending plan todo: ${pendingTodos[0].content}`
			: "Establish plan-aligned foundation before broader slices",
		...overrides,
	});

	const gaps: string[] = [];
	const schema = validateCookHandoffSchema(capsule);
	if (!schema.ok) gaps.push(...schema.errors);
	const startability = assessCookHandoffStartability(capsule);
	if (!startability.startable) gaps.push(...startability.errors);

	return { capsule, mapping_notes, gaps };
}

export async function readCursorPlan(planPath: string): Promise<ParsedCursorPlan> {
	const raw = await fsp.readFile(planPath, "utf8");
	return parseCursorPlanFile(raw, path.resolve(planPath));
}

async function collectPlanFiles(dir: string): Promise<string[]> {
	try {
		const entries = await fsp.readdir(dir, { withFileTypes: true });
		const files: string[] = [];
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				files.push(...(await collectPlanFiles(fullPath)));
			} else if (entry.isFile() && entry.name.endsWith(".plan.md")) {
				files.push(fullPath);
			}
		}
		return files;
	} catch {
		return [];
	}
}

export async function listCursorPlans(args: {
	repoRoot?: string;
	includeGlobal?: boolean;
	planHint?: string;
}): Promise<RankedCursorPlan[] | CursorPlanSummary[]> {
	const roots = uniqueStrings([
		args.repoRoot ? path.join(path.resolve(args.repoRoot), ".cursor", "plans") : "",
		args.includeGlobal ? path.join(os.homedir(), ".cursor", "plans") : "",
	]);
	const summaries: CursorPlanSummary[] = [];
	for (const root of roots) {
		const files = await collectPlanFiles(root);
		for (const file of files) {
			try {
				const stat = await fsp.stat(file);
				const plan = await readCursorPlan(file);
				const pending = plan.todos.filter((todo) => todo.status !== "completed").length;
				summaries.push({
					path: file,
					name: plan.name,
					overview: plan.overview,
					modified_at: stat.mtime.toISOString(),
					todo_total: plan.todos.length,
					todo_pending: pending,
					is_project: plan.isProject,
				});
			} catch {
				// skip unreadable plans
			}
		}
	}
	return args.planHint?.trim()
		? rankCursorPlans(summaries, args.planHint)
		: summaries.sort((a, b) => b.modified_at.localeCompare(a.modified_at));
}

function normalizeMatchText(text: string): string {
	return text
		.toLowerCase()
		.replace(/[`'"]/g, "")
		.replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ")
		.trim();
}

function tokenizeForMatch(text: string): string[] {
	return uniqueStrings(
		normalizeMatchText(text)
			.split(/\s+/)
			.filter((token) => token.length >= 2),
	);
}

export function scorePlanAgainstHint(
	plan: CursorPlanSummary,
	hint: string,
): { score: number; match_reasons: string[] } {
	const normalizedHint = normalizeMatchText(hint);
	const hintTokens = tokenizeForMatch(hint);
	const haystacks = [
		{ label: "name", text: plan.name },
		{ label: "overview", text: plan.overview },
		{ label: "filename", text: path.basename(plan.path, ".plan.md") },
	];
	let score = 0;
	const match_reasons: string[] = [];

	for (const { label, text } of haystacks) {
		const normalized = normalizeMatchText(text);
		if (!normalized) continue;
		if (normalizedHint.includes(normalized)) {
			score += 12;
			match_reasons.push(`${label}: full phrase in chat hint`);
		} else if (normalized.includes(normalizedHint) && normalizedHint.length >= 4) {
			score += 10;
			match_reasons.push(`${label}: chat hint appears in ${label}`);
		}
		const overlap = tokenizeForMatch(text).filter((token) => hintTokens.includes(token));
		if (overlap.length > 0) {
			score += overlap.length * 3;
			match_reasons.push(`${label}: token overlap (${overlap.slice(0, 4).join(", ")})`);
		}
	}

	return { score, match_reasons: uniqueStrings(match_reasons) };
}

export function rankCursorPlans(
	plans: CursorPlanSummary[],
	hint?: string,
): RankedCursorPlan[] {
	const trimmedHint = hint?.trim();
	if (!trimmedHint) {
		return plans.map((plan) => ({ ...plan, score: 0, match_reasons: [] }));
	}
	return plans
		.map((plan) => {
			const scored = scorePlanAgainstHint(plan, trimmedHint);
			return { ...plan, score: scored.score, match_reasons: scored.match_reasons };
		})
		.sort((a, b) => b.score - a.score || b.modified_at.localeCompare(a.modified_at));
}

const PLAN_HINT_SCORE_MIN = 6;
const PLAN_HINT_SCORE_GAP = 3;

export function resolveCursorPlan(args: {
	plans: CursorPlanSummary[];
	planPath?: string;
	openPlanPath?: string;
	planHint?: string;
	repoRoot?: string;
}): PlanResolution {
	if (args.planPath) {
		const candidate = path.isAbsolute(args.planPath)
			? args.planPath
			: path.resolve(args.repoRoot ?? process.cwd(), args.planPath);
		const exists = args.plans.some((plan) => path.resolve(plan.path) === path.resolve(candidate));
		if (!exists) {
			return {
				status: "needs_disambiguation",
				method: "needs_disambiguation",
				plan_hint_used: args.planHint,
				candidates: rankCursorPlans(args.plans, args.planHint),
				message: `plan_path not found in workspace plans: ${candidate}`,
			};
		}
		return { status: "resolved", path: candidate, method: "explicit_path" };
	}

	if (args.openPlanPath?.endsWith(".plan.md")) {
		const candidate = path.resolve(args.openPlanPath);
		const match = args.plans.find((plan) => path.resolve(plan.path) === candidate);
		if (match) {
			return {
				status: "resolved",
				path: match.path,
				method: "open_plan_path",
				plan_hint_used: args.planHint,
			};
		}
	}

	if (args.plans.length === 0) {
		throw new Error("no workspace plan found under .cursor/plans; pass plan_path or Save plan to workspace first");
	}

	if (args.plans.length === 1) {
		return { status: "resolved", path: args.plans[0].path, method: "single_plan" };
	}

	const ranked = rankCursorPlans(args.plans, args.planHint);
	const trimmedHint = args.planHint?.trim();
	if (trimmedHint) {
		const [top, second] = ranked;
		if (
			top &&
			top.score >= PLAN_HINT_SCORE_MIN &&
			(!second || top.score - second.score >= PLAN_HINT_SCORE_GAP)
		) {
			return {
				status: "resolved",
				path: top.path,
				method: "plan_hint",
				plan_hint_used: trimmedHint,
				match_reasons: top.match_reasons,
				score: top.score,
			};
		}
		return {
			status: "needs_disambiguation",
			method: "needs_disambiguation",
			plan_hint_used: trimmedHint,
			candidates: ranked,
			message:
				top && top.score > 0
					? "multiple plans match recent chat; ask the user to pick plan_path"
					: "no plan strongly matches recent chat; ask the user to pick plan_path",
		};
	}

	return {
		status: "needs_disambiguation",
		method: "needs_disambiguation",
		candidates: ranked,
		message: "multiple workspace plans found; pass plan_hint from recent chat or plan_path",
	};
}

export async function resolveCursorPlanPath(args: {
	planPath?: string;
	openPlanPath?: string;
	planHint?: string;
	repoRoot?: string;
}): Promise<string> {
	const plans = await listCursorPlans({
		repoRoot: args.repoRoot,
		includeGlobal: false,
	});
	const resolution = resolveCursorPlan({ ...args, plans });
	if (resolution.status === "needs_disambiguation") {
		throw new Error(resolution.message);
	}
	return resolution.path;
}

export function suggestCookSlugFromPlan(plan: ParsedCursorPlan): { slug: string; branch: string } {
	const slug = slugifyPlanName(plan.name);
	return { slug, branch: `cook/${slug}` };
}

export async function previewPlanToCookHandoff(args: {
	planPath?: string;
	openPlanPath?: string;
	planHint?: string;
	repoRoot?: string;
	overrides?: Record<string, unknown>;
}) {
	const repoRoot = args.repoRoot;
	const plans = await listCursorPlans({
		repoRoot,
		includeGlobal: false,
	});
	const resolution = resolveCursorPlan({
		plans,
		planPath: args.planPath,
		openPlanPath: args.openPlanPath,
		planHint: args.planHint,
		repoRoot,
	});

	if (resolution.status === "needs_disambiguation") {
		return {
			ok: false,
			needs_disambiguation: true,
			plan_resolution: resolution,
			repo_root: repoRoot,
			next_steps: [
				"Show candidates (name, overview, score, match_reasons) and ask the user to pick plan_path",
				"Or refine plan_hint from recent chat and call preview_plan_to_cook_handoff again",
			],
		};
	}

	const resolvedPath = resolution.path;
	const plan = await readCursorPlan(resolvedPath);
	const draft = planToCookHandoffDraft(plan, args.overrides ?? {});
	const slugSuggestion = suggestCookSlugFromPlan(plan);
	return {
		ok: draft.gaps.length === 0,
		plan_resolution: resolution,
		plan_path: resolvedPath,
		plan_name: plan.name,
		plan_overview: plan.overview,
		todo_summary: {
			total: plan.todos.length,
			pending: plan.todos.filter((todo) => todo.status !== "completed").length,
		},
		suggested_slug: slugSuggestion.slug,
		suggested_branch: slugSuggestion.branch,
		capsule: draft.capsule,
		mapping_notes: draft.mapping_notes,
		gaps: draft.gaps,
		next_steps: [
			"Review capsule and mapping_notes with the user; edit overrides if needed",
			"resolve_cook_workspace({ mode: auto })",
			"synthesize_cook_handoff({ workspace_root, plan_capsule: capsule, discussion_summary })",
			"prepare_cook_handoff({ workspace_root, capsule })",
			"confirm_cook_handoff({ workspace_root })",
			"Follow cursor-orchestrator for dispatch loop",
		],
	};
}
