-- Seed historical rename: place ChIJM8qG5qs3DDERP162lCD26pY
-- Old name "វិទ្យាល័យ បុសខ្នុរ" changed in April 2026.
-- new_name is pulled from the current tracked_places row if present.

insert into place_name_history (place_id, old_name, new_name, changed_at)
select
  'ChIJM8qG5qs3DDERP162lCD26pY',
  'វិទ្យាល័យ បុសខ្នុរ',
  current_name,
  '2026-04-15 00:00:00+07'
from tracked_places
where place_id = 'ChIJM8qG5qs3DDERP162lCD26pY'
on conflict do nothing;
