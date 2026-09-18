-- Taamdan (តាមដាន) schema — run this in the Supabase SQL editor

create table if not exists tracked_places (
  id bigint generated always as identity primary key,
  place_id text not null unique,        -- Google place_id, e.g. ChIJM8qG5qs3DDERP162lCD26pY
  category text,                         -- free text, any place type — 'School', 'Market', 'Pagoda', etc.
  label text,                            -- your own note / address
  current_name text,
  last_checked_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists place_name_history (
  id bigint generated always as identity primary key,
  place_id text not null references tracked_places(place_id) on delete cascade,
  old_name text,
  new_name text,
  changed_at timestamptz default now()
);

create index if not exists idx_history_place_id on place_name_history(place_id);
create index if not exists idx_tracked_category on tracked_places(category);
