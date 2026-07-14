#!/usr/bin/env node
/**
 * Rewrite plugin hook commands to absolute paths.
 * Plugin hooks run with the workspace CWD (not the plugin root), so relative
 * ./hooks/*.sh paths fail in multi-root workspaces.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = process.argv[2]
	? path.resolve(process.argv[2])
	: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const hooksPath = path.join(pluginRoot, "hooks", "hooks.json");
if (!fs.existsSync(hooksPath)) {
	console.error(`[rewrite-hook-paths] missing ${hooksPath}`);
	process.exit(1);
}

const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));

for (const eventHooks of Object.values(hooks.hooks ?? {})) {
	for (const hook of eventHooks) {
		if (typeof hook.command !== "string") continue;
		const cmd = hook.command;
		if (cmd.startsWith("./hooks/") || cmd.startsWith("hooks/")) {
			const name = path.basename(cmd);
			hook.command = path.join(pluginRoot, "hooks", name);
		}
	}
}

fs.writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`, "utf8");
console.log(`[rewrite-hook-paths] updated ${hooksPath}`);
