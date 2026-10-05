# License Worker (Stripe -> signed key -> email)

Sells Pro ($4.99) and the theme packs ($0.99). After a Stripe payment this Cloudflare Worker signs a license key with
your private key (same format as `scripts/make-license.js`) and emails it to the buyer. The app already verifies these
keys, so nothing in the app changes except the checkout links.

## One-time setup

1. **Keys** (skip if done): `node scripts/gen-keys.js` creates `licensing/public.pem` (ships in the app) and
   `.licensing/private.pem` (secret, never commit).
2. **Stripe**: create three Payment Links (Pro, Cyberpunk, Night City). On each, add metadata `item` = `pro`,
   `cyberpunk` or `nightcity`, and set "After payment > Don't show confirmation page, redirect" to
   `https://<your-worker>.workers.dev/thanks?session_id={CHECKOUT_SESSION_ID}`.
3. **Resend** (resend.com): verify a sending domain, create an API key, set `FROM_EMAIL` in `wrangler.toml`.
4. **Deploy**:
   ```
   cd worker && npm install
   npx wrangler kv namespace create KEYS        # paste the id into wrangler.toml
   npx wrangler secret put LICENSE_PRIVATE_KEY  # paste the contents of .licensing/private.pem
   npx wrangler secret put RESEND_API_KEY
   npx wrangler deploy
   ```
5. **Stripe webhook**: Developers > Webhooks > add `https://<your-worker>.workers.dev/stripe-webhook` for
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`, then
   `npx wrangler secret put STRIPE_WEBHOOK_SECRET` with its `whsec_...`.
6. **App**: put each Payment Link URL in `store.config.json` (`checkoutUrl`) and ship a new build.

Pro includes every theme pack. Check it end to end in Stripe test mode first (card 4242 4242 4242 4242).
`npm test` checks the signing and webhook-signature code locally.
