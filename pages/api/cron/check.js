import { runCheckRound } from "../../../lib/check";
import { sendTelegramMessage, formatCheckSummary } from "../../../lib/telegram";

// One round is paced and budgeted at ~45s; the sweep continues in further
// invocations, so this needs headroom above the default 10s.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" automatically
  // when a CRON_SECRET env var is set. Manual runs from the app go through
  // /api/places/check instead, which doesn't require the secret — so the
  // secret never has to reach the browser. Chained rounds carry it forward.
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  try {
    const round = await runCheckRound(req);

    // Only the round that completes the sweep notifies, so one sweep is one
    // message rather than one per round.
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
            trigger: "Scheduled",
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
