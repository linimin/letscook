#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const statePath = path.join(root, ".agent/current/state.json");
if (!fs.existsSync(statePath)) {
  console.error("missing .agent/current/state.json");
  process.exit(1);
}
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
if (!state.next_mandatory_role && state.continuation_policy !== "done") {
  console.error("control plane state missing next_mandatory_role");
  process.exit(1);
}
console.log("control plane OK");
