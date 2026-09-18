import { Fragment, useEffect, useMemo, useState } from "react";
import { categoryLabel } from "../lib/categories";

const SORT_OPTIONS = [
  { value: "name_asc", label: "Name (A–Z)" },
  { value: "name_desc", label: "Name (Z–A)" },
  { value: "category", label: "Category" },
  { value: "last_checked_desc", label: "Last checked (newest)" },
  { value: "last_checked_asc", label: "Last checked (oldest)" },
  { value: "created_desc", label: "Recently added" },
];

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-btn"
      title="Copy place_id"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

function nextCheckDate() {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export default function Dashboard() {
  const [places, setPlaces] = useState([]);
  const [loadingPlaces, setLoadingPlaces] = useState(true);
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState(null);

  const [openHistoryFor, setOpenHistoryFor] = useState(null);
  const [historyByPlace, setHistoryByPlace] = useState({});

  const [filterText, setFilterText] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [sortBy, setSortBy] = useState("name_asc");
  const [groupByCategory, setGroupByCategory] = useState(false);

  async function loadPlaces() {
    setLoadingPlaces(true);
    const res = await fetch("/api/places");
    const data = await res.json();
    setPlaces(Array.isArray(data) ? data : []);
    setLoadingPlaces(false);
  }

  async function loadStats() {
    const res = await fetch("/api/stats");
    const data = await res.json();
    setStats(data);
  }

  async function loadRecent() {
    const res = await fetch("/api/history/recent?limit=8");
    const data = await res.json();
    setRecent(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    loadPlaces();
    loadStats();
    loadRecent();
  }, []);

  const availableCategories = useMemo(() => {
    const set = new Set();
    for (const p of places) set.add(categoryLabel(p.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [places]);

  const visiblePlaces = useMemo(() => {
    let list = places;
    if (filterCategory !== "all") {
      list = list.filter((p) => categoryLabel(p.category) === filterCategory);
    }
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      list = list.filter(
        (p) =>
          (p.current_name || "").toLowerCase().includes(q) ||
          (p.label || "").toLowerCase().includes(q) ||
          p.place_id.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case "name_desc":
          return (b.current_name || "").localeCompare(a.current_name || "");
        case "category":
          return categoryLabel(a.category).localeCompare(categoryLabel(b.category));
        case "last_checked_desc":
          return new Date(b.last_checked_at || 0) - new Date(a.last_checked_at || 0);
        case "last_checked_asc":
          return new Date(a.last_checked_at || 0) - new Date(b.last_checked_at || 0);
        case "created_desc":
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        case "name_asc":
        default:
          return (a.current_name || "").localeCompare(b.current_name || "");
      }
    });
  }, [places, filterText, filterCategory, sortBy]);

  const groupedPlaces = useMemo(() => {
    if (!groupByCategory) return null;
    const map = new Map();
    for (const p of visiblePlaces) {
      const key = categoryLabel(p.category);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [visiblePlaces, groupByCategory]);

  async function removePlace(placeId) {
    if (!confirm("Stop tracking this place?")) return;
    await fetch("/api/places", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place_id: placeId }),
    });
    loadPlaces();
    loadStats();
  }

  async function toggleHistory(placeId) {
    if (openHistoryFor === placeId) {
      setOpenHistoryFor(null);
      return;
    }
    setOpenHistoryFor(placeId);
    if (!historyByPlace[placeId]) {
      const res = await fetch(`/api/places/${placeId}/history`);
      const data = await res.json();
      setHistoryByPlace((prev) => ({ ...prev, [placeId]: data }));
    }
  }

  function renderPlaceRow(p) {
    const hist = historyByPlace[p.place_id];
    const wasRenamed = hist && hist.length > 0;
    return (
      <Fragment key={p.place_id}>
        <tr>
          <td>
            <div>{p.current_name || "(unknown)"}</div>
            {p.label && <div className="addr">{p.label}</div>}
          </td>
          <td>
            <span className={`badge ${wasRenamed ? "renamed" : ""}`}>
              {categoryLabel(p.category)}
            </span>
          </td>
          <td>
            <div className="place-id-cell">
              <code className="place-id">{p.place_id}</code>
              <CopyButton text={p.place_id} />
            </div>
          </td>
          <td className="addr">
            {p.last_checked_at ? new Date(p.last_checked_at).toLocaleString() : "never"}
          </td>
          <td>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => toggleHistory(p.place_id)}>
                History
              </button>
              <button className="btn danger" onClick={() => removePlace(p.place_id)}>
                Remove
              </button>
            </div>
          </td>
        </tr>
        {openHistoryFor === p.place_id && (
          <tr>
            <td colSpan={5}>
              <div className="history">
                {!hist ? (
                  "Loading..."
                ) : hist.length === 0 ? (
                  "No renames recorded yet."
                ) : (
                  hist.map((h) => (
                    <div className="change" key={h.id}>
                      <span className="arrow-line">
                        {h.old_name} → {h.new_name}
                      </span>
                      <br />
                      {new Date(h.changed_at).toLocaleString()}
                    </div>
                  ))
                )}
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  const next = nextCheckDate();

  return (
    <div className="page">
      <div className="masthead">
        <h1>Dashboard</h1>
        <p>
          Everything you're tracking, at a glance. Add new places or run a
          check from the <a href="/controls">Controls</a> page.
        </p>
      </div>

      <div className="bento-grid">
        <div className="bento-card accent-jade">
          <div className="bento-kicker">Tracked places</div>
          <div className="bento-value">{stats ? stats.totalPlaces : "—"}</div>
          <div className="bento-foot">across {stats ? stats.totalCategories : "—"} categories</div>
        </div>

        <div className="bento-card accent-gold">
          <div className="bento-kicker">Renames logged</div>
          <div className="bento-value">{stats ? stats.totalRenames : "—"}</div>
          <div className="bento-foot">all-time</div>
        </div>

        <div className="bento-card">
          <div className="bento-kicker">Last checked</div>
          <div className="bento-value bento-value-sm">
            {stats && stats.lastCheckedAt
              ? new Date(stats.lastCheckedAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "never"}
          </div>
          <div className="bento-foot">most recent run</div>
        </div>

        <div className="bento-card">
          <div className="bento-kicker">Next auto-check</div>
          <div className="bento-value bento-value-sm">
            {next.toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
          <div className="bento-foot">7:00 AM Phnom Penh · daily</div>
        </div>

        <div className="bento-card bento-card--main">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>
              Tracked places ({visiblePlaces.length} of {places.length})
            </h2>
          </div>

          <div className="toolbar">
            <input
              className="grow"
              type="text"
              placeholder="Filter by name, note, or place_id..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="all">All categories</option>
              {availableCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              {SORT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={groupByCategory}
                onChange={(e) => setGroupByCategory(e.target.checked)}
              />
              Group by category
            </label>
          </div>

          {loadingPlaces ? (
            <p className="empty">Loading...</p>
          ) : places.length === 0 ? (
            <p className="empty">
              Nothing tracked yet — head to <a href="/controls">Controls</a> to search and add
              places.
            </p>
          ) : visiblePlaces.length === 0 ? (
            <p className="empty">No tracked places match that filter.</p>
          ) : (
            <div className="scroll-panel table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Place ID</th>
                    <th>Last checked</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {groupedPlaces
                    ? groupedPlaces.map(([groupName, groupPlaces]) => (
                        <Fragment key={groupName}>
                          <tr className="group-row">
                            <td colSpan={5}>
                              {groupName} · {groupPlaces.length}
                            </td>
                          </tr>
                          {groupPlaces.map(renderPlaceRow)}
                        </Fragment>
                      ))
                    : visiblePlaces.map(renderPlaceRow)}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bento-card bento-card--side">
          <h2 style={{ margin: "0 0 4px" }}>Recent renames</h2>
          <p className="hint">Latest changes across every tracked place.</p>
          {recent === null ? (
            <p className="empty">Loading...</p>
          ) : recent.length === 0 ? (
            <p className="empty">No renames recorded yet.</p>
          ) : (
            <div className="feed scroll-panel">
              {recent.map((h) => (
                <div className="feed-item" key={`${h.place_id}-${h.changed_at}`}>
                  <div className="feed-names">
                    <span className="feed-old">{h.old_name}</span>
                    <span className="feed-arrow">→</span>
                    <span className="feed-new">{h.new_name}</span>
                  </div>
                  <div className="feed-meta">
                    {h.label && <span>{h.label} · </span>}
                    {new Date(h.changed_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
