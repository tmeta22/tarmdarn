import { supabase } from "../../../lib/supabase";
import { getPlaceName } from "../../../lib/places";

const CONCURRENCY = 4;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

async function limitMap(list, worker, limit = CONCURRENCY) {
  let next = 0;
  async function runOne() {
    while (next < list.length) {
      const i = next++;
      await worker(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => runOne()));
}

/**
 * Backfills coordinates for tracked places that don't have them yet.
 *
 * Google's Place Details is called with a concurrency cap because the
 * daily check and the map view can both hit this at once. Batched rather
 * than run in one shot so a large backlog can't blow the serverless
 * timeout — the client calls it repeatedly until `remaining` reaches 0.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const db = supabase();
  const { placeIds, limit } = req.body || {};
  const take = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));

  let query = db
    .from("tracked_places")
    .select("place_id")
    .order("created_at", { ascending: true })
    .limit(take);

  if (Array.isArray(placeIds) && placeIds.length > 0) {
    query = query.in("place_id", placeIds.slice(0, MAX_LIMIT));
  } else {
    query = query.or("latitude.is.null,longitude.is.null");
  }

  const { data: rows, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const failed = [];
  let updated = 0;

  await limitMap(rows || [], async (row) => {
    try {
      const details = await getPlaceName(row.place_id);
      if (!Number.isFinite(details.latitude) || !Number.isFinite(details.longitude)) {
        failed.push({ place_id: row.place_id, error: "Google returned no location" });
        return;
      }
      const { error: updateError } = await db
        .from("tracked_places")
        .update({ latitude: details.latitude, longitude: details.longitude })
        .eq("place_id", row.place_id);
      if (updateError) throw new Error(updateError.message);
      updated += 1;
    } catch (err) {
      failed.push({ place_id: row.place_id, error: String(err?.message || err) });
    }
  });

  // How many are still missing, so the caller knows whether to keep going.
  const { count } = await db
    .from("tracked_places")
    .select("place_id", { count: "exact", head: true })
    .or("latitude.is.null,longitude.is.null");

  return res.status(200).json({
    requested: (rows || []).length,
    updated,
    failed,
    remaining: count ?? 0,
  });
}
