import { supabase } from "../../../../lib/supabase";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const { placeId } = req.query;
  const db = supabase();
  const { data, error } = await db
    .from("place_name_history")
    .select("*")
    .eq("place_id", placeId)
    .order("changed_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(data);
}
