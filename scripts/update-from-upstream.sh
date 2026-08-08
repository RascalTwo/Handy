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

# Everything that has to hold before this fork is safe to push or install.
#
# This runs after a clean rebase — and also when the rebase is *already* done. A
# conflicted update finishes by re-running this script, so "already on the
# target" has to mean "verify it", not "nothing to do". It used to mean the
# latter, which quietly skipped every guard below on exactly the updates that
# needed them most.
verify() {
  if [[ "$OSTYPE" == darwin* ]]; then
    # The dedicated signing keychain locks on reboot, and codesign only fails
    # once the bundle is assembled — i.e. after a full LTO build has been spent.
    # Unlocking up front is instant and turns that into a non-event.
    security unlock-keychain -p handy-local-signing handy-signing.keychain 2>/dev/null ||
      warn "Could not unlock handy-signing.keychain — signing may fail. See FORK.md."
  fi

  bold "Running the fork guards…"
  echo
  # These are the point of the exercise. A rebase can silently resolve the fork's
  # identity back to upstream's, and nothing at runtime would tell you.
  if ! (cd src-tauri && cargo test --lib); then
    echo
    fail "Tests failed. Do NOT push. Start with the fork_identity_* and
update_checks_* guards — they fail when a conflict was resolved in upstream's
favour, which silently un-forks this build."
  fi

  if [[ "$OSTYPE" != darwin* ]]; then
    echo
    warn "Not macOS — skipping the build and signature check."
    return
  fi

  echo
  bold "Building…"
  # Upstream churns package.json/bun.lock, so a rebase can leave deps stale.
  bun install
  # `tauri build` runs `bun run build` (tsc && vite build) first, so this is also
  # the typecheck — which is what catches a src/bindings.ts conflict resolved
  # into a shape the Rust types don't actually declare.
  bunx tauri build --bundles app || fail "Build failed. Do NOT push."

  # A codesign failure still leaves a plausible-looking .app behind, reporting
  # the right version and carrying the linker's ad-hoc signature. Ad-hoc pins the
  # Accessibility grant to the cdhash, which changes every rebuild — the wedged-
  # permission trap FORK.md devotes a section to. Nothing else here catches it.
  local app
  app="$(echo src-tauri/target/release/bundle/macos/*.app)"
  if ! codesign -d -r- "$app" 2>&1 | grep -q 'certificate leaf'; then
    fail "$app is ad-hoc signed, not signed with the fork identity.
Accessibility will break on the next rebuild. Unlock handy-signing.keychain,
then re-run this script — see FORK.md."
  fi
  echo
  bold "Signed with the fork identity."
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
  bold "Already on $CURRENT_BASE — nothing to rebase, verifying instead."
  echo
  verify
  echo
  bold "Next:"
  echo "  git push --force-with-lease        # only once you're happy"
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
# Per-commit union on the fork side, deliberately not a net diff. A rebase
# replays each commit, so a file one fork commit adds and a later one reverts
# still conflicts twice — while netting to zero and vanishing from a range diff.
# src/bindings.ts is exactly that file, and it's the dangerous one to resolve.
OVERLAP="$(comm -12 \
  <(git diff --name-only "$CURRENT_BASE".."$TARGET" | sort -u) \
  <(git log --format= --name-only "$CURRENT_BASE"..HEAD | sort -u))"
grep -v '^src/i18n/locales/' <<<"$OVERLAP" | sed 's/^/  /' || true
# Translations are bulk churn upstream and always auto-merge; listing all ~25
# buries the two files that actually need a human.
I18N="$(grep -c '^src/i18n/locales/' <<<"$OVERLAP" || true)"
if [[ "$I18N" -gt 0 ]]; then
  echo "  (+ $I18N translation file(s) under src/i18n/locales/ — these auto-merge)"
fi
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
  warn "  src/bindings.ts  generated: take upstream's shape, then re-add the"
  warn "                   fork's own keys. Taking it wholesale drops them with"
  warn "                   no error — it only regenerates under \`tauri dev\`."
  warn "  Cargo.lock       take upstream's wholesale, then rebuild"
  warn "  everything else  read it properly"
  echo
  warn "Then: git rebase --continue   (or: git rebase --abort)"
  warn "Re-run this script afterwards to finish the checks."
  exit 1
fi

echo
bold "Rebase clean."
echo
verify

echo
bold "Green on $TARGET. Fork delta is now:"
git log --oneline "$TARGET"..HEAD | sed 's/^/  /'
echo
bold "Next:"
echo "  git push --force-with-lease        # only once you're happy"
echo
echo "Backup of the pre-rebase state: $BACKUP"
