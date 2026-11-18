#!/usr/bin/env bash
# Codex adapter for scripts/launch-worker.sh. Contract: `--check` only validates the setup;
# otherwise $1 is the prompt file. The launcher sets the current directory to the worker's
# worktree and captures stdout and stderr in the worker log.
# Models: build work uses gpt-6.1-sol at xhigh, research and audits use gpt-6-luna at max
# (card field `Kind:`). The card's `Network: yes` allows network inside the workspace sandbox.
# No permission bypass, no danger-full-access, no account switching.
set -euo pipefail

if [[ ${1:-} == --check ]]; then
  command -v codex >/dev/null || { echo 'codex CLI not found' >&2; exit 78; }
  codex --version >/dev/null
  exit 0
fi

prompt=${1:?usage: worker-cli.codex.sh PROMPT_FILE}
card=$(grep -oE 'docs/changes/[A-Za-z0-9-]+\.md' "$prompt" | head -1)
[[ -n $card && -f $card ]] || { echo "card not found from prompt: $card" >&2; exit 2; }
kind=$(sed -n 's/^Kind: //p' "$card" | head -1)
network=$(sed -n 's/^Network: //p' "$card" | head -1)

case $kind in
  research|audit) model=${BLOG_CODEX_RESEARCH_MODEL:-gpt-6-luna}; effort=max ;;
  *)              model=${BLOG_CODEX_BUILD_MODEL:-gpt-6.1-sol};   effort=xhigh ;;
esac

args=(exec -m "$model" -c "model_reasoning_effort=\"$effort\"" --sandbox workspace-write)
[[ $network == yes* ]] && args+=(-c sandbox_workspace_write.network_access=true)
printf 'worker: model=%s effort=%s network=%s card=%s\n' "$model" "$effort" "${network:-no}" "$card" >&2
exec codex "${args[@]}" - < "$prompt"
