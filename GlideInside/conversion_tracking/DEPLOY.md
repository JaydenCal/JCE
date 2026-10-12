# Glide Inside: deploy Google Ads conversion tracking

Prepared 12/10/2026. Nothing has been uploaded. **You** do the upload.

## What changes
| File (in this folder) | Goes to | What it does |
|---|---|---|
| `launch-config.json` | `public_html/launch-config.json` (replace) | Turns on `adsEnabled` and adds the tag ID, an `upload_started` label and a `purchase` label. **They're placeholders until you paste the real values.** |
| `analytics-ready.js` | `public_html/analytics-ready.js` (replace) | Based on the live v3g copy. Adds the **upload_started** conversion: it fires once per tab the first time someone uses the order form. The **purchase** conversion on `order-confirmed.html` (A$249, `transaction_id` = order ref GI-YYYYMMDD-XXXXX) now counts only a real order from that tab, once per order. A direct visit or a reload no longer counts. It still loads the Google tag **only** when `adsEnabled` is `true` and the tag ID is a real `AW-` number. |

No HTML file needs to change. `index.html` already loads `analytics-ready.js` (as `?v=4`), and `script.js` already fires the form-start and checkout events. Nothing else is touched. Do not upload `.htaccess`, `.user.ini` or `contact-config.php`.

## Step 1: create the two conversion actions (Google Ads 740-317-4697)
**Goals > Conversions > Summary > + New conversion action > Website > Add a conversion action manually**
1. **Glide Inside - Purchase**: Category *Purchase*. Value *Use different values for each conversion*, default 249, AUD. Count *One*. Click-through window 30 days. Set as **Primary**.
2. **Glide Inside - Upload started**: Category *Begin checkout*. *Don't use a value*. Count *One*. Set as **Secondary**, so it's reported but doesn't drive bidding.

For each action, open **Tag setup > Install the tag yourself**. The event snippet contains `'send_to': 'AW-123456789/AbCdEfGhIjK'`:
- `AW-123456789` is the **tag ID** (the same for both actions).
- `AbCdEfGhIjK` is that action's **label**.

## Step 2: paste the real IDs
Edit `launch-config.json` in this folder:
```
"adsTagId": "AW-XXXXXXXXXX",                          -> your AW- tag ID
"adsUploadStartedConversionLabel": "PASTE_UPLOAD_STARTED_LABEL", -> label of "Upload started"
"adsPurchaseConversionLabel": "PASTE_PURCHASE_LABEL",            -> label of "Purchase"
```
Keep the quotes and commas. The `_JAYDEN_READ_ME` line can stay; the site ignores it. If a placeholder is left in, the tag stays off and nothing breaks.

## Step 3: upload in cPanel (VentraIP, account `glideins`)
1. cPanel > **File Manager** > `public_html`.
2. First, back up the live copies: right-click `launch-config.json` > Copy to `launch-config.json.bak-2026-10-12`, and do the same for `analytics-ready.js`.
3. **Upload** the two files from this folder and overwrite the live ones.
4. Select both > **Permissions** > **0644** (Owner read/write, Group read, World read).
5. Check `order-confirmed.html` loads the script: right-click > **View**, then search for `analytics-ready.js`.
   - If it's missing, **Edit** the file and add this line just before `</body>`:
     `<script type="module" src="analytics-ready.js?v=5"></script>`
   - Otherwise leave the file alone.
6. Optional (avoids a 1-day browser cache for returning visitors): edit `index.html` and change `analytics-ready.js?v=4` to `analytics-ready.js?v=5`. Change nothing else.

**Roll back:** rename the `.bak-2026-10-12` files back over the new ones.

## Step 4: test with Google Tag Assistant
1. In desktop Chrome, open https://tagassistant.google.com > **Add domain** > `https://glideinside.com.au` > Connect. The site opens in a new tab with the debugger attached.
2. Homepage: Tag Assistant should show **Google tag AW-...** loaded. If it shows "No tags found", check that `adsEnabled` is `true`, the ID has no typo, and you hard-refreshed (Ctrl+Shift+R).
3. Click into the order form's Name field. You should see a **Conversion** event with `send_to AW-.../<upload label>`. Click again: no second event.
4. Purchase test, without paying:
   - In the same tab, open DevTools Console and run
     `sessionStorage.setItem('glideinside-order', JSON.stringify({ref:'GI-20261012-TEST1'}))`
   - Then open https://glideinside.com.au/order-confirmed.html. You should see **Conversion** with `value 249`, `currency AUD`, `transaction_id GI-20261012-TEST1`. Reload: no second conversion.
   - This counts as one test conversion in Google Ads. Ignore it, or use a real A$249 order and refund it in Stripe.
   - The page will also try to send a confirmation email. With a fake ref the signature fails, so no email is sent.
5. Google Ads > Goals > Conversions: the status changes from *Unverified* to *Recording conversions* within about 3 to 24 hours.

## Notes
- Uploading the new `analytics-ready.js` before pasting the IDs is harmless: the tag stays off.
- The privacy policy already says Google Ads cookies are used when measurement is on (privacy.html, "What we collect").
- Stripe must keep returning customers to `https://glideinside.com.au/order-confirmed.html` in the same tab. That's the current Payment Link setting (Website_Update_v3g.md, "Stripe"). If you change the Payment Link, check this setting again.
