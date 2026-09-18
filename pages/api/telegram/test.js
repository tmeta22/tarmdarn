import { sendTelegramMessage, formatTestMessage } from "../../../lib/telegram";

/**
 * Sends a test push so the Telegram wiring can be verified on demand,
 * without having to wait for a scheduled check.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const telegram = await sendTelegramMessage(formatTestMessage());

  return res.status(200).json({
    configured,
    ...telegram,
  });
}
