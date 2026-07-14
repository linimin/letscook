import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildVerifyStopScript(verifierCommand?: string): string {
	const packageScriptPath = path.resolve(__dirname, "..", "..", "scripts", "verify-completion-stop.sh");
	const repoRelativeScript = '"$SCRIPT_DIR/../scripts/verify-completion-stop.sh"';
	const packageScript = shellQuote(packageScriptPath);
	const repoCommandExport = `export COMPLETION_REPO_VERIFY_COMMAND=${shellQuote(verifierCommand ?? "")}`;
	return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd -P)"
${repoCommandExport}
export COMPLETION_REPO_VERIFY_CWD="$(cd "$SCRIPT_DIR/.." && pwd -P)"
if [[ -f "$SCRIPT_DIR/../scripts/verify-completion-stop.sh" ]]; then
  exec bash ${repoRelativeScript} "$@"
fi
if [[ -f ${packageScript} ]]; then
  exec bash ${packageScript} "$@"
fi
echo "verify_completion_stop: no verifier script found" >&2
exit 1
`;
}

export function buildVerifyControlPlaneScript(): string {
	const packageScriptPath = path.resolve(__dirname, "..", "..", "scripts", "verify-completion-control-plane.js");
	const packageScript = shellQuote(packageScriptPath);
	return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/../scripts/verify-completion-control-plane.js" ]]; then
  exec node "$SCRIPT_DIR/../scripts/verify-completion-control-plane.js" "$@"
fi
if [[ -f ${packageScriptPath} ]]; then
  exec node ${packageScript} "$@"
fi
echo "verify_completion_control_plane: no verifier script found" >&2
exit 1
`;
}

export async function detectVerifierCommand(root: string): Promise<string | undefined> {
	const { promises: fsp } = await import("node:fs");
	const pkgPath = path.join(root, "package.json");
	try {
		const raw = await fsp.readFile(pkgPath, "utf8");
		const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
		const testScript = pkg.scripts?.test;
		if (testScript) return `npm test`;
	} catch {
		// ignore
	}
	return undefined;
}
