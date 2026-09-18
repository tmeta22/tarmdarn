-- Taamdan: coordinates for the map view.
-- Populated from Google Places `location` on add / bulk-add / daily check,
-- and backfilled for existing rows via POST /api/places/coordinates.

alter table tracked_places add column if not exists latitude double precision;
alter table tracked_places add column if not exists longitude double precision;

-- The map page asks for "rows still missing coordinates", so index that.
create index if not exists idx_tracked_missing_coords
  on tracked_places(id)
  where latitude is null or longitude is null;
