#!/usr/bin/env bash
# Rebuilds the go live upload pack from GlideInside/website-live:
#   glideinside-site-full.zip    every site file (reference copy)
#   glideinside-site-upload.zip  the files to upload over the live site
#   UPLOAD_FILES.txt             the list of files in the upload zip
# Both zips leave out subdivision/ (keep the live page), _review/, _review-shots/ and the server only files
# (.htaccess, .user.ini, contact-config.php), plus dotfiles and editor backups.
# The upload set is: the files in upload-base.txt (the 11/11/2026 pack, measured against the live site)
# plus every site file changed or added since BASE_REF (default a7e153a, the commit that built that pack).
# Usage: bash GlideInside/golive/make-upload-zip.sh [BASE_REF]      (rerun after merging the app bundle)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE="$(cd "$HERE/../website-live" && pwd)"
REPO="$(git -C "$SITE" rev-parse --show-toplevel)"
BASE_REF="${1:-a7e153a}"
REL_SITE="${SITE#"$REPO"/}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

exclude() { grep -Ev '^(subdivision/|_review/|_review-shots/)|(^|/)\.htaccess$|(^|/)\.user\.ini$|(^|/)contact-config\.php$|(^|/)\.[^/]+$|~$|\.bak$|\.orig$|\.reskinned\.html$|(^|/)node_modules/' || true; }

( cd "$SITE" && find . -type f | sed 's#^\./##' | exclude | LC_ALL=C sort ) > "$TMP/all.txt"

{
  # carried forward from the earlier pack (the setbacks placeholder line expands to the council files)
  sed 's/\r$//' "$HERE/upload-base.txt" | while IFS= read -r l; do
    case "$l" in
      ''|'#'*) ;;
      *'<'*'council files>'*) ( cd "$SITE" && ls plan-studio/data/setbacks/*.json 2>/dev/null ) ;;
      *) echo "$l" ;;
    esac
  done
  # changed or added in git since BASE_REF, and anything not yet committed
  git -C "$REPO" diff --name-only "$BASE_REF" -- "$REL_SITE" | sed "s#^$REL_SITE/##"
  git -C "$REPO" ls-files --others --exclude-standard -- "$REL_SITE" | sed "s#^$REL_SITE/##"
} | exclude | LC_ALL=C sort -u > "$TMP/want.txt"
# keep only files that exist in the site now
LC_ALL=C comm -12 "$TMP/all.txt" "$TMP/want.txt" > "$TMP/upload.txt"

rm -f "$HERE/glideinside-site-full.zip" "$HERE/glideinside-site-upload.zip"
( cd "$SITE" && zip -q -X -9 "$HERE/glideinside-site-full.zip" -@ < "$TMP/all.txt" )
( cd "$SITE" && zip -q -X -9 "$HERE/glideinside-site-upload.zip" -@ < "$TMP/upload.txt" )

{
  echo "# Files in glideinside-site-upload.zip, built $(date +%d/%m/%Y) from $(git -C "$REPO" rev-parse --short HEAD) (base $BASE_REF)."
  echo "# Extract into public_html. Do not upload subdivision/, .htaccess, .user.ini or contact-config.php."
  grep -v '^plan-studio/data/setbacks/' "$TMP/upload.txt"
  n=$(grep -c '^plan-studio/data/setbacks/' "$TMP/upload.txt" || true)
  [ "$n" -gt 0 ] && echo "plan-studio/data/setbacks/<$((n-2)) council files>.json (plus index.json and fallbacks.json)"
} > "$HERE/UPLOAD_FILES.txt"

echo "full:   $(wc -l < "$TMP/all.txt") files, $(du -h "$HERE/glideinside-site-full.zip" | cut -f1)"
echo "upload: $(wc -l < "$TMP/upload.txt") files, $(du -h "$HERE/glideinside-site-upload.zip" | cut -f1)"
