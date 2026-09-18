import { searchPlaces, searchPlacesScan } from "../../../lib/places";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const { query, pageToken, scanAll } = req.body || {};
  if (!query) return res.status(400).json({ error: "query is required" });

  try {
    if (scanAll) {
      // Auto-page through every available page (Google caps at ~3
      // pages / 60 results per query) instead of one page at a time.
      const result = await searchPlacesScan(query);
      return res.status(200).json({ ...result, nextPageToken: null });
    }
    const result = await searchPlaces(query, pageToken);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(502).json({ error: String(err) });
  }
}
