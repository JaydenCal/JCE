# SEO: spec vs live homepage (index.html, v3g fix7)

**Why there's no patched index.html here:** the Dropbox connector returns HTML as plain text with the tags stripped, and this container can't reach Dropbox download links or glideinside.com.au. A hand-rebuilt 40 KB page would risk breaking the live site. So this folder has a tested patch script instead. It edits only the head tags and the H1 of the real file.

| Item | Spec ("changes to action") | Live now (source and evidence) | Status |
|---|---|---|---|
| `<title>` | Glide Inside, 3D Floor Plans for Real Estate, Regional (54 chars) | "Glide Inside, 3D Floor Plans for Builders and Developers" (56 chars), changed at Jayden's request on 6/10 (Website_Update_v3g.md, "Developers and builders first") | Differs |
| Meta description | 3D fly-through videos and 3D floor plans for real estate agents and builders in regional Australia. $249, pay when you upload. | "3D floor plans, fly-through videos and interactive site models for builders and developers in regional Australia. Volume pricing on request." (same note) | Differs (no $249) |
| H1 (one) | 3D Floor Plans for Real Estate That Buyers Can Walk Through | "3D Floor Plans and Site Models for Builders and Developers" (index.html hero text, built copy) | Differs |
| Builders H2 | Display Home Virtual Tours and Off-the-Plan Fly-Throughs | Same | Pass |
| Agents H2 | 3D Floor Plans for Real Estate Listings | Same | Pass |

## Decide first
The spec copy targets real estate agents. On 6/10 you deliberately moved the homepage to builders and developers first. The Google Ads campaign you're about to publish is **"Regional builders"**, and the current builders-first title and H1 match those ads better (relevance and Quality Score).
- **Recommendation:** keep the live title and H1 while the builders campaign runs. Use this patch if you launch an agents campaign or decide the spec wins.
- **Middle option:** keep the builders H1 but add the price to the meta description, so the search snippet shows "$249, pay when you upload". To do that, edit `DESCRIPTION` in the script and comment out the title and H1 lines.

## How to apply (about 5 minutes, nothing goes live until you upload)
1. cPanel > File Manager > `public_html` > right-click `index.html` > **Download**.
2. Run `python apply_seo_spec.py index.html index.seo.html`. It prints every before/after line, refuses to overwrite anything, and stops if the page doesn't have exactly one H1.
3. Open `index.seo.html` locally to check the hero, then back up the live file (`index.html.bak-2026-10-12`). Upload the new file as `index.html` with permissions 0644.
4. Search Console > URL inspection > `https://glideinside.com.au/` > **Request indexing**.

Tested on a sample page: it replaces `<title>`, the meta description, any og:/twitter: title and description, and the H1 text (keeping its class and id), then confirms both required H2s are present.
