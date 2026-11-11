#!/usr/bin/env bash
# Refreshes golive/glideinside-site-upload.zip from website-live/ using the file list already in the zip
# (every entry is re-read from website-live, so rebuilt pages and the plan-studio app bundle are picked up).
#   bash GlideInside/golive/make-upload-zip.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
zip_path="$here/glideinside-site-upload.zip"
list="$(mktemp)"
unzip -Z1 "$zip_path" | grep -v '/$' > "$list"
missing=0
while read -r f; do [ -f "$root/website-live/$f" ] || { echo "missing in website-live: $f" >&2; missing=1; }; done < "$list"
[ "$missing" = 0 ] || exit 1
rm -f "$zip_path"
(cd "$root/website-live" && zip -q "$zip_path" -@ < "$list")
rm -f "$list"
ls -l "$zip_path"
