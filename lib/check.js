import { supabase } from "./supabase";
import { getPlaceName } from "./places";

// The check runs at a paced rate (lib/googleKeys), which puts a hard floor on
// how long a full sweep takes: 186 places at 5 requests/sec is ~37s. The
// budget sits above that so a healthy run covers everything, while still
// stopping before the 60s function limit rather than being killed mid-run —
// a killed run sends no notification at all.
const BUDGET_MS = Number(process.env.CHECK_BUDGET_MS) || 45_000;

// Waiting out a key cooldown is not worth being killed for here — hand the
// row back as retryable instead.
const COOLDOWN_WAIT_MS = 5_000;

// Sequential awaits were paying each place's full network latency on top of
// the pacing gap, which is why a production run only got through ~92 places.
// Overlapping a few lookups hides that latency; the shared limiter still
// decides the actual send rate, so this does not increase load on Google.
const CONCURRENCY = Number(process.env.CHECK_CONCURRENCY) || 4;

/** Look up one place and persist whatever changed. Never throws. */
async function checkPlace(db, place) {
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

    return {
      place_id: place.place_id,
      label: place.label,
      name,
      oldName: place.current_name,
      changed,
    };
  } catch (err) {
    // A 404 means Google no longer serves this place_id — worth calling
    // out separately from a transient network/API failure.
    const gone = err?.status === 404;
    return {
      place_id: place.place_id,
      label: place.label,
      oldName: place.current_name,
      gone,
      error: gone ? undefined : String(err?.message || err),
      retryable: Boolean(err?.retryable),
    };
  }
}

/**
 * Checks tracked places against Google: records renames, refreshes
 * coordinates, and reports per place whether anything changed, whether the
 * place_id is gone, or whether the lookup failed.
 *
 * Shared by the scheduled cron job and the manual "Check now" action so the
 * two can never drift apart.
 *
 * Places are walked least-recently-checked first, so if the budget does run
 * out the leftover rows are the ones that most need attention next time.
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

  const list = places || [];
  const deadline = Date.now() + budgetMs;
  const results = [];
  let next = 0;

  async function worker() {
    while (next < list.length) {
      if (Date.now() >= deadline) return;
      results.push(await checkPlace(db, list[next++]));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, list.length) }, () => worker())
  );

  return { results, skipped: list.length - results.length };
}
