import { supabase } from "../../../lib/supabase";
import { guessCategoryFromPlace } from "../../../lib/categories";
import { sendTelegramMessage, formatPlacesAdded } from "../../../lib/telegram";

// A chunked import arrives as several requests; each one inserts a large
// batch and then pushes a notification, so the default 10s is not enough.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  try {
    return await bulkAdd(req, res);
  } catch (err) {
    // Without this a throw escapes as a bare 500 with no body, which is
    // impossible to diagnose from the browser. The client shows this text.
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

async function bulkAdd(req, res) {
  const {
    places,
    category,
    source,
    // A chunked import makes several requests; only the last one should
    // push, and it reports the whole run via alreadyAdded/alreadySkipped
    // rather than just its own slice.
    notify = true,
    alreadyAdded = 0,
    alreadySkipped = 0,
  } = req.body || {};
  if (!Array.isArray(places) || places.length === 0) {
    return res.status(400).json({ error: "places (array) is required" });
  }

  const addedBefore = Number(alreadyAdded) || 0;
  const skippedBefore = Number(alreadySkipped) || 0;
  const sourceLabel = source ? String(source) : "bulk add";

  const db = supabase();

  // Duplication prevention: never let a bulk add overwrite a place
  // that's already tracked (which could clobber its category/label).
  const incomingIds = places.map((p) => p.placeId);
  const { data: existingRows, error: existingError } = await db
    .from("tracked_places")
    .select("place_id")
    .in("place_id", incomingIds);
  if (existingError) return res.status(500).json({ error: existingError.message });

  const existingIds = new Set((existingRows || []).map((r) => r.place_id));
  const toInsert = places.filter((p) => !existingIds.has(p.placeId));
  const skipped = places.length - toInsert.length;

  if (toInsert.length === 0) {
    // Nothing new in this batch, but a chunked run still owes the user one
    // summary covering everything the earlier chunks added.
    const telegram =
      notify !== false && addedBefore > 0
        ? await sendTelegramMessage(
            formatPlacesAdded({
              added: addedBefore,
              skipped: skippedBefore + skipped,
              source: sourceLabel,
              names: [],
            })
          )
        : null;
    return res.status(200).json({ added: 0, skipped, places: [], telegram });
  }

  const rows = toInsert.map((p) => {
    const rowCategory =
      (p.category && String(p.category).trim()) ||
      (category && String(category).trim()) ||
      guessCategoryFromPlace({
        primaryType: p.primaryType,
        types: p.types,
        name: p.name,
        address: p.address,
      }) ||
      null;
    return {
      place_id: p.placeId,
      category: rowCategory,
      label: p.label || p.address || null,
      current_name: p.name ?? null,
      latitude: Number.isFinite(p.latitude) ? p.latitude : null,
      longitude: Number.isFinite(p.longitude) ? p.longitude : null,
      last_checked_at: new Date().toISOString(),
    };
  });

  const { data, error } = await db.from("tracked_places").insert(rows).select();

  if (error) return res.status(500).json({ error: error.message });

  // One push for the whole run: previous chunks report their counts so the
  // final message is a total, not the last slice.
  const telegram =
    notify === false
      ? null
      : await sendTelegramMessage(
          formatPlacesAdded({
            added: addedBefore + data.length,
            skipped: skippedBefore + skipped,
            source: sourceLabel,
            names: data.map((p) => p.current_name || p.label || p.place_id),
          })
        );

  return res.status(200).json({ added: data.length, skipped, places: data, telegram });
}
