import { waitUntil } from "@vercel/functions";
import { supabase, selectAll } from "./supabase";
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

  // Paged. A bare select stops at 1000 rows, which meant that past 1000
  // tracked places the rest were never checked at all — not even on the
  // rotation, because they were never in the list to begin with.
  const list = await selectAll(() =>
    db
      .from("tracked_places")
      .select("*")
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
  );

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

// ---------------------------------------------------------------------------
// Sweep orchestration
//
// Pacing caps one run at roughly 225 places, and a function cannot outlive its
// own time limit, so covering the whole table takes several runs. Each run
// hands the next one off and only the last one notifies — otherwise a single
// sweep would send six Telegram messages.
// ---------------------------------------------------------------------------

// A ceiling on the chain, so a stuck run can't bill invocations forever.
const MAX_ROUNDS = Number(process.env.CHECK_MAX_ROUNDS) || 15;

/** Renames recorded since the sweep began, covering every round in it. */
async function renamesSince(started) {
  return selectAll(() =>
    supabase()
      .from("place_name_history")
      .select("place_id, old_name, new_name, changed_at")
      .gte("changed_at", started)
      .order("changed_at", { ascending: true })
      .order("id", { ascending: true })
  );
}

/**
 * Lets a promise outlive the response.
 *
 * Vercel freezes an instance as soon as it responds, so a handoff fetch would
 * be cut off without waitUntil. Off Vercel there is no request context for
 * waitUntil to attach to, but Node keeps the process alive anyway, so the
 * fetch still goes out. Either way the handoff must never fail the round.
 */
function handoff(promise) {
  const safe = promise.catch(() => {});
  try {
    waitUntil(safe);
  } catch {
    // No Vercel request context (plain `next start`) — the request is
    // already in flight.
  }
}

/**
 * Runs one round of a check sweep, continuing in a fresh invocation while
 * places remain.
 *
 * The round counters ride along in the query string because the rounds are
 * separate invocations with no shared memory.
 */
export async function runCheckRound(req) {
  const query = req.query || {};
  const round = Math.max(1, Number(query.round) || 1);
  const started = query.started || new Date().toISOString();
  const prior = {
    checked: Number(query.checked) || 0,
    changed: Number(query.changed) || 0,
    gone: Number(query.gone) || 0,
    failed: Number(query.failed) || 0,
  };

  const { results, skipped } = await runPlaceCheck();
  const totals = {
    checked: prior.checked + results.length,
    changed: prior.changed + results.filter((r) => r.changed).length,
    gone: prior.gone + results.filter((r) => r.gone).length,
    failed: prior.failed + results.filter((r) => r.error).length,
  };

  const finished = skipped === 0 || round >= MAX_ROUNDS;

  if (!finished) {
    const proto = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const path = String(req.url || "").split("?")[0];
    const qs = new URLSearchParams({
      round: String(round + 1),
      started,
      checked: String(totals.checked),
      changed: String(totals.changed),
      gone: String(totals.gone),
      failed: String(totals.failed),
    });
    const headers = process.env.CRON_SECRET
      ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
      : {};

    // The handoff is what makes the sweep cover the whole table; a round
    // still reports its own result if the handoff itself fails.
    handoff(
      fetch(`${proto}://${host}${path}?${qs}`, { method: "POST", headers })
    );
  }

  return {
    round,
    rounds: round,
    finished,
    skipped,
    totals,
    // Renames are read back from history so a change found in round 2 is
    // still reported by the single notification sent at the end.
    renamed: finished ? await renamesSince(started) : [],
  };
}
