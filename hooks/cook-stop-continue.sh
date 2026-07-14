#!/usr/bin/env bash
# stop: if workflow is still active, auto-submit a follow-up user message to keep the driver loop going.
set -euo pipefail
input="$(cat)"
status="$(echo "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(j.status||"")}catch{}})')"
if [[ "$status" != "completed" ]]; then
  echo '{}'
  exit 0
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/cook-mcp-parse.mjs" stop
