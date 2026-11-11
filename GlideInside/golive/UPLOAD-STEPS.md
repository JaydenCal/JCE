# Website upload to cPanel (VentraIP account `glideins`)

Do this AFTER `RUN-LIVE-DEPLOY.cmd` says PASS (the new Worker is live first, then the new site, in a quiet period). About 15 minutes.

Which file: `golive\glideinside-site-upload.zip` (only the changed and new files, listed in `UPLOAD_FILES.txt`). Do not use `glideinside-site-full.zip` over the live site.
Never upload or overwrite `.htaccess`, `.user.ini` or `contact-config.php` (neither zip contains them).
Never delete `subdivision/`. It is not in the zip and the live copy is newer than the repo. Step 6 changes only its header and footer.

## Checklist

1. **Backup exists.** The backup taken on 11/11/2026 (`public_html_backup_2026-11-11_golive.zip`, moved to `/home/glideins/backups/`) is the rollback point. Check it is still there. If anything on the live site changed since (for example a new `subdivision/` edit), take a fresh one: File Manager, public_html, **Compress**, tick all, Zip Archive, name `public_html_backup_<date>_golive2.zip`, then move it to `/home/glideins/backups/`.
2. **Settings.** File Manager, **Settings** (top right), tick **Show Hidden Files (dotfiles)**, Save.
3. **analytics.js check.** Download the live `analytics.js` first. The live copy was patched on 11/11/2026 for a GA4 Book a demo event. The zip copy sends `book_demo` for every Book a demo and Register interest button. If the live file has any other change, keep it and add it to the new file before step 4.
4. **Upload.** Click **Upload**, drag `glideinside-site-upload.zip` into the box, wait for 100%, **Go Back**.
5. **Extract over the top.** Right-click the zip in public_html, **Extract**, path `/public_html` (leave as is), **Extract File(s)**, say yes to overwrite, **Close**. Then delete the zip from public_html. Do not delete any folder.
6. **Subdivision header and footer (reskin).** Needed because the page is not in the zip.
   1. cPanel File Manager, open `public_html/subdivision/`, right-click `index.html`, **Download**. Keep that file as the backup too.
   2. Put it at `C:\Users\<YOU>\Downloads\sub\index.html`.
   3. Double-click `RUN-RESKIN-SUBDIVISION.cmd` (same as `node tools\reskin-subdivision.mjs <in> <out>` from `pocket-architect-source`). It writes `Downloads\sub\index.new.html` and prints what it replaced. A line starting `WARNING other ABN` means old ABN text sits in the page body: edit that by hand (the footer is already correct).
   4. Check `public_html/assets/gi-chrome.css` exists (it comes from the zip in step 5).
   5. In `public_html/subdivision/`: upload `index.new.html`, rename live `index.html` to `index.html.bak-2026-11-12`, then rename `index.new.html` to `index.html`. Delete nothing.
7. **Purge Cloudflare cache.** Cloudflare dashboard, `glideinside.com.au`, **Caching > Configuration > Purge Everything**. Do it once after step 6 (not before it).
8. **Check the 8 key pages.** Double-click `RUN-LIVE-SMOKE.cmd` (runs `smoke-live.ps1 -Pages`; all lines must be PASS). Then look at each in a private window:

| # | Page | Must show |
|---|---|---|
| 1 | https://glideinside.com.au/ | Hero says "Setbacks drawn from council or state code rules" |
| 2 | https://glideinside.com.au/plans/ | No "Free to draw" near the top |
| 3 | https://glideinside.com.au/pricing/ | A$30 Plan Pack, builder client login tiers, tab title without the price |
| 4 | https://glideinside.com.au/for-builders/ | Free 14 day trial form (`#trial`) |
| 5 | https://glideinside.com.au/plan-studio/launch/ | Launch the tool button, then Find my block in the top bar |
| 6 | https://glideinside.com.au/plan-studio/app/ | App opens with Find my block, no console errors |
| 7 | https://glideinside.com.au/portal/ | Builder sign in page |
| 8 | https://glideinside.com.au/subdivision/ | New header, footer and mobile menu; page content unchanged |

## If something is wrong

- Site: upload the backup zip back into public_html and **Extract** with overwrite, restore `subdivision/index.html` from `index.html.bak-2026-11-12`, purge the cache.
- Worker: `golive\ROLLBACK-LIVE.cmd` (written by the deploy) or see GO-LIVE.md Section 11.
