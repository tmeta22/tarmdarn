import { supabase } from "./supabase";
import { getPlaceName } from "./places";

/**
 * Checks every tracked place against Google: records renames, refreshes
 * coordinates, and reports per place whether anything changed, whether the
 * place_id is gone, or whether the lookup failed.
 *
 * Shared by the scheduled cron job and the manual "Check now" action so the
 * two can never drift apart.
 *
 * @returns {Promise<Array<{place_id, label, name, oldName, changed, gone, error}>>}
 */
export async function runPlaceCheck() {
  const db = supabase();
  const { data: places, error } = await db.from("tracked_places").select("*");
  if (error) throw new Error(error.message);

  const results = [];

  for (const place of places || []) {
    try {
      const { name, latitude, longitude } = await getPlaceName(place.place_id);
      const changed =
        Boolean(name) && Boolean(place.current_name) && name !== place.current_name;

      if (changed) {
        await db.from("place_name_history").insert({
          place_id: place.place_id,
          old_name: place.current_name,
          new_name: name,
        });
      }

      const patch = { current_name: name, last_checked_at: new Date().toISOString() };
      // Keep coordinates fresh, and fill them in for rows that predate the
      // map view.
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        patch.latitude = latitude;
        patch.longitude = longitude;
      }

      await db.from("tracked_places").update(patch).eq("place_id", place.place_id);

      results.push({
        place_id: place.place_id,
        label: place.label,
        name,
        oldName: place.current_name,
        changed,
      });
    } catch (err) {
      // A 404 means Google no longer serves this place_id — worth calling
      // out separately from a transient network/API failure.
      const gone = err?.status === 404;
      results.push({
        place_id: place.place_id,
        label: place.label,
        oldName: place.current_name,
        gone,
        error: String(err?.message || err),
      });
    }
  }

  return results;
}
