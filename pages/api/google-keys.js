import { poolStatus, addKey, removeKey } from "../../lib/googleKeys";

/**
 * Manage the Google Places API key pool.
 *
 * Keys are write-only from the client's perspective: this endpoint hands
 * back a masked hint, never the key itself.
 */
export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json(await poolStatus());
    }

    if (req.method === "POST") {
      const { key, label } = req.body || {};
      if (!key) return res.status(400).json({ error: "key is required" });
      const result = await addKey(key, label);
      if (result.error) return res.status(400).json(result);
      return res.status(200).json({ ...result, status: await poolStatus() });
    }

    if (req.method === "DELETE") {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: "id is required" });
      const result = await removeKey(id);
      if (result.error) return res.status(400).json(result);
      return res.status(200).json({ ...result, status: await poolStatus() });
    }

    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
