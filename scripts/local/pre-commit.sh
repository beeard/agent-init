#!/usr/bin/env bash
# Global pre-commit hook (installed by `node scripts/install-local.mjs`).
#
# Git has exactly one `core.hooksPath`, so a global value wins over every
# repository's own hook directory — which is what agent-init writes into. This
# hook closes that gap by doing the opposite of taking over: it runs the
# repository's own hook when it has one, and otherwise does nothing.
#
# Controls:
#   KROK_KJEDE=1              set on the child, so a hook that calls back into
#                             this one does not loop
#   agent-init.githooks=true  per repository, in .git/config, and required
#                             before `.githooks/pre-commit` runs at all

set -uo pipefail

log() { printf 'pre-commit: %s\n' "$*"; }

# Recursion guard. If this is entered again from below — a repository hook that
# links back here, or a core.hooksPath pointing here once more — the chain stops.
if [ "${KROK_KJEDE:-0}" = "1" ]; then
  exit 0
fi

common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# --git-common-dir is relative to the working directory when not absolute.
case "$common_dir" in
  /*) ;;
  *) common_dir="$PWD/$common_dir" ;;
esac

# Which locations may run.
#
# `$GIT_DIR/hooks/` lives inside `.git/`, which a clone does not carry. A hook
# there was placed by whoever owns the machine or the clone, so running it
# grants nothing an attacker could deliver.
#
# `.githooks/` in the working tree is the opposite: it is repository content,
# delivered by `git clone` and writable by whoever authored the repository. Git
# never runs it on its own — it reads `core.hooksPath` and `$GIT_DIR/hooks` and
# nothing else — so this chain would be the one thing turning a stranger's file
# into code, machine-wide, in every repository the user clones. It therefore
# requires consent.
#
# The consent lives in `.git/config`, which a clone does not carry, so no
# repository can opt itself in by shipping a file. agent-init sets the key in
# the repositories it scaffolds, which makes the user's own action the opt-in.
# Without it, only Git's own location runs, and nothing differs from how things
# behaved before this chain existed.
if [ "$(git config --local --get agent-init.githooks 2>/dev/null)" = "true" ]; then
  candidates=("$top/.githooks/pre-commit" "$common_dir/hooks/pre-commit")
else
  candidates=("$common_dir/hooks/pre-commit")
fi

# `.githooks/` first, since it is the convention agent-init writes and the only
# location a global core.hooksPath could have made unreachable. The first
# candidate that can run decides: running two pre-commit hooks in sequence would
# run `git diff --cached` twice and make a failing check hard to attribute.
for candidate in "${candidates[@]}"; do
  if [ -f "$candidate" ] && [ -x "$candidate" ]; then
    if ! KROK_KJEDE=1 "$candidate" "$@"; then
      log "the repository's own pre-commit stopped the commit: $candidate"
      exit 1
    fi
    exit 0
  fi
done

exit 0
