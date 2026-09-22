import { runCheckRound } from "../../../lib/check";
import { sendTelegramMessage, formatCheckSummary } from "../../../lib/telegram";

export const config = { maxDuration: 60 };

/**
 * Manual "Check now". Same sweep as the cron route, but reachable from the
 * browser without shipping CRON_SECRET to the client.
 *
 * A full sweep is several rounds, so the browser gets this round's response
 * and the remaining rounds continue server-side.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  try {
    const round = await runCheckRound(req);

    const telegram = round.finished
      ? await sendTelegramMessage(
          formatCheckSummary({
            checked: round.totals.checked,
            changed: round.totals.changed,
            gone: round.totals.gone,
            failed: round.totals.failed,
            renamed: round.renamed,
            skipped: round.skipped,
            rounds: round.round,
            trigger: "Manual",
          })
        )
      : null;

    return res.status(200).json({
      round: round.round,
      rounds: round.round,
      finished: round.finished,
      checked: round.totals.checked,
      skipped: round.skipped,
      changed: round.totals.changed,
      gone: round.totals.gone,
      failed: round.totals.failed,
      telegram,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
