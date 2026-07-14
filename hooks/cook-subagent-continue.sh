#!/usr/bin/env bash
# subagentStop hook: after a completion-role subagent completes, nudge the primary agent
# to continue the letscook orchestrator loop via MCP.
set -euo pipefail

input="$(cat)"
status="$(echo "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(j.status||"")}catch{}})')"

if [[ "$status" != "completed" ]]; then
  echo '{}'
  exit 0
fi

loop_count="$(echo "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);process.stdout.write(String(j.loop_count??0))}catch{process.stdout.write("0")}})')"

cat <<EOF
{
  "followup_message": "The completion subagent finished. Continue the letscook workflow: 1) call get_workflow_dispatch with the same workspace_root; 2) if dispatch_allowed, dispatch the returned role or report workflow_closed; 3) if a role just completed but you have not submitted yet, call submit_role_result first. (auto-continue ${loop_count})"
}
EOF
