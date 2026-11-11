#!/usr/bin/env bash
# Builds golive/glideinside-launch-package.zip, the folder shipped to the owner's PC for the live launch:
# the whole golive/ folder (with the rebuilt upload zip), the server with ALL migrations, wrangler.toml, the
# subdivision reskin tool and chrome, and package.json plus lockfile.
#   bash GlideInside/golive/make-launch-package.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
src="$root/pocket-architect-source"
[ -d "$src/server/migrations" ] || { echo "no migrations folder" >&2; exit 1; }
n="$(ls "$src/server/migrations"/*.sql | wc -l)"
[ "$n" -ge 10 ] || { echo "expected migrations 0001 to 0010 or later, found $n" >&2; exit 1; }
node "$here/build-live-config.mjs" --check
tmp="$(mktemp -d)"; pkg="$tmp/glideinside-launch/GlideInside"
mkdir -p "$pkg/pocket-architect-source/tools"
cp -r "$here" "$pkg/golive"
rm -f "$pkg/golive/glideinside-launch-package.zip"
cp -r "$src/server" "$pkg/pocket-architect-source/server"
rm -f "$pkg/pocket-architect-source/server/"*.example 2>/dev/null || true
cp "$src"/{wrangler.toml,package.json,package-lock.json} "$pkg/pocket-architect-source/"
cp "$src/tools/reskin-subdivision.mjs" "$pkg/pocket-architect-source/tools/"
cp -r "$src/tools/subdivision-chrome" "$pkg/pocket-architect-source/tools/"
out="$here/glideinside-launch-package.zip"
rm -f "$out"
(cd "$tmp" && zip -qr "$out" glideinside-launch)
rm -rf "$tmp"
ls -l "$out"
