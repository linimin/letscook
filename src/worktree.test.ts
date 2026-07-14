import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyWorktreePath, parseGitWorktreeList } from "./worktree.ts";

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
