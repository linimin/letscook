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
  "followup_message": "Letscook subagent finished. Mandatory next steps in this same conversation: 1) if not submitted yet, call submit_role_result({ workspace_root, role, raw_output }); 2) call get_workflow_dispatch({ workspace_root }); 3) if dispatch_allowed, immediately dispatch the returned cursor_agent with system_context + task_prompt — do not ask the user to continue. (auto-continue ${loop_count})"
}
EOF
