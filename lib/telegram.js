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
 * Push for a completed check run (scheduled or manual).
 * `results` items look like { place_id, label, name, oldName, changed, gone, error }.
 */
export function formatCheckSummary({ checked, changed, results, trigger = "Scheduled" }) {
  const renamed = results.filter((r) => r.changed);
  const gone = results.filter((r) => r.gone);
  const failed = results.filter((r) => r.error && !r.gone);

  const headline = [
    `Checked ${checked} place${checked === 1 ? "" : "s"}`,
    `${changed} renamed`,
  ];
  if (gone.length) headline.push(`${gone.length} gone`);
  if (failed.length) headline.push(`${failed.length} failed`);

  const lines = [
    `<b>តាមដាន — ${escapeHtml(trigger.toLowerCase())} check</b>`,
    `${headline.join(", ")}.`,
  ];

  if (renamed.length > 0) {
    lines.push("", "<b>Renamed</b>");
    for (const r of renamed.slice(0, MAX_LISTED)) {
      const tag = r.label ? ` (${escapeHtml(r.label)})` : "";
      lines.push(`• ${escapeHtml(r.oldName || "?")} → ${escapeHtml(r.name || "?")}${tag}`);
    }
    truncate(lines, renamed.length, "renames");
  }

  if (gone.length > 0) {
    lines.push("", "<b>No longer on Google</b>");
    for (const r of gone.slice(0, MAX_LISTED)) {
      const tag = r.label ? ` (${escapeHtml(r.label)})` : "";
      lines.push(`• ${escapeHtml(r.oldName || r.place_id)}${tag}`);
    }
    truncate(lines, gone.length, "places");
  }

  if (failed.length > 0) {
    lines.push("", `<b>Lookup failed</b> — ${failed.length}`);
    for (const r of failed.slice(0, 5)) {
      lines.push(`• <code>${escapeHtml(r.place_id)}</code>`);
    }
    if (failed.length > 5) lines.push(`…and ${failed.length - 5} more.`);
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
