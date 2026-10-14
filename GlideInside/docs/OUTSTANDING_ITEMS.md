# Outstanding items before launch

## You
1. **Stripe account:** clear the "Action required" banner (identity details), or payments can pause.
2. **Stripe setup:** product "Pocket Architect plan (one job)" A$35 one-off; webhook to `https://glideinside.com.au/api/stripe/webhook` (`checkout.session.completed`, `charge.refunded`); turn on "Successful payments" emails. Steps in `docs/STRIPE_AND_LAUNCH_BRIEF.md`.
3. **Add-on Payment Links:** A$5 fly-through, A$10 renderings, A$15 both. Paste the `buy.stripe.com` URLs into `site.config.js` (`stripeFlyThrough`, `stripeRenders`, `stripeBoth`).
4. **Deploy the server** (`server/`, Cloudflare Workers + D1 + R2) with secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ENTITLEMENT_SECRET`, `STRIPE_PRICE_ID`, and `TEST_CODES` for your friends code (`PA-FRIENDS-4818BD73`). Test in Stripe test mode first.
5. **GST:** the app says "incl. GST". Tell me if you are not registered.
6. **Blender renders:** send single shots of the finished house (and subdivision if wanted) and they replace `assets/living.webp`, `kitchen.webp`, `aerial.webp`, which are the previous Glide Inside renders used in the video and gallery.
7. **Updated Plan Studio build:** run `python3 tools/install_app.py <file>`, then re-upload `site/plan-studio/app/index.html`.
8. **Quote and contact:** the "Request a quote" and "Contact" buttons open an email to hello@glideinside.com.au. Replace with a form if you want.
9. **Existing live pages:** `services/` pages, `terms.html`, `privacy.html` and the old A$249 fly-through page still exist on the live site. Update terms and privacy for Pocket Architect, A$35 pricing, the one-PDF-set rule and refunds.

## Build (needs extra work)
- **Server exports:** PDF, DXF and 3D file generation on the server needs the exporter modules from the app package. Until then the server refuses cleanly and does not use up the job's PDF set.
- **AI assistant:** shows unavailable until the AI endpoint and `ANTHROPIC_API_KEY` are added.
- **Zip save and load of jobs:** the current build saves and opens `.json` project files. A zip of all job files is an app change.
- **2D to 3D tab:** shows the warehouse model. A house model is needed to show a house there.
- **Plan studio app inside the online preview:** loads through a workaround there. On your own hosting it loads directly.
- **Not tested here:** full-screen buttons, live Stripe checkout, mobile layout of the new video.
