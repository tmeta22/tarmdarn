-- Taamdan: additional Google Places API keys.
--
-- A long scan can exhaust one key's quota and then fail every remaining row.
-- Keys added here join the pool in lib/googleKeys.js, which rotates between
-- them, paces requests, and cools a key down when Google pushes back.
--
-- Keys are only ever read server-side. The API returns them masked.

create table if not exists google_api_keys (
  id bigint generated always as identity primary key,
  key text not null unique,
  label text,
  disabled boolean not null default false,
  cooldown_until timestamptz,
  created_at timestamptz default now()
);

-- The pool only ever loads non-disabled keys.
create index if not exists idx_google_api_keys_active
  on google_api_keys(id)
  where disabled = false;
