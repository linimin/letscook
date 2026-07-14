import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { promises as fsp } from "node:fs";
import * as path from "node:path";

export type EnsureCookWorktreeArgs = {
	repoRoot: string;
	branch: string;
	slug: string;
	baseRef?: string;
};

export type EnsureCookWorktreeResult = {
	workspace_root: string;
	branch: string;
	path: string;
	created: boolean;
	repo_root: string;
};

function runGit(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	return {
		ok: result.status === 0,
		stdout: (result.stdout ?? "").trim(),
		stderr: (result.stderr ?? "").trim(),
	};
}

function sanitizeSlug(slug: string): string {
	return slug.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "task";
}

function worktreePath(repoRoot: string, slug: string): string {
	return path.join(repoRoot, ".worktrees", `cook-${sanitizeSlug(slug)}`);
}

function normalizePath(candidate: string): string {
	try {
		return realpathSync.native(candidate);
	} catch {
		return path.resolve(candidate);
	}
}

function isGitWorktreePath(repoRoot: string, candidate: string): boolean {
	const listed = runGit(repoRoot, ["worktree", "list", "--porcelain"]);
	if (!listed.ok) return false;
	const resolved = normalizePath(candidate);
	for (const line of listed.stdout.split("\n")) {
		if (line.startsWith("worktree ")) {
			const listedPath = line.slice("worktree ".length).trim();
			if (normalizePath(listedPath) === resolved) return true;
		}
	}
	return false;
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

export async function ensureCookWorktree(args: EnsureCookWorktreeArgs): Promise<EnsureCookWorktreeResult> {
	const repoRoot = path.resolve(args.repoRoot);
	const branch = args.branch.trim();
	const slug = sanitizeSlug(args.slug);
	const targetPath = worktreePath(repoRoot, slug);
	const baseRef = args.baseRef?.trim() || "HEAD";

	if (!runGit(repoRoot, ["rev-parse", "--is-inside-work-tree"]).ok) {
		throw new Error(`not a git repository: ${repoRoot}`);
	}

	if (isGitWorktreePath(repoRoot, targetPath)) {
		const currentBranch = runGit(targetPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
		if (currentBranch.ok && currentBranch.stdout !== branch) {
			throw new Error(`worktree branch mismatch: expected ${branch}, found ${currentBranch.stdout}`);
		}
		return {
			workspace_root: targetPath,
			branch,
			path: targetPath,
			created: false,
			repo_root: repoRoot,
		};
	}

	await fsp.mkdir(path.dirname(targetPath), { recursive: true });
	const branchExists = runGit(repoRoot, ["show-ref", "--verify", `refs/heads/${branch}`]);
	if (!branchExists.ok) {
		const created = runGit(repoRoot, ["branch", branch, baseRef]);
		if (!created.ok) throw new Error(`failed to create branch ${branch}: ${created.stderr}`);
	}
	const added = runGit(repoRoot, ["worktree", "add", "-B", branch, targetPath, baseRef]);
	if (!added.ok) throw new Error(`failed to add worktree: ${added.stderr}`);

	return {
		workspace_root: targetPath,
		branch,
		path: targetPath,
		created: true,
		repo_root: repoRoot,
	};
}
