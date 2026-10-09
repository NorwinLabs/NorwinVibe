-- Anonymous usage numbers. One row per install (a random id the app made up), nothing else about the person.
CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,   -- ms since 1970
  last_seen INTEGER NOT NULL,
  platform TEXT NOT NULL,        -- win | android
  version TEXT NOT NULL,
  country TEXT,                  -- two letters, worked out by Cloudflare from the connection (the address itself is never stored)
  opens INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_installs_last ON installs (last_seen);
-- Which installs were active on which day (for the daily chart)
CREATE TABLE IF NOT EXISTS active_days (day TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (day, id));
