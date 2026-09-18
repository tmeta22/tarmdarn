import { runPlaceCheck } from "../../../lib/check";
import { sendTelegramMessage, formatCheckSummary } from "../../../lib/telegram";

// The check is paced to protect the API quota, so walking every place can
// take far longer than the default 10s function limit.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" automatically
  // when a CRON_SECRET env var is set. Manual runs from the app go through
  // /api/places/check instead, which doesn't require the secret — so the
  // secret never has to reach the browser.
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  try {
    const { results, skipped } = await runPlaceCheck();
    const changed = results.filter((r) => r.changed).length;

    // Fire a Telegram push every time a check completes.
    // Silently skipped if TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID aren't set.
    const telegram = await sendTelegramMessage(
      formatCheckSummary({
        checked: results.length,
        changed,
        skipped,
        results,
        trigger: "Scheduled",
      })
    );

    return res.status(200).json({
      checked: results.length,
      skipped,
      changed,
      gone: results.filter((r) => r.gone).length,
      failed: results.filter((r) => r.error).length,
      retryable: results.filter((r) => r.retryable).length,
      results,
      telegram,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
