const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Text Search — used to discover schools/preschools in bulk.
 * Returns { places: [{ placeId, name, address, primaryType, types }], nextPageToken }
 */
export async function searchPlaces(textQuery, pageToken) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.primaryType,places.types,nextPageToken",
    },
    body: JSON.stringify({
      textQuery,
      pageSize: 20,
      ...(pageToken ? { pageToken } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`Places text search ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return {
    places: (data.places || []).map((p) => ({
      placeId: p.id,
      name: p.displayName?.text ?? null,
      address: p.formattedAddress ?? null,
      primaryType: p.primaryType ?? null,
      types: Array.isArray(p.types) ? p.types : [],
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
 */
export async function getPlaceName(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": "id,displayName,primaryType,types,formattedAddress",
    },
  });

  if (!res.ok) {
    throw new Error(`Place details ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return {
    canonicalPlaceId: data.id,
    name: data.displayName?.text ?? null,
    primaryType: data.primaryType ?? null,
    types: Array.isArray(data.types) ? data.types : [],
    address: data.formattedAddress ?? null,
  };
}
