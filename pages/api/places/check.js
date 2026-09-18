import { runPlaceCheck } from "../../../lib/check";
import { sendTelegramMessage, formatCheckSummary } from "../../../lib/telegram";

/**
 * Manual check, triggered from the Controls page.
 *
 * Kept separate from /api/cron/check so the CRON_SECRET stays server-side:
 * the scheduled route is secret-gated, this one is user-initiated.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  try {
    const results = await runPlaceCheck();
    const changed = results.filter((r) => r.changed).length;
    const gone = results.filter((r) => r.gone).length;
    const failed = results.filter((r) => r.error && !r.gone).length;

    const telegram = await sendTelegramMessage(
      formatCheckSummary({ checked: results.length, changed, results, trigger: "Manual" })
    );

    return res.status(200).json({
      checked: results.length,
      changed,
      gone,
      failed,
      results,
      telegram,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
