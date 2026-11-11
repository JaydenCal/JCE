#!/usr/bin/env bash
# Merges branches onto claude/glide-release3, re-syncs the portal source, rebuilds the app bundle, runs the tests
# and builds the packages.
#   bash GlideInside/tools/merge-release.sh [--no-tests] origin/claude/glide-website origin/claude/glide-integrate ...
# Run it from the release worktree (e.g. /home/claude/wt-release3) on claude/glide-release3. A conflict stops the script
# so it can be resolved by hand (keep both sides; never hand-merge website-live/portal/src, it is regenerated here);
# resolve, commit, and run the script again (already-merged branches are skipped).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
repo="$(git -C "$root" rev-parse --show-toplevel)"
src="$root/pocket-architect-source"
tests=1; branches=()
for a in "$@"; do [ "$a" = "--no-tests" ] && tests=0 || branches+=("$a"); done
[ "$(git -C "$repo" rev-parse --abbrev-ref HEAD)" = "claude/glide-release3" ] || { echo "check out claude/glide-release3 first" >&2; exit 1; }
[ -z "$(git -C "$repo" status --porcelain --untracked-files=no)" ] || { echo "working tree not clean" >&2; exit 1; }
git -C "$repo" fetch -q origin
trailer=$'\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01AcQqUWYpmQcaYiwB8r1zsn'
for b in "${branches[@]}"; do
  if git -C "$repo" merge-base --is-ancestor "$b" HEAD; then echo "== $b already merged"; continue; fi
  echo "== merging $b"
  if ! git -C "$repo" merge --no-edit -m "Merge ${b#origin/} into release3$trailer" "$b"; then
    echo "CONFLICTS merging $b:" >&2; git -C "$repo" diff --name-only --diff-filter=U >&2
    echo "Resolve keeping both sides, then 'git commit' and rerun. For website-live/portal/src take either side; it is regenerated." >&2
    exit 2
  fi
done
# Dependencies (symlink to the shared install if present, else npm ci)
if [ ! -e "$src/node_modules" ]; then
  shared=/home/claude/wt-staging/GlideInside/pocket-architect-source/node_modules
  if [ -d "$shared" ]; then ln -s "$shared" "$src/node_modules"; else (cd "$src" && npm ci); fi
fi
if [ ! -e "$src/vendor/three" ]; then
  mkdir -p "$src/vendor"
  ln -sfn ../node_modules/jspdf "$src/vendor/jspdf"; ln -sfn ../node_modules/pdfjs-dist "$src/vendor/pdfjs"; ln -sfn ../node_modules/three "$src/vendor/three"
fi
(cd "$src" && node tools/sync-portal.mjs && node tools/build-single.mjs --brand "Pocket Architect" --out "$root/website-live/plan-studio/app/index.html")
if [ "$tests" = 1 ]; then (cd "$src" && node --test tests/*.test.mjs); fi
node "$root/golive/build-live-config.mjs" --check
[ -f "$root/golive/make-upload-zip.sh" ] && bash "$root/golive/make-upload-zip.sh"
[ -f "$root/golive/make-launch-package.sh" ] && bash "$root/golive/make-launch-package.sh"
[ -f "$root/staging/make-package.sh" ] && bash "$root/staging/make-package.sh"
# Commit rebuilt outputs
git -C "$repo" add -A GlideInside
if ! git -C "$repo" diff --cached --quiet; then git -C "$repo" commit -q -m "Release3: re-sync portal, rebuild app bundle and packages$trailer"; fi
git -C "$repo" log --oneline -1
echo "Done. Push with: git push origin claude/glide-release3"
