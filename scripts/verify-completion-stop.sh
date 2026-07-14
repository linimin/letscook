#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${COMPLETION_REPO_VERIFY_COMMAND:-}" ]]; then
  cd "${COMPLETION_REPO_VERIFY_CWD:-.}"
  bash -lc "$COMPLETION_REPO_VERIFY_COMMAND"
  exit $?
fi
echo "verify-completion-stop: no COMPLETION_REPO_VERIFY_COMMAND set; skipping repo verify"
exit 0
