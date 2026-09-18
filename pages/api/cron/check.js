import { supabase } from "../../../lib/supabase";
import { getPlaceName } from "../../../lib/places";
import { sendTelegramMessage, formatCheckSummary } from "../../../lib/telegram";

export default async function handler(req, res) {
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" automatically
  // when a CRON_SECRET env var is set. Also allow manual triggering with
  // the same header so you can test this by hand.
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  const db = supabase();
  const { data: places, error } = await db.from("tracked_places").select("*");
  if (error) return res.status(500).json({ error: error.message });

  const results = [];

  for (const place of places) {
    try {
      const { name, latitude, longitude } = await getPlaceName(place.place_id);
      const changed = Boolean(name) && Boolean(place.current_name) && name !== place.current_name;

      if (changed) {
        await db.from("place_name_history").insert({
          place_id: place.place_id,
          old_name: place.current_name,
          new_name: name,
        });
      }

      const patch = { current_name: name, last_checked_at: new Date().toISOString() };
      // Keep coordinates fresh, and fill them in for rows that predate the
      // map view.
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        patch.latitude = latitude;
        patch.longitude = longitude;
      }

      await db
        .from("tracked_places")
        .update(patch)
        .eq("place_id", place.place_id);

      results.push({
        place_id: place.place_id,
        label: place.label,
        name,
        oldName: place.current_name,
        changed,
      });
    } catch (err) {
      results.push({ place_id: place.place_id, label: place.label, error: String(err) });
    }
  }

  const changedCount = results.filter((r) => r.changed).length;

  // Fire a Telegram push every time a check completes (manual or cron).
  // Silently skipped if TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID aren't set.
  const telegram = await sendTelegramMessage(
    formatCheckSummary({ checked: results.length, changed: changedCount, results })
  );

  return res.status(200).json({
    checked: results.length,
    changed: changedCount,
    results,
    telegram,
  });
}
