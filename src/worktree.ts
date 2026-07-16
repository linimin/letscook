import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type CookWorkspaceMode = "auto" | "cursor_native";

export type GitWorktreeEntry = {
	path: string;
	branch?: string;
	head?: string;
	isMain: boolean;
};

export type CookWorkspaceIsolationStatus = "main" | "linked_other" | "cursor";

export type CookWorkspaceContext = {
	workspace_root: string;
	main_repo_root: string;
	branch: string;
	is_linked_worktree: boolean;
	is_main_checkout: boolean;
	worktree_kind: "main" | "cursor" | "other_linked";
	isolation_status: CookWorkspaceIsolationStatus;
	isolation_confirm_required: boolean;
	worktree_path?: string;
	ready_for_cook: boolean;
	recommended_mode: CookWorkspaceMode;
	messages: string[];
	next_steps: string[];
};

export type ResolveCookWorkspaceResult =
	| {
			ok: true;
			mode: CookWorkspaceMode;
			workspace_root: string;
			main_repo_root: string;
			branch: string;
			worktree_kind: CookWorkspaceContext["worktree_kind"];
			isolation_status: CookWorkspaceIsolationStatus;
			isolation_confirm_required: boolean;
			messages: string[];
			warnings?: string[];
	  }
	| {
			ok: false;
			mode: CookWorkspaceMode;
			error: string;
			context?: CookWorkspaceContext;
			next_steps: string[];
	  };

function runGit(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	return {
		ok: result.status === 0,
		stdout: (result.stdout ?? "").trim(),
		stderr: (result.stderr ?? "").trim(),
	};
}

export function normalizePath(candidate: string): string {
	try {
		return realpathSync.native(candidate);
	} catch {
		return path.resolve(candidate);
	}
}

export function classifyWorktreePath(worktreePathname: string): CookWorkspaceContext["worktree_kind"] {
	const normalized = normalizePath(worktreePathname);
	const parts = normalized.split(path.sep);
	if (parts.includes(".cursor") && parts.includes("worktrees")) return "cursor";
	return "other_linked";
}

export function parseGitWorktreeList(porcelain: string): GitWorktreeEntry[] {
	const blocks = porcelain.split(/\n(?=worktree )/).filter(Boolean);
	return blocks.map((block, index) => {
		const lines = block.split("\n");
		const worktreeLine = lines.find((line) => line.startsWith("worktree "));
		const branchLine = lines.find((line) => line.startsWith("branch "));
		const headLine = lines.find((line) => line.startsWith("HEAD "));
		const pathValue = worktreeLine?.slice("worktree ".length).trim() ?? "";
		const branch = branchLine?.slice("branch refs/heads/".length).trim();
		return {
			path: pathValue,
			branch,
			head: headLine?.slice("HEAD ".length).trim(),
			isMain: index === 0,
		};
	});
}

export function listGitWorktrees(repoRoot: string): GitWorktreeEntry[] {
	const listed = runGit(repoRoot, ["worktree", "list", "--porcelain"]);
	if (!listed.ok) return [];
	return parseGitWorktreeList(listed.stdout);
}

