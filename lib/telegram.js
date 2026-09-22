const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Telegram's hard cap is 4096 characters; staying well under it keeps a
// long list of renames from being rejected outright.
const MAX_LISTED = 25;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(lines, total, noun) {
  if (total > MAX_LISTED) {
    lines.push(`…and ${total - MAX_LISTED} more ${noun}.`);
  }
  return lines;
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
 * Push for a completed check sweep (scheduled or manual).
 *
 * Counts cover the whole sweep; `renamed` is the list of name changes read
 * back from history, since a sweep runs as several invocations and the ones
 * that found a change have already exited by the time this is sent.
 */
export function formatCheckSummary({
  checked,
  changed,
  gone = 0,
  failed = 0,
  renamed = [],
  trigger = "Scheduled",
  skipped = 0,
  rounds = 1,
}) {
  const headline = [
    `Checked ${checked} place${checked === 1 ? "" : "s"}`,
    `${changed} renamed`,
  ];
  if (gone) headline.push(`${gone} gone`);
  if (failed) headline.push(`${failed} failed`);

  const lines = [
    `<b>តាមដាន — ${escapeHtml(trigger.toLowerCase())} check</b>`,
    `${headline.join(", ")}.`,
  ];

  if (rounds > 1) lines.push(`Full sweep completed in ${rounds} runs.`);
  if (skipped > 0) {
    lines.push(`${skipped} left for the next run to stay inside the time limit.`);
  }

  if (renamed.length > 0) {
    lines.push("", "<b>Renamed</b>");
    for (const r of renamed.slice(0, MAX_LISTED)) {
      const label = r.label || r.current_name;
      const tag = label ? ` (${escapeHtml(label)})` : "";
      lines.push(
        `• ${escapeHtml(r.old_name || r.oldName || "?")} → ${escapeHtml(
          r.new_name || r.name || "?"
        )}${tag}`
      );
    }
    truncate(lines, renamed.length, "renames");
  }

  if (gone > 0) {
    lines.push("", `<b>No longer on Google</b> — ${gone}`);
    lines.push("Open the Dashboard to review them.");
  }

  if (failed > 0) {
    lines.push("", `<b>Lookup failed</b> — ${failed}`);
  }

  return lines.join("\n");
}

/** Push when places are added, so imports are confirmed out of band. */
export function formatPlacesAdded({ added, skipped = 0, source = "manual", names = [] }) {
  const lines = [
    "<b>តាមដាន — places added</b>",
    `${added} new place${added === 1 ? "" : "s"} now tracked from ${escapeHtml(source)}${
      skipped ? `, ${skipped} already tracked` : ""
    }.`,
  ];

  const shown = names.filter(Boolean).slice(0, MAX_LISTED);
  if (shown.length > 0) {
    lines.push("");
    for (const n of shown) lines.push(`• ${escapeHtml(n)}`);
    truncate(lines, names.filter(Boolean).length, "places");
  }

  return lines.join("\n");
}

/** Push when a duplicate scan finds place_ids that look like the same place. */
export function formatDuplicatesFound({ clusters }) {
  const lines = [
    "<b>តាមដាន — possible duplicates</b>",
    `Found ${clusters.length} group${clusters.length === 1 ? "" : "s"} of place IDs that look like the same place.`,
    "",
  ];

  for (const c of clusters.slice(0, MAX_LISTED)) {
    const stale = c.deadCount ? `, ${c.deadCount} stale` : "";
    lines.push(
      `• ${escapeHtml(c.sharedName || "(no name)")} — ${c.placeIds.length} IDs${stale}`
    );
  }
  truncate(lines, clusters.length, "groups");

  lines.push("", "Open the Dashboard to merge them.");
  return lines.join("\n");
}

/** Push used by the "Send test notification" action. */
export function formatTestMessage() {
  return [
    "<b>តាមដាន — test notification</b>",
    "Telegram push is wired up correctly.",
    `Sent ${new Date().toISOString()}`,
  ].join("\n");
}
