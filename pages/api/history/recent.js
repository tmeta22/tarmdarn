import { supabase } from "../../../lib/supabase";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 8, 20);
  const db = supabase();

  const { data, error } = await db
    .from("place_name_history")
    .select("*, tracked_places(label, category)")
    .order("changed_at", { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });

  const rows = (data || []).map((h) => ({
    place_id: h.place_id,
    label: h.tracked_places?.label ?? null,
    category: h.tracked_places?.category ?? null,
    old_name: h.old_name,
    new_name: h.new_name,
    changed_at: h.changed_at,
  }));

  return res.status(200).json(rows);
}
