import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
	classifyWorktreePath,
	getCookWorkspaceContext,
	parseGitWorktreeList,
	resolveCookWorkspace,
} from "./worktree.ts";

function runGit(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
}

async function initGitRepo(root: string): Promise<void> {
	runGit(root, ["init"]);
	runGit(root, ["config", "user.email", "test@example.com"]);
	runGit(root, ["config", "user.name", "Test User"]);
	runGit(root, ["commit", "--allow-empty", "-m", "init"]);
}

test("classifyWorktreePath detects Cursor worktree paths", () => {
	assert.equal(classifyWorktreePath("/Users/me/.cursor/worktrees/mono/abc"), "cursor");
	assert.equal(classifyWorktreePath("/tmp/other-worktree"), "other_linked");
});

test("parseGitWorktreeList marks first entry as main", () => {
	const parsed = parseGitWorktreeList(`worktree /repo/main
HEAD abc123
branch refs/heads/main

worktree /repo/.cursor/worktrees/mono/xyz
HEAD def456
branch refs/heads/feature
`);
	assert.equal(parsed.length, 2);
	assert.equal(parsed[0]?.isMain, true);
	assert.equal(parsed[1]?.isMain, false);
	assert.equal(parsed[1]?.branch, "feature");
});

test("getCookWorkspaceContext allows main checkout with isolation confirm", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-wt-main-"));
	try {
		await initGitRepo(root);
		const context = getCookWorkspaceContext({ workspaceRoot: root });
		assert.equal(context.ready_for_cook, true);
		assert.equal(context.is_main_checkout, true);
		assert.equal(context.isolation_status, "main");
		assert.equal(context.isolation_confirm_required, true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("resolveCookWorkspace succeeds on main checkout with warning", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "letscook-wt-resolve-"));
	try {
		await initGitRepo(root);
		const resolved = await resolveCookWorkspace({ workspaceRoot: root });
		assert.equal(resolved.ok, true);
		if (!resolved.ok) return;
		assert.equal(resolved.isolation_confirm_required, true);
		assert.deepEqual(resolved.warnings, ["main_checkout_isolation_recommended"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
