#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

echo "[release-check] typecheck"
npm run typecheck

echo "[release-check] unit tests"
npm test

echo "[release-check] synthesis fail-closed smoke"
node --import tsx <<'NODE'
import { synthesizeCookHandoff } from "./src/handoff/synthesize.ts";
const r = synthesizeCookHandoff({});
if (r.ok !== false || r.fail_closed !== true) {
  console.error("expected synthesis fail_closed", r);
  process.exit(1);
}
NODE

echo "[release-check] mandatory dispatch smoke"
node --import tsx <<'NODE'
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeCookHandoffCapsule } from "./src/handoff/capsule.ts";
import { scaffoldWorkflowFromHandoff } from "./src/control-plane/state.ts";
import { getWorkflowDispatch } from "./src/orchestrator/dispatch.ts";

const root = mkdtempSync(join(tmpdir(), "letscook-release-"));
try {
  const capsule = normalizeCookHandoffCapsule({
    mission: "Add login redirect handling and tests",
    scope: ["src/auth/"],
    acceptance: ["redirect tests pass"],
  });
  await scaffoldWorkflowFromHandoff(root, capsule, "release-check");
  const dispatch = await getWorkflowDispatch(root);
  if (dispatch.role !== "completion-regrounder") {
    console.error("expected regrounder dispatch", dispatch);
    process.exit(1);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
NODE

echo "[release-check] verifier script scaffold smoke"
node --import tsx <<'NODE'
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeCookHandoffCapsule } from "./src/handoff/capsule.ts";
import { scaffoldWorkflowFromHandoff } from "./src/control-plane/state.ts";

const root = mkdtempSync(join(tmpdir(), "letscook-verify-"));
try {
  const capsule = normalizeCookHandoffCapsule({
    mission: "Verifier scaffold smoke",
    scope: ["src/"],
    acceptance: ["tests pass"],
  });
  await scaffoldWorkflowFromHandoff(root, capsule, "release-check");
  if (!existsSync(join(root, ".agent/verify_completion_stop.sh"))) {
    console.error("missing verify_completion_stop.sh");
    process.exit(1);
  }
  if (!existsSync(join(root, ".agent/verify_completion_control_plane.sh"))) {
    console.error("missing verify_completion_control_plane.sh");
    process.exit(1);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
NODE

echo "[release-check] OK"
