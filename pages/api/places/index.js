import { supabase } from "../../../lib/supabase";
import { getPlaceName } from "../../../lib/places";

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
      const { name } = await getPlaceName(place_id);
      const { data, error } = await db
        .from("tracked_places")
        .insert({
          place_id,
          category: category ?? null,
          label: label ?? null,
          current_name: name,
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

  if (req.method === "DELETE") {
    const { place_id } = req.body || {};
    if (!place_id) return res.status(400).json({ error: "place_id is required" });
    const { error } = await db.from("tracked_places").delete().eq("place_id", place_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  return res.status(405).end();
}
