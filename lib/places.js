import { googleFetch } from "./googleKeys";

/**
 * Text Search — used to discover schools/preschools in bulk.
 * Returns { places: [{ placeId, name, address, primaryType, types }], nextPageToken }
 */
export async function searchPlaces(textQuery, pageToken) {
  const res = await googleFetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.primaryType,places.types,places.location,nextPageToken",
    },
    body: JSON.stringify({
      textQuery,
      pageSize: 20,
      ...(pageToken ? { pageToken } : {}),
    }),
  });

  const data = await res.json();
  return {
    places: (data.places || []).map((p) => ({
      placeId: p.id,
      name: p.displayName?.text ?? null,
      address: p.formattedAddress ?? null,
      primaryType: p.primaryType ?? null,
      types: Array.isArray(p.types) ? p.types : [],
      latitude: p.location?.latitude ?? null,
      longitude: p.location?.longitude ?? null,
    })),
    nextPageToken: data.nextPageToken ?? null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scans multiple pages of a text search automatically. Google requires
 * a short delay before a nextPageToken becomes valid, so this waits
 * between pages. Capped at maxPages (Google returns at most ~3 pages /
 * 60 results per query regardless).
 */
export async function searchPlacesScan(textQuery, { maxPages = 3, delayMs = 2000 } = {}) {
  let all = [];
  let pageToken = null;
  let pages = 0;

  do {
    const { places, nextPageToken } = await searchPlaces(textQuery, pageToken);
    all = all.concat(places);
    pageToken = nextPageToken;
    pages += 1;
    if (pageToken && pages < maxPages) {
      await sleep(delayMs);
    }
  } while (pageToken && pages < maxPages);

  return { places: all, scannedPages: pages, exhausted: !pageToken };
}

/**
 * Place Details — used on the daily check to see the current name
 * for a place_id we already track. Basic Data field only (cheapest tier).
 *
 * Errors carry `status` (so callers can spot a 404 = delisted place) and
 * `retryable` (so a rate-limited row can be retried instead of written off).
 */
export async function getPlaceName(placeId, opts) {
  const res = await googleFetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-FieldMask": "id,displayName,primaryType,types,formattedAddress,location",
      },
    },
    opts
  );

  const data = await res.json();
  return {
    canonicalPlaceId: data.id,
    name: data.displayName?.text ?? null,
    primaryType: data.primaryType ?? null,
    types: Array.isArray(data.types) ? data.types : [],
    address: data.formattedAddress ?? null,
    latitude: data.location?.latitude ?? null,
    longitude: data.location?.longitude ?? null,
  };
}
