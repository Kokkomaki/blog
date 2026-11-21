#!/usr/bin/env bash
# One foreground Codex worker in its own git worktree. No automatic cleanup, integration,
# restart or release. Adapted from Klapi's AI SDLC starter for a repo where:
#   - the rules, owner wishes and task cards are git-ignored (private), so they are COPIED into
#     the worktree here, and
#   - the owner edits files on main while workers run, so main may be dirty as long as no
#     uncommitted file is one of the card's Allowed paths.
set -euo pipefail

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
usage() {
  printf 'Usage: bash scripts/launch-worker.sh TASK docs/changes/CARD.md [--run]\n'
  printf 'Default: validate and print a dry run. --run starts one foreground worker.\n'
  printf 'WORKER_ADAPTER overrides scripts/worker-cli.codex.sh (absolute path).\n'
}
if [[ $# -lt 2 || $# -gt 3 ]]; then usage >&2; exit 2; fi
task_name=$1
card=$2
mode=${3:---dry-run}
[[ $mode == --run || $mode == --dry-run ]] || fail 'Use --run or omit the third argument.'
[[ $task_name =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ && ${#task_name} -le 48 ]] || fail 'Use a short lowercase task name.'
[[ $card =~ ^docs/changes/[A-Za-z0-9][A-Za-z0-9-]*\.md$ ]] || fail 'Card must be a Markdown file directly in docs/changes.'

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd -- "$project_root"
git_root=$(git rev-parse --show-toplevel) || fail 'Run inside the blog repository.'
[[ $(cd -- "$git_root" && pwd -P) == "$project_root" ]] || fail 'Run from the primary checkout.'
[[ $(git symbolic-ref --quiet --short HEAD) == main ]] || fail 'Launch from main.'
[[ -f $card && ! -L $card ]] || fail 'Card must be a regular file.'
grep -qx 'Status: Queued' "$card" || fail 'Card must say Status: Queued.'
for f in AGENTS.md REVIEW.md .claude/output-styles/blog-eli5.md; do
  [[ -f $f && ! -L $f ]] || fail "Missing $f. Private rules are required."
done
if grep -q 'REPLACE_WITH' AGENTS.md "$card"; then fail 'Fill the project rules and card placeholders first.'; fi
base=$(sed -n 's/^Base: //p' "$card")
[[ $base =~ ^([a-f0-9]{40}|[a-f0-9]{64})$ ]] || fail 'Card needs one exact full Base commit.'
git cat-file -e "$base^{commit}" || fail 'Base commit is unavailable.'
git merge-base --is-ancestor "$base" main || fail 'Base must be an ancestor of main.'

# Allowed paths: bullet lines under "## Allowed". Entries may be files, folders or globs.
allowed=()
while IFS= read -r line; do
  entry=${line#- }; entry=${entry//\`/}; entry=${entry%% *}
  [[ -n $entry ]] && allowed+=("$entry")
done < <(awk '/^## /{on=($0=="## Allowed")} on && /^- /' "$card")
[[ ${#allowed[@]} -gt 0 ]] || fail 'Card has no Allowed paths.'
for a in "${allowed[@]}"; do
  case $a in content|content/*) fail "Workers never edit content/ (AGENTS.md invariant 1): $a" ;; esac
done

# Inputs: private research files or folders the worker may read, copied into its worktree (card line
# `Inputs:`, space separated, under docs/research/ only). Later research stages read earlier results this way.
inputs_str=''
for i in $(sed -n 's/^Inputs: //p' "$card" | head -1); do
  [[ $i =~ ^docs/research/[A-Za-z0-9._/-]+$ && $i != *..* ]] || fail "Inputs must be under docs/research/ without '..': $i"
  [[ -e $i && ! -L $i ]] || fail "Input not found or a symbolic link: $i"
  [[ -z $(find "$i" -type l 2>/dev/null) ]] || fail "Input contains a symbolic link: $i"
  inputs_str+="$i "
done
inputs_str=${inputs_str% }

overlaps() { # does path $1 fall under an Allowed entry?
  local p=$1 a
  for a in "${allowed[@]}"; do
    # shellcheck disable=SC2053
    if [[ $p == "$a" || $p == "${a%/}"/* || $p == $a ]]; then return 0; fi
  done
  return 1
}

# Uncommitted work on main is fine unless it touches a path this worker may edit.
dirty=$(git status --porcelain --untracked-files=all | sed 's/^...//; s/.* -> //')
clash=()
while IFS= read -r p; do [[ -n $p ]] && overlaps "$p" && clash+=("$p"); done <<< "$dirty"
[[ ${#clash[@]} -eq 0 ]] || fail "Uncommitted changes overlap the card's Allowed paths: ${clash[*]}. Commit or move them first."
# Changes committed to main since Base must not touch Allowed paths either.
drifted=()
while IFS= read -r p; do [[ -n $p ]] && overlaps "$p" && drifted+=("$p"); done < <(git diff --name-only "$base" main)
[[ ${#drifted[@]} -eq 0 ]] || fail "Allowed paths changed on main since Base: ${drifted[*]}. Review main and refresh Base."

branch="worker/$task_name"
worktree="$project_root/.worktrees/$task_name"
log_dir="$project_root/.local/workers"
log_file="$log_dir/$task_name.log"
for local_dir in .worktrees .local .local/workers; do
  [[ ! -L $local_dir ]] || fail 'Local worker folders must not be symbolic links.'
done
git check-ignore -q --no-index .worktrees/probe || fail 'Ignore .worktrees/ in .gitignore first.'
git check-ignore -q --no-index .local/probe || fail 'Ignore .local/ in .gitignore first.'
for f in AGENTS.md REVIEW.md DESIGN.md CLAUDE.md docs/probe .claude/probe .agents/probe; do
  git check-ignore -q --no-index "$f" || fail "Private file must be git-ignored: $f"
done
[[ ! -e $worktree && ! -L $worktree ]] || fail 'Worktree already exists. Inspect and resume it manually.'
if git show-ref --verify --quiet "refs/heads/$branch"; then fail 'Worker branch already exists.'; fi
[[ ! -e $log_file && ! -L $log_file ]] || fail 'Worker log already exists. Preserve it and choose a new task name.'
start_head=$(git rev-parse main)
adapter=${WORKER_ADAPTER:-$project_root/scripts/worker-cli.codex.sh}

printf 'Mode: %s\nBase: %s\nStart: %s\nCard: %s\nBranch: %s\nWorktree: %s\nLog: %s\nAdapter: %s\nAllowed: %s\n' \
  "$mode" "$base" "$start_head" "$card" "$branch" "$worktree" "$log_file" "$adapter" "${allowed[*]}"
if [[ -n $dirty ]]; then printf 'Note: main has uncommitted files, none overlap Allowed (%s paths).\n' "$(printf '%s\n' "$dirty" | grep -c .)"; fi
if [[ -n $inputs_str ]]; then printf 'Inputs: %s\n' "$inputs_str"; fi
if [[ $mode == --dry-run ]]; then
  printf 'Dry run only. No files, branches, worktrees, or workers created.\n'
  exit 0
fi

[[ $adapter == /* && -f $adapter && -x $adapter ]] || fail 'Adapter must be an absolute executable path.'
"$adapter" --check || fail 'Worker adapter preflight failed; no worktree created.'
umask 077
mkdir -p -- "$log_dir" "$project_root/.worktrees"
lock_dir="$log_dir/launch.lock"
mkdir -- "$lock_dir" || fail 'Another launch holds the lock. Inspect it before retrying.'
trap 'rmdir -- "$lock_dir"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
[[ $(git rev-parse main) == "$start_head" ]] || fail 'main moved during preparation.'
git worktree add -b "$branch" "$worktree" "$start_head"

# Copy the private context. A worktree has only tracked files; these are git-ignored on purpose.
mkdir -p -- "$worktree/docs/changes" "$worktree/.claude/output-styles" "$worktree/.agents/skills" "$worktree/.local"
for f in AGENTS.md CLAUDE.md REVIEW.md DESIGN.md; do [[ -f $f ]] && cp -- "$f" "$worktree/$f"; done
[[ -d docs/owner ]] && cp -R docs/owner "$worktree/docs/owner"
[[ -d docs/design ]] && cp -R docs/design "$worktree/docs/design"
[[ -d node_modules ]] && { cp -cR node_modules "$worktree/node_modules" 2>/dev/null || cp -R node_modules "$worktree/node_modules"; }   # a real copy (APFS clone): Hugo refuses a symlinked node_modules ("outside the project"); git-ignored
cp -- "$card" "$worktree/$card"
for i in $inputs_str; do mkdir -p -- "$worktree/$(dirname "$i")"; cp -R -- "$i" "$worktree/$(dirname "$i")/"; done
cp -- .claude/output-styles/blog-eli5.md "$worktree/.claude/output-styles/blog-eli5.md"
[[ -d .agents/skills ]] && cp -RL .agents/skills/. "$worktree/.agents/skills/"

prompt_file="$worktree/.local/worker-prompt.md"
cat > "$prompt_file" <<EOF
You are a worker in this worktree only. Your task card is $card.
Read AGENTS.md, $card, the owner files it names, REVIEW.md, the skills on its Skills line, DESIGN.md
for UI work, and .claude/output-styles/blog-eli5.md before changing files.
Deliver exactly the card outcome. Edit only its Allowed paths, including the card itself.
Set the card to Status: Running, then complete its checks, Review evidence and Handoff.
Never edit content/. Never read outside this worktree. Never start a server; build with
hugo --minify -d <temp dir>. Leave changes uncommitted: do not stage, commit, merge, push, deploy,
use secret files, install packages, or change providers. Stop and report missing decisions or access.
Record Worker HEAD as $start_head and list every new file in your handoff.
EOF

printf 'Running in foreground. Follow the log from another terminal: tail -f %s\n' "$log_file"
if (cd -- "$worktree" && "$adapter" "$prompt_file") > "$log_file" 2>&1; then
  printf 'CLI exited zero. The lead must inspect the card, dirty files, checks and log before review.\n'
else
  worker_exit=$?
  printf 'Worker failed with exit %s. Preserved worktree and log: %s\n' "$worker_exit" "$log_file" >&2
  exit "$worker_exit"
fi
