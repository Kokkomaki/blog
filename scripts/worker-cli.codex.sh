#!/usr/bin/env bash
# Codex adapter for scripts/launch-worker.sh. Contract: `--check` only validates the setup;
# otherwise $1 is the prompt file. The launcher sets the current directory to the worker's worktree
# and captures stdout and stderr in the worker log.
#
# ONE ACCOUNT. Blog workers use Ville's personal Codex login (Klapi calls it "main"), nothing else.
# When its quota runs out the worker fails and the lead tells Ville. There is no switching to another
# account, no retry on another login. BLOG_CODEX_HOME overrides the folder if the login moves.
#
# DENY LIST. Codex's workspace sandbox lets a worker READ the whole disk (tested 2026-11-19), so this
# adapter runs it with a permission profile that extends `:workspace` (write the worktree only) and
# denies reading credentials, private data and every other project. Test it without quota:
#   scripts/worker-cli.codex.sh --sandbox-test /bin/ls "$HOME/.ssh"     (run inside a worktree)
#
# Models: build work uses gpt-6.1-sol at xhigh, research and audits use gpt-6-luna at max (card
# field `Kind:`). No permission bypass, no danger-full-access.
set -euo pipefail

export CODEX_HOME="${BLOG_CODEX_HOME:-$HOME/.codex}"

deny=()
add() { [[ -e $1 ]] && deny+=("$1"); return 0; }
profile_args() {
  deny=()
  local d repo
  for d in .ssh .gnupg .aws .config/gh .codex .codex-work .claude Private Library/Keychains; do add "$HOME/$d"; done
  for d in "$HOME/Projects"/*; do [[ $d == "$HOME/Projects/blog" ]] || add "$d"; done
  for d in "$HOME/Projects/blog"/*; do [[ $d == "$HOME/Projects/blog/blog" ]] || add "$d"; done
  repo=$(cd "$(git rev-parse --git-common-dir)/.." && pwd -P)   # the primary checkout, from inside a worktree
  for d in docs .claude .agents .local AGENTS.md REVIEW.md DESIGN.md CLAUDE.md; do add "$repo/$d"; done
  local toml='permissions={ "blog-worker" = { extends = ":workspace", filesystem = { '
  for d in "${deny[@]}"; do toml+="\"$d\" = \"deny\", "; done
  toml+='":workspace_roots" = { "**/.env*" = "deny", "**/*.pem" = "deny", "**/*.key" = "deny" } } } }'
  cfg=(-c 'default_permissions="blog-worker"' -c "$toml")
}

case ${1:-} in
  --check)
    command -v codex >/dev/null || { echo 'codex CLI not found' >&2; exit 78; }
    codex --version >/dev/null
    [[ -d $CODEX_HOME ]] || { echo "Codex home not found: $CODEX_HOME" >&2; exit 78; }
    exit 0 ;;
  --sandbox-test)
    shift; profile_args
    exec codex sandbox "${cfg[@]}" -- "$@" ;;
esac

prompt=${1:?usage: worker-cli.codex.sh PROMPT_FILE}
card=$(grep -oE 'docs/changes/[A-Za-z0-9-]+\.md' "$prompt" | head -1)
[[ -n $card && -f $card ]] || { echo "card not found from prompt: $card" >&2; exit 2; }
kind=$(sed -n 's/^Kind: //p' "$card" | head -1)
network=$(sed -n 's/^Network: //p' "$card" | head -1)
[[ $network == yes* ]] && { echo 'Network: yes is not supported with the deny-list profile yet; ask the lead.' >&2; exit 2; }

case $kind in
  research|audit) model=${BLOG_CODEX_RESEARCH_MODEL:-gpt-6-luna}; effort=max ;;
  *)              model=${BLOG_CODEX_BUILD_MODEL:-gpt-6.1-sol};   effort=xhigh ;;
esac

profile_args
printf 'worker: account=%s model=%s effort=%s card=%s denied-read-paths=%s\n' "$CODEX_HOME" "$model" "$effort" "$card" "${#deny[@]}" >&2
exec codex exec -m "$model" -c "model_reasoning_effort=\"$effort\"" "${cfg[@]}" - < "$prompt"
