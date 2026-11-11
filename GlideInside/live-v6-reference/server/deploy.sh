#!/usr/bin/env bash
# Pocket Architect API: one-time setup and deploy. Run from the server/ folder: bash deploy.sh
# Wrangler asks you to log in to Cloudflare in your browser, then prompts for each secret (paste it, press Enter).
set -euo pipefail
cd "$(dirname "$0")"
npm install --no-audit --no-fund
npx wrangler login
if [ ! -f wrangler.toml ]; then
  cp wrangler.toml.example wrangler.toml
  npx wrangler d1 create pocket-architect | tee /tmp/d1.txt
  ID=$(grep -o '"\?database_id"\? *[=:] *"[^"]*"' /tmp/d1.txt | grep -o '[0-9a-f-]\{36\}' | head -1)
  [ -n "$ID" ] || { echo "Copy the database_id above into wrangler.toml, then re-run."; exit 1; }
  sed -i.bak "s/PASTE_ID/$ID/" wrangler.toml
  npx wrangler r2 bucket create pocket-architect-files
  npx wrangler d1 execute pocket-architect --remote --file=schema.sql
fi
for S in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_PRICE_ID ANTHROPIC_API_KEY; do
  read -r -p "Set $S now? [y/N] " a; [[ "$a" =~ ^[Yy]$ ]] && npx wrangler secret put "$S"
done
EXISTING=$(npx wrangler secret list 2>/dev/null || true)
for S in ENTITLEMENT_SECRET IP_HASH_SALT; do
  if echo "$EXISTING" | grep -q "\"$S\""; then echo "$S already set, keeping it (changing it would log out paid customers)."; continue; fi
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put "$S"
done
node test/worker.test.mjs
npx wrangler deploy
echo "Deployed. Check: https://glideinside.com.au/api/health"
