import { runPlaceCheck } from "../../../lib/check";
import { sendTelegramMessage, formatCheckSummary } from "../../../lib/telegram";

export const config = { maxDuration: 60 };

/**
 * Manual "Check now". Same work as the cron route, but reachable from the
 * browser without shipping CRON_SECRET to the client.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  try {
    const { results, skipped } = await runPlaceCheck();
    const changed = results.filter((r) => r.changed).length;
    const gone = results.filter((r) => r.gone).length;
    const failed = results.filter((r) => r.error).length;

    const telegram = await sendTelegramMessage(
      formatCheckSummary({
        checked: results.length,
        changed,
        skipped,
        results,
        trigger: "Manual",
      })
    );

    return res.status(200).json({
      checked: results.length,
      skipped,
      changed,
      gone,
      failed,
      retryable: results.filter((r) => r.retryable).length,
      results,
      telegram,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
