import { supabase } from "../../lib/supabase";
import { categoryLabel } from "../../lib/categories";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const db = supabase();

  const [placesResult, renameCountResult] = await Promise.all([
    db.from("tracked_places").select("category, last_checked_at"),
    db.from("place_name_history").select("id", { count: "exact", head: true }),
  ]);

  if (placesResult.error) return res.status(500).json({ error: placesResult.error.message });
  if (renameCountResult.error)
    return res.status(500).json({ error: renameCountResult.error.message });

  const places = placesResult.data || [];
  const categories = new Set(places.map((p) => categoryLabel(p.category)));
  const lastCheckedAt = places.reduce((latest, p) => {
    if (!p.last_checked_at) return latest;
    return !latest || new Date(p.last_checked_at) > new Date(latest) ? p.last_checked_at : latest;
  }, null);

  return res.status(200).json({
    totalPlaces: places.length,
    totalCategories: categories.size,
    totalRenames: renameCountResult.count || 0,
    lastCheckedAt,
  });
}
