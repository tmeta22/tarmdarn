import { Fragment, useEffect, useMemo, useState } from "react";
import { CATEGORIES, categoryLabel } from "../lib/categories";
import Icon from "../components/Icon";

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
      className={`copy-btn${copied ? " copied" : ""}`}
      title="Copy place_id"
      aria-label={`Copy place_id ${text}`}
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
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? (
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      ) : (
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
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

  const [editing, setEditing] = useState(null); // { placeId, category, label }
  const [editStatus, setEditStatus] = useState({}); // placeId -> "saving" | "saved" | err

  const [duplicates, setDuplicates] = useState(null);
  const [loadingDup, setLoadingDup] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState(null);
  const [dupStatus, setDupStatus] = useState({}); // clusterIdx -> "merging" | okMsg | errMsg
  const [canonicalChoice, setCanonicalChoice] = useState({}); // clusterIdx -> placeId

  const [filterText, setFilterText] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [sortBy, setSortBy] = useState("name_asc");
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [view, setView] = useState("table");
  const [nextCheck, setNextCheck] = useState(null);

  // Restore the last view mode, then keep it in sync as it changes.
  useEffect(() => {
    const saved = window.localStorage.getItem("taamdan-view");
    if (saved === "table" || saved === "grid" || saved === "tile") setView(saved);
  }, []);

  function changeView(next) {
    setView(next);
    window.localStorage.setItem("taamdan-view", next);
  }

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
    // Rendered on the client only: the formatted string depends on the
    // viewer's locale and time zone, which the server can't know, so
    // formatting it during SSR mismatches on hydration.
    setNextCheck(nextCheckDate());
  }, []);

  function startEditing(p) {
    setEditing({
      placeId: p.place_id,
      category: p.category || "",
      label: p.label || "",
    });
  }

  function cancelEditing() {
    setEditing(null);
  }

  async function saveEditing(placeId) {
    if (!editing || editing.placeId !== placeId) return;
    setEditStatus((s) => ({ ...s, [placeId]: "saving" }));
    try {
      const res = await fetch("/api/places", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place_id: placeId,
          category: editing.category,
          label: editing.label,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setPlaces((prev) => prev.map((p) => (p.place_id === placeId ? { ...p, ...data } : p)));
      setEditStatus((s) => ({ ...s, [placeId]: "saved" }));
      setTimeout(() => {
        setEditStatus((s) => {
          const copy = { ...s };
          delete copy[placeId];
          return copy;
        });
      }, 1500);
      setEditing(null);
    } catch (err) {
      setEditStatus((s) => ({ ...s, [placeId]: String(err.message || err) }));
    }
  }

  async function fetchDuplicates() {
    setLoadingDup(true);
    setDuplicatesError(null);
    try {
      const res = await fetch("/api/places/duplicates");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to scan");
      setDuplicates(data.clusters || []);
    } catch (err) {
      setDuplicatesError(String(err.message || err));
    } finally {
      setLoadingDup(false);
    }
  }

  async function performMerge(clusterIdx) {
    const cluster = duplicates?.[clusterIdx];
    if (!cluster) return;
    const canonical =
      canonicalChoice[clusterIdx] || cluster.canonicalPlaceId || cluster.placeIds[0];
    const removeIds = cluster.placeIds.filter((id) => id !== canonical);
    if (removeIds.length === 0) return;
    setDupStatus((s) => ({ ...s, [clusterIdx]: "merging" }));
    try {
      const res = await fetch("/api/places/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonicalPlaceId: canonical, removePlaceIds: removeIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Merge failed");
      setDupStatus((s) => ({
        ...s,
        [clusterIdx]: `Merged — kept ${canonical}${data.patched ? " (label/category filled in)" : ""}`,
      }));
      await Promise.all([loadPlaces(), loadStats()]);
      setTimeout(() => fetchDuplicates(), 300);
    } catch (err) {
      setDupStatus((s) => ({ ...s, [clusterIdx]: String(err.message || err) }));
    }
  }

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

  // Icon-only so the row/card stays compact; the label lives in the
  // tooltip and the accessible name.
  function renderActions(p) {
    const isEditing = editing?.placeId === p.place_id;
    const editStatusFor = editStatus[p.place_id];
    const name = p.current_name || p.place_id;
    return (
      <>
        {isEditing ? (
          <>
            <button
              className="btn primary"
              disabled={editStatusFor === "saving"}
              onClick={() => saveEditing(p.place_id)}
            >
              <Icon name="check" />
              {editStatusFor === "saving" ? "Saving..." : "Save"}
            </button>
            <button
              className="btn icon-only"
              disabled={editStatusFor === "saving"}
              onClick={cancelEditing}
              title="Cancel"
              aria-label="Cancel editing"
            >
              <Icon name="close" />
            </button>
          </>
        ) : (
          <button
            className="btn icon-only"
            onClick={() => startEditing(p)}
            title="Edit category / note"
            aria-label={`Edit ${name}`}
          >
            <Icon name="edit" />
          </button>
        )}
        <button
          className="btn icon-only"
          onClick={() => toggleHistory(p.place_id)}
          title="Rename history"
          aria-label={`Rename history for ${name}`}
          aria-expanded={openHistoryFor === p.place_id}
        >
          <Icon name="history" />
        </button>
        <button
          className="btn danger icon-only"
          onClick={() => removePlace(p.place_id)}
          disabled={isEditing}
          title="Stop tracking"
          aria-label={`Stop tracking ${name}`}
        >
          <Icon name="trash" />
        </button>
      </>
    );
  }

  function renderHistory(placeId) {
    if (openHistoryFor !== placeId) return null;
    const hist = historyByPlace[placeId];
    return (
      <div className="history">
        {!hist ? (
          "Loading..."
        ) : hist.length === 0 ? (
          "No renames recorded yet."
        ) : (
          hist.map((h) => (
            <div className="change" key={h.id}>
              <span className="arrow-line">
                {h.old_name}
                <Icon name="arrow" />
                {h.new_name}
              </span>
              <br />
              {new Date(h.changed_at).toLocaleString()}
            </div>
          ))
        )}
      </div>
    );
  }

  function renderPlaceRow(p) {
    const hist = historyByPlace[p.place_id];
    const wasRenamed = hist && hist.length > 0;
    const isEditing = editing?.placeId === p.place_id;
    const editStatusFor = editStatus[p.place_id];

    return (
      <Fragment key={p.place_id}>
        <tr className={isEditing ? "editing-row" : ""}>
          <td>
            <div className="name-line">{p.current_name || "(unknown)"}</div>
            {isEditing ? (
              <input
                className="inline-input"
                type="text"
                placeholder="Note / address"
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEditing(p.place_id);
                  if (e.key === "Escape") cancelEditing();
                }}
              />
            ) : p.label ? (
              <div className="addr">{p.label}</div>
            ) : null}
          </td>
          <td>
            {isEditing ? (
              <input
                className="inline-input cat-edit"
                list="category-suggestions-table"
                type="text"
                placeholder="Category"
                value={editing.category}
                onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEditing(p.place_id);
                  if (e.key === "Escape") cancelEditing();
                }}
              />
            ) : (
              <span
                className={`badge ${wasRenamed ? "renamed" : ""}${
                  !p.category ? " uncategorized" : ""
                }`}
              >
                {categoryLabel(p.category)}
              </span>
            )}
            {editStatusFor && editStatusFor !== "saving" && editStatusFor !== "saved" && (
              <div className="inline-err">{editStatusFor}</div>
            )}
            {editStatusFor === "saved" && <div className="inline-ok">Saved</div>}
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
            <div className="row row-actions">{renderActions(p)}</div>
          </td>
        </tr>
        {openHistoryFor === p.place_id && (
          <tr>
            <td colSpan={5}>{renderHistory(p.place_id)}</td>
          </tr>
        )}
      </Fragment>
    );
  }

  function renderPlaceCard(p) {
    const hist = historyByPlace[p.place_id];
    const wasRenamed = hist && hist.length > 0;
    const isEditing = editing?.placeId === p.place_id;
    const editStatusFor = editStatus[p.place_id];

    return (
      <div className={`pcard${isEditing ? " editing" : ""}`} key={p.place_id}>
        <div className="pcard-head">
          <span className="pcard-title">{p.current_name || "(unknown)"}</span>
          {isEditing ? (
            <input
              className="inline-input cat-edit"
              list="category-suggestions-table"
              type="text"
              placeholder="Category"
              value={editing.category}
              onChange={(e) => setEditing({ ...editing, category: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEditing(p.place_id);
                if (e.key === "Escape") cancelEditing();
              }}
            />
          ) : (
            <span
              className={`badge ${wasRenamed ? "renamed" : ""}${
                !p.category ? " uncategorized" : ""
              }`}
            >
              {categoryLabel(p.category)}
            </span>
          )}
        </div>

        {isEditing ? (
          <input
            className="inline-input"
            type="text"
            placeholder="Note / address"
            value={editing.label}
            onChange={(e) => setEditing({ ...editing, label: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveEditing(p.place_id);
              if (e.key === "Escape") cancelEditing();
            }}
          />
        ) : p.label ? (
          <span className="pcard-label">{p.label}</span>
        ) : null}

        <div className="place-id-cell">
          <code className="place-id pcard-id">{p.place_id}</code>
          <CopyButton text={p.place_id} />
        </div>

        {editStatusFor && editStatusFor !== "saving" && editStatusFor !== "saved" && (
          <div className="inline-err">{editStatusFor}</div>
        )}
        {editStatusFor === "saved" && <div className="inline-ok">Saved</div>}

        <div className="pcard-actions">{renderActions(p)}</div>

        {renderHistory(p.place_id)}
      </div>
    );
  }

  const dupCount = duplicates?.length ?? null;

  return (
    <div className="page">
      <datalist id="category-suggestions-table">
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value} />
        ))}
      </datalist>

      <div className="masthead">
        <h1>Dashboard</h1>
        <p>
          Everything you're tracking, at a glance. Add new places or run a
          check from the <a href="/controls">Controls</a> page.
        </p>
      </div>

      <div className="bento-grid">
        <div className="bento-card stat-card accent">
          <div className="bento-kicker">
            <span className="accent-dot" />
            Tracked places
          </div>
          <div className="bento-value">{stats ? stats.totalPlaces : "—"}</div>
          <div className="bento-foot">across {stats ? stats.totalCategories : "—"} categories</div>
        </div>

        <div className="bento-card stat-card gold">
          <div className="bento-kicker">
            <span className="accent-dot gold" />
            Renames logged
          </div>
          <div className="bento-value">{stats ? stats.totalRenames : "—"}</div>
          <div className="bento-foot">all-time</div>
        </div>

        <div className="bento-card stat-card">
          <div className="bento-kicker">
            <span className="accent-dot muted" />
            Last checked
          </div>
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

        <div className={dupCount ? "bento-card stat-card danger" : "bento-card stat-card"}>
          <div className="bento-kicker">
            <span className={`accent-dot${dupCount ? " danger" : " muted"}`} />
            Possible duplicates
          </div>
          <div className="bento-value bento-value-sm">
          {duplicates === null ? (loadingDup ? "…" : dupCount ?? "Click to scan") : dupCount}
          </div>
          <div className="bento-foot" style={{ marginTop: 8 }}>
            <button
              className={`btn icon-only${loadingDup ? " loading" : ""}`}
              onClick={fetchDuplicates}
              disabled={loadingDup}
              type="button"
              title="Scan for duplicate place IDs"
              aria-label="Scan for duplicate place IDs"
            >
              <Icon name="refresh" />
            </button>
          </div>
        </div>

        <div className="bento-card stat-card">
          <div className="bento-kicker">
            <span className="accent-dot muted" />
            Next auto-check
          </div>
          <div className="bento-value bento-value-sm">
            {nextCheck
              ? nextCheck.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "—"}
          </div>
          <div className="bento-foot">7:00 AM Phnom Penh · daily</div>
        </div>

        {duplicates && duplicates.length > 0 && (
          <div className="bento-card bento-card--wide dup-card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h2 style={{ margin: "0 0 4px" }}>Possible duplicate place IDs</h2>
              <p className="hint" style={{ margin: 0 }}>
                These look like the same physical place tracked under multiple
                Google IDs. Probed against Google right now — dead/
                404'd IDs are flagged so you can keep the live one.
              </p>
            </div>
            <button
              className={`btn icon-only${loadingDup ? " loading" : ""}`}
              onClick={fetchDuplicates}
              disabled={loadingDup}
              type="button"
              title="Rescan duplicate place IDs"
              aria-label="Rescan duplicate place IDs"
            >
              <Icon name="refresh" />
            </button>
          </div>
          <div className="dup-list scroll-panel">
            {duplicates.map((c, clusterIdx) => {
              const chosenCanonical =
                canonicalChoice[clusterIdx] || c.canonicalPlaceId;
              const status = dupStatus[clusterIdx];
              return (
                <div className="dup-cluster" key={clusterIdx}>
                  <div className="dup-head">
                    <div className="dup-name">{c.sharedName}</div>
                    <div className="dup-head-tags">
                      <span className="badge dup-badge">{c.placeIds.length} IDs</span>
                      {c.aliveCount > 0 && (
                        <span className="badge dup-badge ok">
                          {c.aliveCount} live
                        </span>
                      )}
                      {c.deadCount > 0 && (
                        <span className="badge dup-badge bad">
                          {c.deadCount} stale
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="dup-rows">
                    {c.rows.map((row) => {
                      const probe = (c.probes || []).find(
                        (p) => p.placeId === row.place_id
                      );
                      const isCanonical = chosenCanonical === row.place_id;
                      const className = [
                        "dup-row",
                        probe?.alive === false ? "dead" : "",
                        probe?.alive === true ? "alive" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <label className={className} key={row.place_id}>
                          <input
                            type="radio"
                            name={`dup-cluster-${clusterIdx}`}
                            checked={isCanonical}
                            onChange={() =>
                              setCanonicalChoice((prev) => ({
                                ...prev,
                                [clusterIdx]: row.place_id,
                              }))
                            }
                          />
                          <div className="dup-row-main">
                            <div className="dup-row-name">
                              {row.current_name || "(no name)"}
                              {row.category && (
                                <span className="badge" style={{ marginLeft: 10 }}>
                                  {categoryLabel(row.category)}
                                </span>
                              )}
                            </div>
                            <div className="dup-row-meta">
                              <code className="place-id" style={{ maxWidth: 340 }}>
                                {row.place_id}
                              </code>
                              {row.label && (
                                <>
                                  {" · "}
                                  <span className="addr">{row.label}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="dup-row-probe">
                            {probe?.alive ? (
                              <span className="probe ok">
                                <span className="dot" />
                                live
                              </span>
                            ) : probe?.alive === false ? (
                              <span
                                className={`probe ${probe.notFound ? "bad" : "warn"}`}
                              >
                                <span className="dot" />
                                {probe.notFound
                                  ? "404 / removed by Google"
                                  : "probe failed"}
                              </span>
                            ) : (
                              <span className="probe">
                                <span className="dot" />
                                not probed
                              </span>
                            )}
                            {isCanonical && c.canonicalPlaceId === row.place_id && (
                              <span className="hint dup-suggest">suggested</span>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <div className="dup-actions">
                    <button
                      className="btn primary"
                      onClick={() => performMerge(clusterIdx)}
                      disabled={status === "merging"}
                      type="button"
                    >
                      {status === "merging" ? (
                        "Merging..."
                      ) : (
                        <>
                          <Icon name="merge" />
                          {`Keep ${chosenCanonical.slice(0, 14)}… and remove ${
                            c.placeIds.length - 1
                          }`}
                        </>
                      )}
                    </button>
                    <div className="dup-status">
                      {typeof status === "string" && status !== "merging"
                        ? status
                        : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {duplicatesError && <p className="status">{duplicatesError}</p>}
        </div>
      )}

        <div className="bento-card bento-card--main">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>
              Tracked places ({visiblePlaces.length} of {places.length})
            </h2>
            <div className="view-switch" role="group" aria-label="View mode">
              <button
                type="button"
                className={view === "table" ? "active" : ""}
                onClick={() => changeView("table")}
                title="Table view"
                aria-label="Table view"
                aria-pressed={view === "table"}
              >
                <Icon name="viewTable" />
              </button>
              <button
                type="button"
                className={view === "grid" ? "active" : ""}
                onClick={() => changeView("grid")}
                title="Grid view"
                aria-label="Grid view"
                aria-pressed={view === "grid"}
              >
                <Icon name="viewGrid" />
              </button>
              <button
                type="button"
                className={view === "tile" ? "active" : ""}
                onClick={() => changeView("tile")}
                title="Tile view"
                aria-label="Tile view"
                aria-pressed={view === "tile"}
              >
                <Icon name="viewTiles" />
              </button>
            </div>
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
          ) : view === "table" ? (
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
          ) : groupedPlaces ? (
            groupedPlaces.map(([groupName, groupPlaces]) => (
              <div className="place-group" key={groupName}>
                <div className="group-heading">
                  {groupName} · {groupPlaces.length}
                </div>
                <div className={`place-cards ${view}`}>{groupPlaces.map(renderPlaceCard)}</div>
              </div>
            ))
          ) : (
            <div className={`place-cards ${view}`}>{visiblePlaces.map(renderPlaceCard)}</div>
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
                    <span className="feed-arrow">
                      <Icon name="arrow" />
                    </span>
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