export function findGitRepoRoot(startCwd: string): string | undefined {
	let current = path.resolve(startCwd);
	while (true) {
		if (runGit(current, ["rev-parse", "--is-inside-work-tree"]).ok) {
			const root = runGit(current, ["rev-parse", "--show-toplevel"]);
			return root.ok ? path.resolve(root.stdout) : current;
		}
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

export function findMainGitRepoRoot(startCwd: string): string | undefined {
	const workspaceRoot = findGitRepoRoot(startCwd);
	if (!workspaceRoot) return undefined;
	const gitCommonDir = runGit(workspaceRoot, ["rev-parse", "--git-common-dir"]);
	if (!gitCommonDir.ok) return workspaceRoot;
	const commonPath = path.resolve(workspaceRoot, gitCommonDir.stdout);
	const worktreesMarker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
	if (commonPath.includes(worktreesMarker)) {
		const gitDir = path.dirname(path.dirname(commonPath));
		return path.dirname(gitDir);
	}
	return path.dirname(commonPath);
}

export function getCookWorkspaceContext(args?: {
	workspaceRoot?: string;
	cwd?: string;
}): CookWorkspaceContext {
	const startCwd = args?.workspaceRoot ?? args?.cwd ?? process.cwd();
	const workspaceRoot = findGitRepoRoot(startCwd);
	const messages: string[] = [];
	const next_steps: string[] = [];

	if (!workspaceRoot) {
		return {
			workspace_root: path.resolve(startCwd),
			main_repo_root: path.resolve(startCwd),
			branch: "",
			is_linked_worktree: false,
			is_main_checkout: true,
			worktree_kind: "main",
			isolation_status: "main",
			isolation_confirm_required: false,
			ready_for_cook: false,
			recommended_mode: "cursor_native",
			messages: ["not inside a git repository"],
			next_steps: ["Open a git repository before running /cook"],
		};
	}

	const mainRepoRoot = findMainGitRepoRoot(workspaceRoot) ?? workspaceRoot;
	const branchResult = runGit(workspaceRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
	const branch = branchResult.ok ? branchResult.stdout : "";
	const gitDir = runGit(workspaceRoot, ["rev-parse", "--git-dir"]);
	const gitDirPath = gitDir.ok ? path.resolve(workspaceRoot, gitDir.stdout) : "";
	const isLinkedWorktree = gitDirPath.includes(`${path.sep}.git${path.sep}worktrees${path.sep}`);
	const isMainCheckout = !isLinkedWorktree;
	const worktreeKind: CookWorkspaceContext["worktree_kind"] = isMainCheckout
		? "main"
		: classifyWorktreePath(workspaceRoot);

	let readyForCook = false;
	const recommendedMode: CookWorkspaceMode = "cursor_native";

	const isolationStatus: CookWorkspaceIsolationStatus = isMainCheckout
		? "main"
		: worktreeKind === "cursor"
			? "cursor"
			: "linked_other";

	if (isMainCheckout) {
		readyForCook = true;
		messages.push("current checkout is the main worktree");
		messages.push("Cook can start on main checkout, but isolation is recommended");
		next_steps.push("Optional: run Cursor `/worktree <task summary>` before `/cook` for sandboxed edits");
		next_steps.push("If you continue on main, confirm_cook_handoff will ask for an explicit isolation decision");
	} else if (worktreeKind === "cursor") {
		readyForCook = true;
		messages.push("running in a Cursor-managed worktree (.cursor/worktrees/)");
		next_steps.push("Use workspace_root from this context for prepare_cook_handoff and orchestrator tools");
		next_steps.push("When done: `/apply-worktree` then `/delete-worktree`");
	} else {
		readyForCook = true;
		messages.push("running in a linked git worktree (not Cursor-managed)");
		next_steps.push("Use this workspace_root for the letscook workflow");
		next_steps.push("Prefer Cursor `/worktree` for automatic setup and cleanup");
	}

	return {
		workspace_root: workspaceRoot,
		main_repo_root: mainRepoRoot,
		branch,
		is_linked_worktree: isLinkedWorktree,
		is_main_checkout: isMainCheckout,
		worktree_kind: worktreeKind,
		isolation_status: isolationStatus,
		isolation_confirm_required: isMainCheckout,
		worktree_path: isLinkedWorktree ? workspaceRoot : undefined,
		ready_for_cook: readyForCook,
		recommended_mode: recommendedMode,
		messages,
		next_steps,
	};
}

export async function resolveCookWorkspace(args: {
	mode?: CookWorkspaceMode;
	workspaceRoot?: string;
	repoRoot?: string;
}): Promise<ResolveCookWorkspaceResult> {
	const mode = args.mode ?? "auto";
	const context = getCookWorkspaceContext({
		workspaceRoot: args.workspaceRoot,
		cwd: args.repoRoot,
	});

	if (!context.ready_for_cook) {
		return {
			ok: false,
			mode,
			error: "workspace is not ready for /cook",
			context,
			next_steps: context.next_steps,
		};
	}

	const warnings = context.isolation_confirm_required ? ["main_checkout_isolation_recommended"] : undefined;

	return {
		ok: true,
		mode,
		workspace_root: context.workspace_root,
		main_repo_root: context.main_repo_root,
		branch: context.branch,
		worktree_kind: context.worktree_kind,
		isolation_status: context.isolation_status,
		isolation_confirm_required: context.isolation_confirm_required,
		messages: context.messages,
		warnings,
	};
}

export function buildFinishCookWorkflowGuide(args: {
	workspaceRoot: string;
	workflowClosed?: boolean;
}): {
	ok: boolean;
	workspace_root: string;
	worktree_kind: CookWorkspaceContext["worktree_kind"];
	next_steps: string[];
	warnings: string[];
} {
	const context = getCookWorkspaceContext({ workspaceRoot: args.workspaceRoot });
	const warnings: string[] = [];
	const next_steps: string[] = [];

	if (!args.workflowClosed) {
		warnings.push("workflow may still be active; confirm get_workflow_status before finishing");
	}

	if (context.worktree_kind === "cursor") {
		next_steps.push("Review changes in this worktree chat");
		next_steps.push("If good: `/apply-worktree` to merge into main checkout");
		next_steps.push("Then: `/delete-worktree` to let Cursor clean up the sandbox");
		next_steps.push("Or ask the agent to commit, push, and open a PR from this worktree");
		warnings.push("avoid manual git worktree remove on .cursor/worktrees paths; prefer /delete-worktree");
	} else if (context.is_linked_worktree) {
		next_steps.push(`git worktree remove ${context.workspace_root}`);
		next_steps.push("git worktree prune");
		warnings.push("prefer Cursor `/worktree` for future cooks so `/delete-worktree` handles cleanup");
	} else if (context.is_main_checkout) {
		next_steps.push("Review local commits on this checkout");
		next_steps.push("Push and open a PR, or merge when ready");
		warnings.push("workflow ran on main checkout; there is no /apply-worktree merge step");
		warnings.push(".agent/ cleanup after workflow closure is expected; do not treat it as a missing-repo anomaly");
	} else {
		next_steps.push("No linked worktree detected; nothing to remove");
	}

	return {
		ok: true,
		workspace_root: context.workspace_root,
		worktree_kind: context.worktree_kind,
		next_steps,
		warnings,
	};
}

export function defaultCursorWorktreesJsonExample(): Record<string, unknown> {
	return {
		"setup-worktree": [
			"npm ci --no-fund --no-audit 2>/dev/null || npm install --no-fund --no-audit 2>/dev/null || true",
			"test -f \"$ROOT_WORKTREE_PATH/.env\" && cp \"$ROOT_WORKTREE_PATH/.env\" .env || true",
		],
	};
}

export function cursorWorktreesHomeHint(): string {
	return path.join(os.homedir(), ".cursor", "worktrees");
}
