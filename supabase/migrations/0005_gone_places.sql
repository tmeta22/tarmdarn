-- Taamdan: remember which tracked places Google has stopped serving.
--
-- A Place Details lookup for a delisted place_id answers 404. That used to be
-- counted in a Telegram summary and then forgotten — nothing recorded when the
-- place disappeared, so there was no way to see how long it had been missing
-- or to come back to it later.
--
-- gone_at is stamped the first time Google says the place_id is no longer
-- valid, and cleared again if the place ever comes back. last_seen_at is the
-- last time Google still confirmed it, which is the honest "last seen" date
-- for a place that is now gone.

alter table tracked_places
  add column if not exists gone_at timestamptz,
  add column if not exists last_seen_at timestamptz;

-- The gone report reads exactly the rows that have gone_at set.
create index if not exists idx_tracked_gone_at
  on tracked_places(gone_at desc)
  where gone_at is not null;
