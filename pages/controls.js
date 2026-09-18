import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, guessCategoryFromPlace } from "../lib/categories";

export default function Controls() {
  const [places, setPlaces] = useState([]);

  // --- Search & discover ---
  const [query, setQuery] = useState("");
  const [searchCategory, setSearchCategory] = useState("");
  const [results, setResults] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [selected, setSelected] = useState({});
  const [searching, setSearching] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [searchStatus, setSearchStatus] = useState("");

  // --- Add by ID ---
  const [manualId, setManualId] = useState("");
  const [manualLabel, setManualLabel] = useState("");
  const [manualCategory, setManualCategory] = useState("School");
  const [manualStatus, setManualStatus] = useState("");

  // --- Check now ---
  const [checking, setChecking] = useState(false);
  const [checkStatus, setCheckStatus] = useState("");

  useEffect(() => {
    fetch("/api/places")
      .then((r) => r.json())
      .then((data) => setPlaces(Array.isArray(data) ? data : []));
  }, []);

  const trackedIds = new Set(places.map((p) => p.place_id));

  const resultMeta = useMemo(() => {
    const map = new Map();
    for (const r of results) {
      const guessed = guessCategoryFromPlace({
        primaryType: r.primaryType,
        types: r.types,
        name: r.name,
        address: r.address,
      });
      map.set(r.placeId, {
        guessedCategory: guessed || "Other",
        overrideCategory: searchCategory.trim() || null,
      });
    }
    return map;
  }, [results, searchCategory]);

  function effectiveCategoryFor(placeId) {
    const m = resultMeta.get(placeId);
    if (!m) return searchCategory.trim() || "Other";
    return m.overrideCategory || m.guessedCategory;
  }

  async function runSearch(pageToken) {
    if (!query.trim()) return;
    setSearching(true);
    setSearchStatus("");
    try {
      const res = await fetch("/api/places/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, pageToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");

      setResults((prev) => {
        if (!pageToken) return data.places;
        const seen = new Set(prev.map((p) => p.placeId));
        const merged = [...prev];
        for (const p of data.places) {
          if (!seen.has(p.placeId)) {
            merged.push(p);
            seen.add(p.placeId);
          }
        }
        return merged;
      });
      setNextPageToken(data.nextPageToken);
      if (data.places.length === 0 && !pageToken) {
        setSearchStatus("No results for that search.");
      }
    } catch (err) {
      setSearchStatus(String(err.message || err));
    } finally {
      setSearching(false);
    }
  }

  async function runScanAll() {
    if (!query.trim()) return;
    setScanning(true);
    setSearchStatus("Scanning every available page — this can take a few seconds...");
    try {
      const res = await fetch("/api/places/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, scanAll: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");

      const seen = new Set();
      const deduped = (data.places || []).filter((p) =>
        seen.has(p.placeId) ? false : (seen.add(p.placeId), true)
      );
      setResults(deduped);
      setNextPageToken(null);
      setSearchStatus(
        `Scanned ${data.scannedPages} page${data.scannedPages === 1 ? "" : "s"}, found ${
          deduped.length
        } result${deduped.length === 1 ? "" : "s"}.` +
          (data.exhausted ? "" : " Google may hold more — narrow your search to see them.")
      );
    } catch (err) {
      setSearchStatus(String(err.message || err));
    } finally {
      setScanning(false);
    }
  }

  function toggleSelected(placeId) {
    if (trackedIds.has(placeId)) return;
    setSelected((prev) => ({ ...prev, [placeId]: !prev[placeId] }));
  }

  async function addPlaces(list) {
    const fresh = list.filter((p) => !trackedIds.has(p.placeId));
    if (fresh.length === 0) {
      setSearchStatus("Those are already tracked — nothing new to add.");
      return;
    }
    setSearchStatus(`Adding ${fresh.length}...`);
    const overrideCategory = searchCategory.trim() || null;
    const rows = fresh.map((p) => ({
      ...p,
      category: overrideCategory ?? effectiveCategoryFor(p.placeId) ?? null,
    }));
    const res = await fetch("/api/places/bulk-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ places: rows, category: overrideCategory }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSearchStatus(data.error || "Failed to add");
      return;
    }
    const skippedNote = data.skipped ? ` (${data.skipped} already tracked, skipped)` : "";
    setSearchStatus(
      `Now tracking ${data.added} new place${data.added === 1 ? "" : "s"}.${skippedNote}`
    );
    setSelected({});
    setPlaces((prev) => [...prev, ...data.places]);
  }

  function addSelected() {
    const chosen = results.filter((r) => selected[r.placeId] && !trackedIds.has(r.placeId));
    addPlaces(chosen);
  }

  function addAllLoaded() {
    addPlaces(results);
  }

  async function addManual(e) {
    e.preventDefault();
    const id = manualId.trim();
    if (!id) return;
    if (trackedIds.has(id)) {
      setManualStatus("Already tracked.");
      return;
    }
    setManualStatus("Adding...");
    const res = await fetch("/api/places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        place_id: id,
        label: manualLabel.trim() || null,
        category: manualCategory.trim() || null,
      }),
    });
    const data = await res.json();
    if (res.status === 409) {
      setManualStatus(`Already tracked as "${data.place?.current_name || id}".`);
      return;
    }
    if (!res.ok) {
      setManualStatus(data.error || "Failed to add");
      return;
    }
    setManualStatus(`Tracking "${data.current_name}".`);
    setManualId("");
    setManualLabel("");
    setPlaces((prev) => [...prev, data]);
  }

  async function runCheckNow() {
    setChecking(true);
    setCheckStatus("Checking every tracked place against Google...");
    try {
      const res = await fetch("/api/cron/check");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check failed");
      const pushNote =
        data.telegram && data.telegram.ok
          ? " Telegram notified."
          : data.telegram && data.telegram.skipped
          ? ""
          : data.telegram && data.telegram.error
          ? " (Telegram push failed.)"
          : "";
      setCheckStatus(
        `Checked ${data.checked}. ${data.changed} name${
          data.changed === 1 ? "" : "s"
        } changed.${pushNote}`
      );
    } catch (err) {
      setCheckStatus(String(err.message || err));
    } finally {
      setChecking(false);
    }
  }

  const addableResultsCount = results.filter((r) => !trackedIds.has(r.placeId)).length;

  return (
    <div className="page">
      <datalist id="category-suggestions">
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value} />
        ))}
      </datalist>

      <div className="masthead">
        <h1>Controls</h1>
        <p>Search and add places, run a check, and export your data.</p>
      </div>

      <div className="bento-grid">
        <div className="bento-card bento-card--wide">
          <h2>Find places to track</h2>
          <p className="hint">
            Search Google Maps by name and area — e.g. "high school
            Battambang" or "market Siem Reap" — then add the ones you want
            to watch. Category is free text, so it works for any place
            type.
          </p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              setResults([]);
              setNextPageToken(null);
              runSearch(null);
            }}
          >
            <input
              className="grow"
              type="text"
              placeholder="e.g. high school Battambang Cambodia"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <input
              className="cat-input"
              list="category-suggestions"
              type="text"
              placeholder="Category (auto)"
              value={searchCategory}
              onChange={(e) => setSearchCategory(e.target.value)}
            />
            <button className="btn primary" type="submit" disabled={searching || scanning}>
              {searching ? "Searching..." : "Search"}
            </button>
          </form>

          {results.length > 0 && (
            <>
              <div className="results scroll-panel">
                {results.map((r) => {
                  const isTracked = trackedIds.has(r.placeId);
                  const effective = effectiveCategoryFor(r.placeId);
                  const m = resultMeta.get(r.placeId);
                  const wasGuessed = m && !m.overrideCategory;
                  return (
                    <label
                      className={`result-item${isTracked ? " tracked" : ""}`}
                      key={r.placeId}
                    >
                      <input
                        type="checkbox"
                        checked={!!selected[r.placeId]}
                        disabled={isTracked}
                        onChange={() => toggleSelected(r.placeId)}
                      />
                      <div className="grow">
                        <div className="name">{r.name}</div>
                        <div className="addr">{r.address}</div>
                      </div>
                      <span className={`badge${wasGuessed ? " auto" : ""}`} title={wasGuessed ? "Auto-detected from scan" : "Manual override"}>
                        {effective}
                      </span>
                      {isTracked && <span className="badge">Already tracked</span>}
                    </label>
                  );
                })}
              </div>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn primary" onClick={addSelected}>
                  Add selected
                </button>
                <button
                  className="btn"
                  onClick={addAllLoaded}
                  disabled={addableResultsCount === 0}
                >
                  Add all {addableResultsCount} new
                </button>
                {nextPageToken && (
                  <button
                    className="btn"
                    onClick={() => runSearch(nextPageToken)}
                    disabled={searching || scanning}
                  >
                    {searching ? "Loading..." : "Load more results"}
                  </button>
                )}
                <button className="btn" onClick={runScanAll} disabled={searching || scanning}>
                  {scanning ? "Scanning..." : "Scan all pages"}
                </button>
              </div>
            </>
          )}
          {searchStatus && <p className="status">{searchStatus}</p>}
        </div>

        <div className="bento-card">
          <h2>Add a specific place by ID</h2>
          <p className="hint">
            Already know the place_id (from a Google Maps share link or the
            Place ID Finder)? Add it directly.
          </p>
          <form className="stack" onSubmit={addManual}>
            <input
              type="text"
              placeholder="ChIJM8qG5qs3DDERP162lCD26pY"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
            />
            <input
              type="text"
              placeholder="Note (optional)"
              value={manualLabel}
              onChange={(e) => setManualLabel(e.target.value)}
            />
            <input
              list="category-suggestions"
              type="text"
              placeholder="Category"
              value={manualCategory}
              onChange={(e) => setManualCategory(e.target.value)}
            />
            <button className="btn primary" type="submit">
              Track
            </button>
          </form>
          {manualStatus && <p className="status">{manualStatus}</p>}
        </div>

        <div className="bento-card">
          <h2>Run a check</h2>
          <p className="hint">
            Checks every tracked place against Google right now — the same
            thing the daily automatic check does.
          </p>
          <button className="btn primary" onClick={runCheckNow} disabled={checking}>
            {checking ? "Checking..." : "Check now"}
          </button>
          {checkStatus && <p className="status">{checkStatus}</p>}
          <p className="hint" style={{ marginTop: 16, marginBottom: 0 }}>
            Automatic check runs daily at <strong>7:00 AM Phnom Penh time</strong> (00:00 UTC).
            Set <code>TELEGRAM_BOT_TOKEN</code> / <code>TELEGRAM_CHAT_ID</code> to get a push
            when it finishes.
          </p>
        </div>

        <div className="bento-card bento-card--wide">
          <h2>Export</h2>
          <p className="hint">Download your tracked places or the full rename history.</p>
          <div className="row">
            <a className="btn" href="/api/places/export?type=places&format=csv">
              Places · CSV
            </a>
            <a className="btn" href="/api/places/export?type=places&format=json">
              Places · JSON
            </a>
            <a className="btn" href="/api/places/export?type=history&format=csv">
              History · CSV
            </a>
            <a className="btn" href="/api/places/export?type=history&format=json">
              History · JSON
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
