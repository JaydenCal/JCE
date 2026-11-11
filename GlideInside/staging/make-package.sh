#!/usr/bin/env bash
# Rebuilds staging/glideinside-staging.zip (run from anywhere in the repo; needs node, npm and zip).
#   bash GlideInside/staging/make-package.sh
# Rebuild after merging other branches so the zip carries the newest server code and site.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
[ -d "$root/pocket-architect-source/node_modules/esbuild" ] || (cd "$root/pocket-architect-source" && npm ci)
node "$here/build-staging-site.mjs"
tmp="$(mktemp -d)"; pkg="$tmp/glideinside-staging/GlideInside"
mkdir -p "$pkg/staging" "$pkg/pocket-architect-source"
cp "$here"/{deploy-staging.ps1,wrangler.staging.toml,build-staging-site.mjs,STAGING.md,package.json,package-lock.json,.gitignore} "$pkg/staging/"
sed -i 's/^database_id = .*/database_id = "00000000-0000-0000-0000-000000000000"/' "$pkg/staging/wrangler.staging.toml"
cp "$root/pocket-architect-source"/{package.json,package-lock.json} "$pkg/pocket-architect-source/"
cp -r "$root/pocket-architect-source/server" "$root/pocket-architect-source/src" "$pkg/pocket-architect-source/"
rm -f "$pkg/pocket-architect-source/server/"*.example "$pkg/pocket-architect-source/server/schema.sql" 2>/dev/null || true
cp -r "$root/website-live-staging" "$pkg/website-live-staging"
rm -f "$here/glideinside-staging.zip"
(cd "$tmp" && zip -qr "$here/glideinside-staging.zip" glideinside-staging)
rm -rf "$tmp"
ls -l "$here/glideinside-staging.zip"
