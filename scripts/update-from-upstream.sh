#!/usr/bin/env bash
#
# Replay this fork's commits onto a newer upstream release.
#
#   scripts/update-from-upstream.sh          # onto the newest upstream tag
#   scripts/update-from-upstream.sh v0.9.4   # onto a specific tag
#
# Deliberately stops short of pushing. A fork's update is a force-push, and the
# rebase can leave the identity or the tests broken in ways only a human should
# sign off on. See FORK.md for what to expect from each conflict.

set -euo pipefail

UPSTREAM_URL="https://github.com/cjpais/Handy.git"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
fail() {
  printf '\033[31m%s\033[0m\n' "$1" >&2
  exit 1
}

# A rebase rewrites history; uncommitted work would be caught in the blast.
if [[ -n "$(git status --porcelain)" ]]; then
  fail "Working tree is dirty. Commit or stash first — a rebase will rewrite history."
fi

if ! git remote get-url upstream >/dev/null 2>&1; then
  bold "Adding upstream remote ($UPSTREAM_URL)"
  git remote add upstream "$UPSTREAM_URL"
fi

bold "Fetching upstream…"
git fetch upstream --tags --quiet

# The nearest tag behind HEAD is the release this fork currently sits on.
CURRENT_BASE="$(git describe --tags --abbrev=0)"
TARGET="${1:-$(git tag -l 'v*' --sort=-v:refname | head -1)}"

if ! git rev-parse -q --verify "refs/tags/$TARGET" >/dev/null; then
  fail "No such tag: $TARGET. Available: $(git tag -l 'v*' --sort=-v:refname | head -5 | tr '\n' ' ')"
fi

if [[ "$TARGET" == "$CURRENT_BASE" ]]; then
  bold "Already on $CURRENT_BASE — nothing to do."
  exit 0
fi

BRANCH="$(git branch --show-current)"
FORK_COMMITS="$(git rev-list --count "$CURRENT_BASE"..HEAD)"
UPSTREAM_COMMITS="$(git rev-list --count "$CURRENT_BASE".."$TARGET")"

echo
bold "Replaying $FORK_COMMITS fork commit(s) from $CURRENT_BASE onto $TARGET"
echo "  branch:            $BRANCH"
echo "  upstream commits:  $UPSTREAM_COMMITS"
echo
echo "Files upstream touched that this fork also touches (expect conflicts here):"
comm -12 \
  <(git diff --name-only "$CURRENT_BASE".."$TARGET" | sort) \
  <(git diff --name-only "$CURRENT_BASE"..HEAD | sort) |
  sed 's/^/  /' || true
echo

# Cheap insurance: the rebase is recoverable from the reflog, but only if you
# know to look. A named branch is easier to reach for at 1am.
BACKUP="backup/pre-$TARGET-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP"
echo "Backup branch: $BACKUP  (git reset --hard $BACKUP to undo everything below)"
echo

if ! git rebase "$TARGET"; then
  echo
  warn "Rebase stopped on a conflict. This is normal — see FORK.md, but in short:"
  warn "  tauri.conf.json  keep the fork's identity, take upstream's \"version\""
  warn "  Cargo.lock       take upstream's wholesale, then rebuild"
  warn "  everything else  read it properly"
  echo
  warn "Then: git rebase --continue   (or: git rebase --abort)"
  warn "Re-run this script afterwards to finish the checks."
  exit 1
fi

echo
bold "Rebase clean. Running the fork guards…"
echo
# These are the point of the exercise. A rebase can silently resolve the fork's
# identity back to upstream's, and nothing at runtime would tell you.
if ! (cd src-tauri && cargo test --lib); then
  echo
  fail "Tests failed after the rebase. Do NOT push. Start with the fork_identity_*
and update_checks_* guards — they fail when a conflict was resolved in
upstream's favour, which silently un-forks this build."
fi

echo
bold "Green on $TARGET. Fork delta is now:"
git log --oneline "$TARGET"..HEAD | sed 's/^/  /'
echo
bold "Next:"
echo "  bunx tauri build --bundles app     # verify it still builds and runs"
echo "  git push --force-with-lease        # only once you're happy"
echo
echo "Backup of the pre-rebase state: $BACKUP"
