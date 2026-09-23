import { supabase, selectAll } from "../../../lib/supabase";

/**
 * Places Google no longer serves — the data behind the gone report.
 *
 * Read-only. The state is written by the daily check (lib/check.js), which
 * stamps gone_at the first time a Place Details lookup answers 404 and clears
 * it again if the place ever comes back.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  try {
    const places = await selectAll(() =>
      supabase()
        .from("tracked_places")
        .select(
          "place_id, label, category, current_name, latitude, longitude, gone_at, last_seen_at, last_checked_at"
        )
        .not("gone_at", "is", null)
        .order("gone_at", { ascending: false })
        .order("id", { ascending: true })
    );
    return res.status(200).json(places);
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
