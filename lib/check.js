import { supabase } from "./supabase";
import { getPlaceName } from "./places";

// The check now runs at a paced rate (lib/googleKeys), so the whole list can
// no longer be walked inside a serverless function timeout. Least-recently
// checked places go first, which means a run that stops early simply
// resumes on the next one instead of starving the same rows every day.
const BUDGET_MS = Number(process.env.CHECK_BUDGET_MS) || 35_000;

// Waiting out a key cooldown is not worth being killed for here — hand the
// row back as retryable instead.
const COOLDOWN_WAIT_MS = 5_000;

/**
 * Checks tracked places against Google: records renames, refreshes
 * coordinates, and reports per place whether anything changed, whether the
 * place_id is gone, or whether the lookup failed.
 *
 * Shared by the scheduled cron job and the manual "Check now" action so the
 * two can never drift apart.
 *
 * @returns {Promise<{results: Array, skipped: number}>} `skipped` counts
 *   places left for the next run because the time budget ran out.
 */
export async function runPlaceCheck({ budgetMs = BUDGET_MS } = {}) {
  const db = supabase();
  const { data: places, error } = await db
    .from("tracked_places")
    .select("*")
    .order("last_checked_at", { ascending: true, nullsFirst: true });
  if (error) throw new Error(error.message);

  const deadline = Date.now() + budgetMs;
  const results = [];
  let skipped = 0;

  for (const place of places || []) {
    if (Date.now() >= deadline) {
      skipped = (places?.length || 0) - results.length;
      break;
    }

    try {
      const { name, latitude, longitude } = await getPlaceName(place.place_id, {
        maxCooldownWaitMs: COOLDOWN_WAIT_MS,
      });
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
        error: gone ? undefined : String(err?.message || err),
        retryable: Boolean(err?.retryable),
      });
    }
  }

  return { results, skipped };
}
