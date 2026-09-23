import { useEffect, useMemo, useState } from "react";
import { categoryLabel } from "../lib/categories";
import Icon from "../components/Icon";
import CopyButton from "../components/CopyButton";

const DAY_MS = 24 * 60 * 60 * 1000;

const SORT_OPTIONS = [
  { value: "longest", label: "Gone longest" },
  { value: "recent", label: "Gone most recently" },
  { value: "name", label: "Name (A–Z)" },
];

const LONG_GONE_DAYS = 30;
const VERY_LONG_GONE_DAYS = 90;

function daysSince(iso, now) {
  if (!iso) return null;
  return Math.floor((now - new Date(iso).getTime()) / DAY_MS);
}

function durationLabel(days) {
  if (days === null) return "—";
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  if (days < LONG_GONE_DAYS) return `${days} days`;
  if (days < 60) return `${Math.floor(days / 7)} weeks (${days} days)`;
  if (days < 365) return `${Math.floor(days / 30)} months (${days} days)`;
  return `${Math.floor(days / 365)} years (${days} days)`;
}

function shortDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** A delisted place_id is dead, so the last known name is what to search for. */
function searchUrl(place) {
  const query =
    [place.current_name, place.label].filter(Boolean).join(" ") || place.place_id;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export default function Reports() {
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterText, setFilterText] = useState("");
  const [sortBy, setSortBy] = useState("longest");

  async function loadGone() {
    setLoading(true);
    try {
      const res = await fetch("/api/places/gone");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load gone places");
      setPlaces(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadGone();
  }, []);

  // Durations are read at render time on the client, so they reflect now
  // rather than whenever the page was cached.
  const now = Date.now();

  const withDays = useMemo(
    () => places.map((p) => ({ ...p, days: daysSince(p.gone_at, now) })),
    [places, now]
  );

  const visible = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    const filtered = q
      ? withDays.filter(
          (p) =>
            (p.current_name || "").toLowerCase().includes(q) ||
            (p.label || "").toLowerCase().includes(q) ||
            (p.category || "").toLowerCase().includes(q) ||
            p.place_id.toLowerCase().includes(q)
        )
      : withDays;

    const sorted = [...filtered];
    if (sortBy === "longest") sorted.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
    else if (sortBy === "recent") sorted.sort((a, b) => (a.days ?? -1) - (b.days ?? -1));
    else
      sorted.sort((a, b) =>
        (a.current_name || a.place_id).localeCompare(b.current_name || b.place_id)
      );
    return sorted;
  }, [withDays, filterText, sortBy]);

  const stats = useMemo(() => {
    const days = withDays.map((p) => p.days ?? 0);
    return {
      total: withDays.length,
      over30: days.filter((d) => d >= LONG_GONE_DAYS).length,
      over90: days.filter((d) => d >= VERY_LONG_GONE_DAYS).length,
      longest: days.length ? Math.max(...days) : null,
    };
  }, [withDays]);

  return (
    <div className="page page--wide">
      <div className="masthead">
        <h1>Reports</h1>
        <p>
          Places Google Maps no longer serves. A check records the first day a
          place_id stopped resolving, so the duration keeps running from there
          until the place comes back.
        </p>
      </div>

      <div className="bento-grid">
        <div className="bento-card stat-card danger">
          <div className="bento-kicker">
            <span className="accent-dot danger" />
            Gone from Google
          </div>
          <div className="bento-value">{loading ? "…" : stats.total}</div>
          <div className="bento-foot">still tracked, no longer resolving</div>
        </div>

        <div className="bento-card stat-card">
          <div className="bento-kicker">
            <span className="accent-dot muted" />
            Gone over 30 days
          </div>
          <div className="bento-value">{loading ? "…" : stats.over30}</div>
          <div className="bento-foot">possibly replaced or renamed</div>
        </div>

        <div className="bento-card stat-card">
          <div className="bento-kicker">
            <span className="accent-dot muted" />
            Gone over 90 days
          </div>
          <div className="bento-value">{loading ? "…" : stats.over90}</div>
          <div className="bento-foot">worth a search by name</div>
        </div>

        <div className="bento-card stat-card">
          <div className="bento-kicker">
            <span className="accent-dot gold" />
            Longest gone
          </div>
          <div className="bento-value bento-value-sm">
            {loading || stats.longest === null ? "—" : durationLabel(stats.longest)}
          </div>
          <div className="bento-foot">the oldest disappearance on record</div>
        </div>
      </div>

      <div className="bento-card bento-card--wide">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: "0 0 4px" }}>Gone places</h2>
            <p className="hint" style={{ margin: 0 }}>
              Durations count from the first check that found the place missing.
              A place that resolves again drops off this list.
            </p>
          </div>
          <div className="row">
            <a className="btn" href="/api/places/export?type=gone">
              <Icon name="download" />
              Download CSV
            </a>
            <button
              className={`btn icon-only${loading ? " loading" : ""}`}
              onClick={loadGone}
              disabled={loading}
              type="button"
              title="Reload"
              aria-label="Reload gone places"
            >
              <Icon name="refresh" />
            </button>
          </div>
        </div>

        <div className="toolbar">
          <input
            className="grow"
            type="text"
            placeholder="Filter by name, note, category, or place_id..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="empty">Loading...</p>
        ) : places.length === 0 ? (
          <p className="empty">
            Nothing missing — the last check found every tracked place still on
            Google Maps.
          </p>
        ) : visible.length === 0 ? (
          <p className="empty">No gone places match that filter.</p>
        ) : (
          <div className="scroll-panel table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Gone since</th>
                  <th>Missing for</th>
                  <th>Last seen</th>
                  <th>Place ID</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.place_id}>
                    <td>
                      <div className="name-line">{p.current_name || "(unknown)"}</div>
                      {p.label && <div className="hint">{p.label}</div>}
                    </td>
                    <td>
                      <span className="badge">{categoryLabel(p.category)}</span>
                    </td>
                    <td>{shortDate(p.gone_at)}</td>
                    <td>
                      <span className="badge gone">{durationLabel(p.days)}</span>
                    </td>
                    <td>{shortDate(p.last_seen_at)}</td>
                    <td>
                      <span className="place-id-cell">
                        <code className="place-id">{p.place_id}</code>
                        <CopyButton text={p.place_id} />
                      </span>
                    </td>
                    <td>
                      <a
                        className="btn icon-only"
                        href={searchUrl(p)}
                        target="_blank"
                        rel="noreferrer"
                        title="Search Google Maps for this name"
                        aria-label={`Search Google Maps for ${p.current_name || p.place_id}`}
                      >
                        <Icon name="search" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <p className="status">{error}</p>}
      </div>
    </div>
  );
}
