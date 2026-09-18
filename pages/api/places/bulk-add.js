import { supabase } from "../../../lib/supabase";
import { guessCategoryFromPlace } from "../../../lib/categories";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const { places, category } = req.body || {};
  if (!Array.isArray(places) || places.length === 0) {
    return res.status(400).json({ error: "places (array) is required" });
  }

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
    return res.status(200).json({ added: 0, skipped, places: [] });
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
  return res.status(200).json({ added: data.length, skipped, places: data });
}
