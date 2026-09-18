const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Sends a message via the Telegram Bot API. No-ops quietly (returns
 * {skipped:true}) if TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID aren't set,
 * so the app works fine without Telegram configured.
 */
export async function sendTelegramMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) return { skipped: true };
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("Telegram send failed:", errText);
      return { ok: false, error: errText };
    }
    return { ok: true };
  } catch (err) {
    console.error("Telegram send error:", err);
    return { ok: false, error: String(err) };
  }
}

/**
 * Builds the push message for a completed check run (manual or cron).
 * `results` items look like { place_id, label, name, oldName, changed, error }.
 */
export function formatCheckSummary({ checked, changed, results }) {
  const renamed = results.filter((r) => r.changed);
  const errored = results.filter((r) => r.error);

  const lines = [
    "<b>តាមដាន — check complete</b>",
    `Checked ${checked} place${checked === 1 ? "" : "s"}, ${changed} renamed${
      errored.length ? `, ${errored.length} failed` : ""
    }.`,
  ];

  if (renamed.length > 0) {
    lines.push("");
    for (const r of renamed.slice(0, 25)) {
      const tag = r.label ? ` (${escapeHtml(r.label)})` : "";
      lines.push(`• ${escapeHtml(r.oldName || "?")} → ${escapeHtml(r.name || "?")}${tag}`);
    }
    if (renamed.length > 25) lines.push(`…and ${renamed.length - 25} more.`);
  }

  return lines.join("\n");
}
