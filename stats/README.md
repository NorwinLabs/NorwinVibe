# NorwinVibe stats (installs, active users, downloads)

A tiny Cloudflare Worker + D1 database. The apps send it an anonymous "hello"; you look at one private page.

**What you get on the dashboard** (`https://<your-worker>.workers.dev/dashboard?key=<your key>`):
online now (seen in the last 10 minutes), active today / this week / this month, installs all time and new ones, a 30-day chart, platform /
version / country breakdowns, and release downloads (the Windows installer and the Android APK from your GitHub releases page; Windows
auto-updates are counted separately so they do not inflate the numbers). `/stats?key=...` gives the same as JSON. Optionally a short
summary email every day.

**What the apps send** (only if you set `statsUrl`, and only while "Share anonymous usage numbers" is on in Settings > About):
a random id the app made up, the app version, `win` or `android`. The country is worked out by Cloudflare from the connection; the IP
address is never stored. No songs, no names, no emails.

## Set up (about 10 minutes)

```
cd stats && npm install
npx wrangler d1 create norwinvibe-stats                     # paste the database_id into wrangler.toml
npx wrangler d1 execute norwinvibe-stats --remote --file=schema.sql
npx wrangler secret put STATS_KEY                           # a long random password for the dashboard
npx wrangler deploy                                         # prints the worker's address
```

1. Open `https://<that address>/dashboard?key=<your STATS_KEY>` and bookmark it (it shows zeros until the apps report).
2. Put `https://<that address>` as `statsUrl` in `store.config.json`, then ship a new build. Installed copies start reporting after they update.
3. Daily email (optional): set `REPORT_EMAIL` in `wrangler.toml`, `FROM_EMAIL` to a sender verified in Resend, and
   `npx wrangler secret put RESEND_API_KEY`.

`npm test` runs the service against a real SQLite database with GitHub faked.

## Good to know

- "Installs" counts apps that have opened at least once: people who reinstall (or clear the app's data) get a new random id and count again.
  "Downloads" are release-file downloads from GitHub; they include people who never open the app.
- Counting an anonymous random id can still count as personal data in some countries (the EU, for example). The setting is on by default
  with a plain explanation; if you would rather ask first, change `stats: true` to `false` in `main.js` and `mobile/src/mobile.js`
  (DEFAULTS), and add a line about it to your privacy policy.
