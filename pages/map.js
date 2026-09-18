import { useEffect, useMemo, useState } from "react";
import { categoryLabel } from "../lib/categories";
import Icon from "../components/Icon";

const WALL_LIMIT = 9;

function hasCoords(p) {
  return Number.isFinite(p.latitude) && Number.isFinite(p.longitude);
}

/**
 * Keyless Google Maps embed. Coordinates give the most reliable pin, so
 * they're preferred; a text query is the fallback for rows that haven't
 * been located yet.
 */
function embedSrc(place, zoom) {
  const q = hasCoords(place)
    ? `${place.latitude},${place.longitude}`
    : [place.current_name, place.label].filter(Boolean).join(", ");
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}&z=${zoom}&output=embed`;
}

function externalUrl(place) {
  const base = "https://www.google.com/maps/search/?api=1";
  if (hasCoords(place)) {
    return `${base}&query=${place.latitude},${place.longitude}&query_place_id=${encodeURIComponent(
      place.place_id
    )}`;
  }
  return `${base}&query=${encodeURIComponent(place.current_name || place.place_id)}`;
}

export default function MapPage() {
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [wall, setWall] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateStatus, setLocateStatus] = useState("");

  async function loadPlaces() {
    setLoading(true);
    try {
      const res = await fetch("/api/places");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load places");
      setPlaces(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPlaces();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return places;
    return places.filter(
      (p) =>
        (p.current_name || "").toLowerCase().includes(q) ||
        (p.label || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q) ||
        p.place_id.toLowerCase().includes(q)
    );
  }, [places, query]);

  const missingCount = useMemo(() => places.filter((p) => !hasCoords(p)).length, [places]);

  const selected = useMemo(
    () => filtered.find((p) => p.place_id === selectedId) || filtered[0] || null,
    [filtered, selectedId]
  );

  const wallPlaces = useMemo(
    () => filtered.filter(hasCoords).slice(0, WALL_LIMIT),
    [filtered]
  );

  async function locateMissing() {
    const targets = filtered.filter((p) => !hasCoords(p)).map((p) => p.place_id);
    if (targets.length === 0) return;
    setLocating(true);
    setLocateStatus(`Locating ${targets.length} place${targets.length === 1 ? "" : "s"}...`);
    try {
      const res = await fetch("/api/places/coordinates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeIds: targets, limit: 100 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed");
      setLocateStatus(`Located ${data.updated}. ${data.remaining} still missing overall.`);
      await loadPlaces();
    } catch (err) {
      setLocateStatus(String(err.message || err));
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="page page--wide">
      <div className="masthead">
        <h1>Map</h1>
        <p>
          Every tracked place on Google Maps. Pick one from the list to focus
          the map, or switch to the wall for a bird's-eye sweep.
        </p>
      </div>

      <div className="map-shell">
        <aside className="bento-card map-sidebar">
          <div className="map-sidebar-head">
            <input
              className="grow"
              type="search"
              placeholder="Filter places..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter places"
            />
            <button
              type="button"
              className={`btn icon-only${wall ? " primary" : ""}`}
              onClick={() => setWall((w) => !w)}
              title={wall ? "Single map" : "Map wall"}
              aria-label={wall ? "Show single map" : "Show map wall"}
              aria-pressed={wall}
            >
              <Icon name={wall ? "mapPin" : "viewTiles"} />
            </button>
          </div>

          <div className="map-count">
            {filtered.length} place{filtered.length === 1 ? "" : "s"}
            {missingCount > 0 && (
              <>
                {" · "}
                <button
                  type="button"
                  className="linklike"
                  onClick={locateMissing}
                  disabled={locating}
                >
                  <Icon name="crosshair" />
                  {locating ? "locating..." : `locate ${missingCount} missing`}
                </button>
              </>
            )}
          </div>

          <div className="map-list scroll-panel">
            {loading ? (
              <p className="empty">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="empty">No places match that filter.</p>
            ) : (
              filtered.map((p) => (
                <button
                  type="button"
                  key={p.place_id}
                  className={`map-list-item${
                    selected && selected.place_id === p.place_id ? " active" : ""
                  }`}
                  onClick={() => setSelectedId(p.place_id)}
                >
                  <span className="map-list-name">{p.current_name || "(unknown)"}</span>
                  <span className="map-list-meta">
                    <span className="badge">{categoryLabel(p.category)}</span>
                    {!hasCoords(p) && <span className="map-list-nocoord">no coords</span>}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="map-main">
          {wall ? (
            <div className="map-wall-wrap">
              <div className="map-wall">
                {wallPlaces.map((p) => (
                  <a
                    key={p.place_id}
                    className="map-wall-tile"
                    href={externalUrl(p)}
                    target="_blank"
                    rel="noreferrer"
                    title={`${p.current_name || p.place_id} — open in Google Maps`}
                  >
                    <iframe
                      src={embedSrc(p, 15)}
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      title={p.current_name || p.place_id}
                    />
                    <span className="map-wall-label">{p.current_name || "(unknown)"}</span>
                  </a>
                ))}
              </div>
              {filtered.length > wallPlaces.length && (
                <p className="hint map-wall-note">
                  Showing the first {wallPlaces.length} located places of {filtered.length} — narrow
                  the filter to see the rest.
                </p>
              )}
            </div>
          ) : selected ? (
            <div className="bento-card map-focus">
              <div className="map-focus-head">
                <div>
                  <h2>{selected.current_name || "(unknown)"}</h2>
                  <p className="hint">
                    <span className="badge">{categoryLabel(selected.category)}</span>
                    {selected.label ? ` ${selected.label}` : ""}
                  </p>
                </div>
                <a
                  className="btn"
                  href={externalUrl(selected)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="externalLink" />
                  Open in Google Maps
                </a>
              </div>
              <div className="map-frame">
                <iframe
                  src={embedSrc(selected, 17)}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title={selected.current_name || selected.place_id}
                />
              </div>
              <div className="map-focus-foot">
                <code className="place-id">{selected.place_id}</code>
                {hasCoords(selected) ? (
                  <span className="probe ok">
                    <span className="dot" />
                    {selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}
                  </span>
                ) : (
                  <span className="probe warn">
                    <span className="dot" />
                    location not resolved yet
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="bento-card map-focus">
              <p className="empty">Nothing to show yet.</p>
            </div>
          )}
          {locateStatus && <p className="status">{locateStatus}</p>}
          {error && <p className="status">{error}</p>}
        </section>
      </div>
    </div>
  );
}
