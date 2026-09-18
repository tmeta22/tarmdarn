import { supabase } from "../../../lib/supabase";
import { getPlaceName } from "../../../lib/places";
import { guessCategoryFromPlace } from "../../../lib/categories";

export default async function handler(req, res) {
  const db = supabase();

  if (req.method === "GET") {
    const { data, error } = await db
      .from("tracked_places")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === "POST") {
    const { place_id, category, label } = req.body || {};
    if (!place_id) return res.status(400).json({ error: "place_id is required" });

    // Duplication prevention: don't silently overwrite an already-tracked
    // place's category/label — tell the caller it's already tracked.
    const { data: existing } = await db
      .from("tracked_places")
      .select("*")
      .eq("place_id", place_id)
      .maybeSingle();
    if (existing) {
      return res.status(409).json({ error: "Already tracked", place: existing, duplicate: true });
    }

    try {
      const details = await getPlaceName(place_id);
      const finalCategory =
        (category && String(category).trim()) ||
        guessCategoryFromPlace({
          primaryType: details.primaryType,
          types: details.types,
          name: details.name,
          address: details.address,
        }) ||
        null;
      const { data, error } = await db
        .from("tracked_places")
        .insert({
          place_id,
          category: finalCategory,
          label: label ?? null,
          current_name: details.name,
          latitude: details.latitude ?? null,
          longitude: details.longitude ?? null,
          last_checked_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data);
    } catch (err) {
      return res.status(502).json({ error: String(err) });
    }
  }

  if (req.method === "PATCH") {
    const { place_id, category, label, current_name } = req.body || {};
    if (!place_id) return res.status(400).json({ error: "place_id is required" });

    const patch = {};
    if (category !== undefined) patch.category = category ? String(category).trim() : null;
    if (label !== undefined) patch.label = label ? String(label).trim() : null;
    if (current_name !== undefined)
      patch.current_name = current_name ? String(current_name).trim() : null;
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "At least one field to update is required" });
    }

    const { data, error } = await db
      .from("tracked_places")
      .update(patch)
      .eq("place_id", place_id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === "DELETE") {
    const { place_id } = req.body || {};
    if (!place_id) return res.status(400).json({ error: "place_id is required" });
    const { error } = await db.from("tracked_places").delete().eq("place_id", place_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", ["GET", "POST", "PATCH", "DELETE"]);
  return res.status(405).end();
}
