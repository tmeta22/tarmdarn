import { getPlaceName, searchPlaces } from "../../../lib/places";
import { currentQps } from "../../../lib/googleKeys";

const CONCURRENCY = 4;

// Pacing (lib/googleKeys) is what actually protects the quota, so this can
// stay parallel: the workers still send at one shared, evenly spaced rate.
// Vercel's default function timeout is 10s, which a paced batch overruns.
export const config = { maxDuration: 60 };

async function limitMap(list, worker, limit = CONCURRENCY) {
  const results = new Array(list.length);
  let next = 0;
  async function runOne() {
    while (next < list.length) {
      const i = next++;
      try {
        results[i] = await worker(list[i], i);
      } catch (err) {
        results[i] = {
          __error: String(err?.message || err),
          __retryable: Boolean(err?.retryable),
          __status: err?.status ?? null,
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => runOne()));
  return results;
}

/**
 * Resolve a single candidate:
 *  - If placeId is present → Place Details (authoritative). If a name was
 *    also provided, use it as a fallback in case details lookup fails.
 *  - If only name → Text Search, pick the top match.
 */
async function resolveOne(candidate) {
  const placeId = (candidate.placeId || candidate.place_id || "").trim();
  const name = (
    candidate.name ||
    candidate.current_name ||
    candidate.displayName ||
    ""
  ).trim();
  const address = (
    candidate.address ||
    candidate.label ||
    candidate.note ||
    ""
  ).trim();
  const category = (candidate.category || "").trim() || null;

  let resolved = null;

  if (placeId) {
    try {
      const details = await getPlaceName(placeId);
      resolved = {
        placeId: details.canonicalPlaceId || placeId,
        name: details.name || name || null,
        address: details.address || address || null,
        primaryType: details.primaryType || null,
        types: Array.isArray(details.types) ? details.types : [],
        latitude: details.latitude ?? null,
        longitude: details.longitude ?? null,
      };
    } catch (err) {
      // A rate-limited lookup must not degrade into a fuzzy name search —
      // that would silently match the wrong place. Only a definitive
      // failure (a 404, say) justifies falling back to the name.
      if (!name || err?.retryable) throw err;
    }
  }

  if (!resolved && name) {
    const query = address ? `${name} ${address}` : name;
    const { places } = await searchPlaces(query);
    if (!places || places.length === 0) {
      throw new Error("No Google matches for that name");
    }
    const top = places[0];
    resolved = {
      placeId: top.placeId,
      name: top.name || name,
      address: top.address || address || null,
      primaryType: top.primaryType || null,
      types: Array.isArray(top.types) ? top.types : [],
      latitude: top.latitude ?? null,
      longitude: top.longitude ?? null,
    };
  }

  if (!resolved) {
    throw new Error("Need at least a place_id or a name");
  }

  return { ...resolved, label: address || null, category };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }

  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "rows (array) is required" });
  }

  const cap = Math.max(1, Math.min(100, rows.length));
  const slice = rows.slice(0, cap);
  const results = await limitMap(slice, resolveOne);

  const resolved = [];
  const errors = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r && r.__error) {
      errors.push({
        index: i,
        row: slice[i],
        error: r.__error,
        retryable: r.__retryable,
        status: r.__status,
      });
    } else {
      resolved.push(r);
    }
  }

  return res.status(200).json({
    resolved,
    errors,
    requested: slice.length,
    // The client uses this to size the next batch so a paced run doesn't
    // overrun the function timeout.
    qps: Number(currentQps().toFixed(2)),
  });
}
