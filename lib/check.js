import { waitUntil } from "@vercel/functions";
import { supabase, selectAll } from "./supabase";
import { getPlaceName } from "./places";

// The check runs at a paced rate (lib/googleKeys), which puts a hard floor on
// how long a full sweep takes: 1230 places at 5 requests/sec is ~246s. The
// budget sits above that so one invocation covers the whole table and sends
// the summary itself, and below the 300s function ceiling so a run that is
// going slowly hands the rest on instead of being killed mid-way — a killed
// run sends no notification at all.
//
// Spreading the sweep over several chained runs was the alternative, and it
// does not survive on Vercel: the chain reliably stopped after the fifth
// hand-off, leaving ~100 places unchecked and the summary unsent.
const BUDGET_MS = Number(process.env.CHECK_BUDGET_MS) || 260_000;

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

    const now = new Date().toISOString();
    const patch = {
      current_name: name,
      last_checked_at: now,
      // Google just confirmed the place, which is the "last seen" date the
      // gone report falls back to once a place disappears.
      last_seen_at: now,
    };
    // A place that answers again is not missing any more.
    if (place.gone_at) patch.gone_at = null;
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
    const retryable = Boolean(err?.retryable);

    // Google answered about the place itself — delisted, or a request it
    // rejects. Retrying cannot change that answer, so stamp the row as
    // visited anyway. Without this a handful of delisted places stay
    // "unchecked" forever, the sweep can never reach zero remaining, and a
    // daily run grinds through every round it is allowed before sending
    // anything at all. Rate limits (429) and server errors are excluded so a
    // bad key day is still retried rather than written off.
    if (!retryable && err?.status >= 400 && err?.status < 500) {
      const patch = { last_checked_at: new Date().toISOString() };
      // Only the first sighting is recorded, so the report shows how long the
      // place has really been missing instead of resetting every sweep.
      if (gone && !place.gone_at) patch.gone_at = patch.last_checked_at;
      await db
        .from("tracked_places")
        .update(patch)
        .eq("place_id", place.place_id)
        .then(undefined, () => {});
    }

    return {
      place_id: place.place_id,
      label: place.label,
      oldName: place.current_name,
      gone,
      error: gone ? undefined : String(err?.message || err),
      retryable,
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
 * @param since Marks the start of the sweep. Anything checked after it counts
 *   as done, which is how a sweep knows it has finished. Pass null to check
 *   whatever fits in the budget with no sweep semantics.
 * @returns {Promise<{results: Array, remaining: number, total: number}>}
 *   `remaining` is how many places the sweep still has left to visit, `total`
 *   the size of the table.
 */
export async function runPlaceCheck({ budgetMs = BUDGET_MS, since = null } = {}) {
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

  const sweepStart = since ? new Date(since).getTime() : null;

  // Only the rows this sweep has not visited yet. Everything a round stamps
  // is newer than the sweep's start, so a later round sees a strictly smaller
  // set here — and once the set is down to a round's worth, the round has
  // nothing else to do. Walking the rest instead spent the budget (and Google
  // quota) re-reading a table this sweep had already covered.
  const pending =
    sweepStart === null
      ? list
      : list.filter(
          (p) =>
            !p.last_checked_at || new Date(p.last_checked_at).getTime() < sweepStart
        );

  const deadline = Date.now() + budgetMs;
  const results = [];
  let next = 0;

  async function worker() {
    while (next < pending.length) {
      if (Date.now() >= deadline) return;
      results.push(await checkPlace(db, pending[next++]));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker())
  );

  // Whatever this round attempted is covered, even if the lookup failed —
  // including places Google refused outright (see checkPlace), so those can't
  // hold the sweep open forever. Counting the shortfall by hand instead is how
  // a sweep once declared itself finished with 109 rows unchecked.
  const visited = new Set(results.map((r) => r.place_id));
  const remaining = pending.filter((p) => !visited.has(p.place_id)).length;

  return { results, remaining, total: list.length };
}

// ---------------------------------------------------------------------------
// Sweep orchestration
//
// One run covers the whole table, so normally there is nothing to chain. The
// chain stays for the cases where a run does not get through everything — a
// slower pace after Google pushes back, or a table that outgrows one budget.
// Each run hands the next one off and only the last one notifies, so a sweep is
// one Telegram message rather than several.
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
 * Starts the next round without waiting on it.
 *
 * The next round runs for its own full budget. Holding this instance open
 * until that response arrives would nest the rounds and keep every parent alive
 * past its own limit, so the hand-off only stays alive long enough for the
 * request to leave. From then on the next round is its own invocation — and a
 * round with work left over is rare now that one run covers the table, which
 * is why this is a safety net rather than the normal path.
 *
 * Off Vercel there is no request context for waitUntil to attach to, but Node
 * keeps the process alive anyway, so the fetch still goes out. Either way the
 * handoff must never fail the round.
 */
const HANDOFF_GRACE_MS = 3_000;

function handoff(promise) {
  const settled = promise.catch(() => {});
  const grace = new Promise((resolve) => setTimeout(resolve, HANDOFF_GRACE_MS));
  try {
    waitUntil(Promise.race([settled, grace]));
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

  const { results, remaining } = await runPlaceCheck({ since: started });
  const totals = {
    checked: prior.checked + results.length,
    changed: prior.changed + results.filter((r) => r.changed).length,
    gone: prior.gone + results.filter((r) => r.gone).length,
    failed: prior.failed + results.filter((r) => r.error).length,
  };

  // Finished when the sweep has nothing left, not when a round happens to
  // reach the end of its budget — those are very different things on a table
  // larger than one round can cover.
  const finished = remaining === 0 || round >= MAX_ROUNDS;

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
    // What the sweep still has to do, which is what the summary and the UI
    // should report — not this round's shortfall.
    skipped: remaining,
    totals,
    // Renames are read back from history so a change found in round 2 is
    // still reported by the single notification sent at the end.
    renamed: finished ? await renamesSince(started) : [],
  };
}
