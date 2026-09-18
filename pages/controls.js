import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, guessCategoryFromPlace } from "../lib/categories";
import Icon from "../components/Icon";

// ---------------------------------------------------------------------------
// Lightweight CSV parser (RFC 4180-ish, no deps).
// Handles CR/LF/CRLF line endings, quoted fields, escaped "".
// Returns the raw cell grid — deciding which row is a header, and which
// column means what, is up to the caller.
// ---------------------------------------------------------------------------
function parseCSV(text) {
  if (!text) return { table: [] };
  // Strip a possible UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (inQuotes) {
      if (c === '"') {
        if (n === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (n === "\n") i += 2;
      else i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return {
    table: rows
      .filter((r) => r.some((v) => (v || "").trim() !== ""))
      .map((r) => r.map((v) => (v ?? "").trim())),
  };
}

// ---------------------------------------------------------------------------
// Scan textarea parsers: lines -> candidate rows
// ---------------------------------------------------------------------------
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,}$/;

// ---------------------------------------------------------------------------
// CSV column mapping
//
// Headers are treated as a hint, never a requirement: any file can be
// imported by picking columns by hand, and the guesses below just save
// clicks for the common shapes.
// ---------------------------------------------------------------------------
const CSV_FIELDS = [
  { key: "placeId", label: "Place ID" },
  { key: "name", label: "Name" },
  { key: "label", label: "Note / address" },
  { key: "category", label: "Category" },
];

const HEADER_HINTS = {
  placeId: ["place_id", "placeid", "place id", "google_place_id", "googleplaceid", "id", "gid", "cid"],
  name: [
    "name",
    "current_name",
    "currentname",
    "place_name",
    "placename",
    "place name",
    "title",
    "displayname",
    "display_name",
    "display name",
    "school",
  ],
  label: [
    "label",
    "address",
    "formatted_address",
    "formattedaddress",
    "addr",
    "note",
    "notes",
    "location",
    "description",
  ],
  category: ["category", "type", "types", "group", "kind", "tag"],
};

function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/** Column names for the mapping UI: real headers, or positional placeholders. */
function csvColumnNames(csv, hasHeader) {
  const first = (csv && csv.table[0]) || [];
  return first.map((cell, index) => {
    if (!hasHeader) return { index, name: `Column ${index + 1}` };
    const label = String(cell || "").trim();
    return { index, name: label || `Column ${index + 1}` };
  });
}

/**
 * Best-effort mapping so a file with recognisable headers needs no clicks.
 * Falls back to sniffing the first data row, which is what makes headerless
 * files workable.
 */
function guessCsvMapping(csv, hasHeader) {
  const map = { placeId: "", name: "", label: "", category: "" };
  const columns = csvColumnNames(csv, hasHeader);
  const dataRows = hasHeader ? csv.table.slice(1) : csv.table;
  const firstRow = dataRows[0] || [];
  const taken = new Set();

  // 1. Recognised header names win.
  const normalized = columns.map((c) => normalizeHeader(c.name));
  for (const { key } of CSV_FIELDS) {
    const hints = HEADER_HINTS[key];
    const idx = normalized.findIndex((n, i) => !taken.has(i) && hints.includes(n));
    if (idx !== -1) {
      map[key] = idx;
      taken.add(idx);
    }
  }

  // 2. Otherwise look at the data: a place_id-shaped cell identifies that column.
  if (map.placeId === "") {
    const idx = firstRow.findIndex(
      (v, i) => !taken.has(i) && PLACE_ID_RE.test(String(v || "").trim())
    );
    if (idx !== -1) {
      map.placeId = idx;
      taken.add(idx);
    }
  }

  // 3. And the first remaining text column is the most likely name.
  if (map.name === "") {
    const idx = firstRow.findIndex((v, i) => {
      if (taken.has(i)) return false;
      const s = String(v || "").trim();
      return s !== "" && !PLACE_ID_RE.test(s);
    });
    if (idx !== -1) {
      map.name = idx;
      taken.add(idx);
    }
  }

  return map;
}

/** The data rows for a parsed CSV, honouring the header toggle. */
function csvDataRows(csv, hasHeader) {
  if (!csv) return [];
  return hasHeader ? csv.table.slice(1) : csv.table;
}

/** Turn mapped rows into the candidate shape /api/places/resolve expects. */
function csvCandidates(csv, hasHeader, map) {
  const at = (row, index) =>
    index === "" || index === null || index === undefined
      ? ""
      : String(row[index] ?? "").trim();

  return csvDataRows(csv, hasHeader)
    .map((row) => {
      const placeId = at(row, map.placeId);
      const name = at(row, map.name);
      const label = at(row, map.label);
      const category = at(row, map.category);
      return { placeId, name, address: label, label, category: category || null };
    })
    .filter((c) => c.placeId || c.name);
}

function parseScanLines(text) {
  return (text || "")
    .split(/\r?\n|\r/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function guessScanModeFor(text) {
  const lines = parseScanLines(text);
  if (lines.length === 0) return null;
  let withId = 0;
  let withDelimiter = 0;
  for (const l of lines) {
    if (l.includes(",") || l.includes("\t")) withDelimiter++;
    const first = l.split(/[,\t]/)[0].trim();
    if (PLACE_ID_RE.test(first)) withId++;
  }
  if (withDelimiter > Math.floor(lines.length / 2)) return "both";
  if (withId > Math.floor(lines.length / 2)) return "placeid";
  return "name";
}

function parseScanAs(mode, text) {
  const lines = parseScanLines(text);
  const out = [];
  for (const line of lines) {
    if (mode === "placeid") {
      const id = line.trim();
      if (id) out.push({ placeId: id, name: "", address: "" });
      continue;
    }
    if (mode === "name") {
      out.push({ placeId: "", name: line, address: "" });
      continue;
    }
    // "both" mode — accept CSV-ish, tab-separated, or space-prefixed place_id
    const parts = line.includes("\t") ? line.split(/\t/) : line.split(",");
    const a = (parts[0] || "").trim();
    const b = (parts[1] || "").trim();
    if (PLACE_ID_RE.test(a)) {
      out.push({ placeId: a, name: b, address: (parts[2] || "").trim() });
    } else if (PLACE_ID_RE.test(b)) {
      out.push({ placeId: b, name: a, address: (parts[2] || "").trim() });
    } else {
      // Fall back: treat as name + optional address
      out.push({ placeId: "", name: a, address: b });
    }
  }
  return out;
}

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

  // --- Scan & resolve ---
  const [scanMode, setScanMode] = useState("name");
  const [scanText, setScanText] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveErrors, setResolveErrors] = useState([]);
  const csvInputRef = useRef(null);

  // --- CSV import: parsed file + how its columns map onto our fields ---
  const [csv, setCsv] = useState(null); // { fileName, table }
  const [csvHasHeader, setCsvHasHeader] = useState(true);
  const [csvMap, setCsvMap] = useState({ placeId: "", name: "", label: "", category: "" });

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

  // Re-guess which column is which whenever the file or the header
  // toggle changes. The user can override any of it afterwards.
  useEffect(() => {
    if (!csv) return;
    setCsvMap(guessCsvMapping(csv, csvHasHeader));
  }, [csv, csvHasHeader]);

  const csvColumns = useMemo(() => csvColumnNames(csv, csvHasHeader), [csv, csvHasHeader]);
  const csvRows = useMemo(() => csvDataRows(csv, csvHasHeader), [csv, csvHasHeader]);
  const csvMappingUsable = csvMap.placeId !== "" || csvMap.name !== "";

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
        // If the row arrived with a category already (CSV upload / resolve),
        // treat that as the auto one, falling back to the guessed one.
        guessedCategory: r.category || guessed || "Other",
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
    setResolveErrors([]);
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
    setResolveErrors([]);
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

  async function runResolve(candidates, sourceLabel) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      setSearchStatus(`Nothing to resolve from ${sourceLabel}.`);
      return;
    }
    setResolving(true);
    setResolveErrors([]);
    setSearchStatus(`Resolving ${candidates.length} rows from ${sourceLabel}...`);
    try {
      const res = await fetch("/api/places/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: candidates }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Resolve failed");

      const seen = new Set();
      const merged = [];
      for (const base of data.resolved || []) {
        if (seen.has(base.placeId)) continue;
        seen.add(base.placeId);
        // Carry over any user-supplied label/category from the candidate
        // that produced this row.
        const match = candidates.find(
          (c) =>
            (c.placeId && c.placeId === base.placeId) ||
            (!c.placeId && c.name && c.name === base.name)
        );
        merged.push({
          ...base,
          label: base.label || match?.label || null,
          address: base.address || match?.address || base.label || null,
          category: base.category || match?.category || null,
        });
      }

      setResults(merged);
      setNextPageToken(null);
      setResolveErrors(data.errors || []);
      const errs = data.errors || [];
      const parts = [];
      parts.push(
        `Resolved ${merged.length} of ${data.requested} from ${sourceLabel}.`
      );
      if (errs.length > 0) {
        parts.push(`${errs.length} row${errs.length === 1 ? "" : "s"} failed — see list below.`);
      }
      setSearchStatus(parts.join(" "));
    } catch (err) {
      setSearchStatus(String(err.message || err));
    } finally {
      setResolving(false);
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
      label: p.label || p.address || null,
      category: overrideCategory ?? p.category ?? effectiveCategoryFor(p.placeId) ?? null,
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

  async function handleCSVFile(file) {
    if (!file) return;
    setResolveErrors([]);
    setSearchStatus(`Reading ${file.name}...`);
    try {
      const text = await file.text();
      const { table } = parseCSV(text);
      if (table.length === 0) {
        setSearchStatus(`${file.name} has no rows.`);
        return;
      }
      setCsv({ fileName: file.name, table });
      setCsvHasHeader(true);
      // The panel below reports the row/column counts, so clear the
      // transient "Reading..." message rather than leaving it stale.
      setSearchStatus("");
    } catch (err) {
      setSearchStatus(`CSV read failed: ${err.message || err}`);
    }
  }

  function resolveCsv() {
    const candidates = csvCandidates(csv, csvHasHeader, csvMap);
    if (candidates.length === 0) {
      setSearchStatus(
        "No usable rows with the current column mapping — map a Place ID or Name column that has values."
      );
      return;
    }
    runResolve(candidates, `CSV (${csv.fileName})`);
  }

  const addableResultsCount = results.filter((r) => !trackedIds.has(r.placeId)).length;
  const lineCount = parseScanLines(scanText).length;

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
            type. Leave the Category field blank to auto-detect per result.
          </p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              setResults([]);
              setNextPageToken(null);
              setResolveErrors([]);
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
            <button className="btn primary" type="submit" disabled={searching || scanning || resolving}>
              <Icon name="search" />
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
                      <span
                        className={`badge${wasGuessed ? " auto" : ""}`}
                        title={wasGuessed ? "Auto-detected from scan / upload" : "Manual override"}
                      >
                        {effective}
                      </span>
                      {isTracked && <span className="badge">Already tracked</span>}
                    </label>
                  );
                })}
              </div>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn primary" onClick={addSelected} disabled={addableResultsCount === 0}>
                  <Icon name="checkSquare" />
                  Add selected
                </button>
                <button
                  className="btn icon-only"
                  onClick={addAllLoaded}
                  disabled={addableResultsCount === 0}
                  title={`Add all ${addableResultsCount} new results`}
                  aria-label={`Add all ${addableResultsCount} new results`}
                >
                  <Icon name="listPlus" />
                </button>
                {nextPageToken && (
                  <button
                    className={`btn icon-only${searching ? " loading" : ""}`}
                    onClick={() => runSearch(nextPageToken)}
                    disabled={searching || scanning || resolving}
                    title="Load more results"
                    aria-label="Load more results"
                  >
                    <Icon name="chevronDown" />
                  </button>
                )}
                <button
                  className={`btn icon-only${scanning ? " loading" : ""}`}
                  onClick={runScanAll}
                  disabled={searching || scanning || resolving}
                  title="Scan all available pages"
                  aria-label="Scan all available pages"
                >
                  <Icon name="layers" />
                </button>
              </div>
              {resolveErrors.length > 0 && (
                <div className="resolve-errors scroll-panel">
                  <div className="resolve-errors-head">
                    <Icon name="alert" />
                    Failed to resolve {resolveErrors.length} row
                    {resolveErrors.length === 1 ? "" : "s"}:
                  </div>
                  {resolveErrors.map((e, idx) => (
                    <div className="resolve-error" key={idx}>
                      <span className="resolve-err-row">
                        {e.row?.placeId || e.row?.name || "(row)"}
                      </span>
                      <span className="resolve-err-msg">{e.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {searchStatus && <p className="status">{searchStatus}</p>}
        </div>

        <div className="bento-card bento-card--wide">
          <h2>Scan &amp; resolve</h2>
          <p className="hint">
            Upload a CSV, or paste lines below and choose a mode. Each row
            is resolved against Google, then previewed above in the results
            list so you can add them.
          </p>

          <div className="card-block">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>CSV upload</h3>
              <span className="hint" style={{ fontSize: 12, margin: 0 }}>
                Any column layout — pick which column is which after uploading.
              </span>
            </div>
            <label className="file-drop" style={{ marginTop: 10 }}>
              <span className="file-drop-icon">
                <Icon name="upload" />
              </span>
              <span>
                <span className="file-drop-strong">
                  {csv ? "Choose a different CSV file" : "Choose a CSV file"}
                </span>
                <br />
                Columns are detected automatically and can be remapped before resolving.
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                ref={csvInputRef}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  handleCSVFile(f);
                  if (csvInputRef.current) csvInputRef.current.value = "";
                }}
              />
            </label>

            {csv && (
              <div className="csv-map">
                <div className="csv-map-head">
                  <span className="csv-file-name">
                    {csv.fileName}
                    <span className="csv-file-meta">
                      {csvRows.length} row{csvRows.length === 1 ? "" : "s"} ·{" "}
                      {csvColumns.length} column{csvColumns.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn icon-only"
                    onClick={() => {
                      setCsv(null);
                      setSearchStatus("");
                    }}
                    title="Discard this CSV"
                    aria-label="Discard this CSV"
                  >
                    <Icon name="close" />
                  </button>
                </div>

                <div className="csv-map-grid">
                  {CSV_FIELDS.map((field) => (
                    <label key={field.key} className="csv-map-field">
                      <span className="csv-map-label">{field.label}</span>
                      <select
                        value={csvMap[field.key] === "" ? "" : String(csvMap[field.key])}
                        onChange={(e) =>
                          setCsvMap((m) => ({
                            ...m,
                            [field.key]: e.target.value === "" ? "" : Number(e.target.value),
                          }))
                        }
                      >
                        <option value="">— not mapped —</option>
                        {csvColumns.map((c) => (
                          <option key={c.index} value={String(c.index)}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>

                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={csvHasHeader}
                    onChange={(e) => setCsvHasHeader(e.target.checked)}
                  />
                  First row is a header
                </label>

                {csvRows.length > 0 && (
                  <div className="csv-preview scroll-panel">
                    <table>
                      <thead>
                        <tr>
                          {csvColumns.map((c) => (
                            <th key={c.index}>{c.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvRows.slice(0, 3).map((row, i) => (
                          <tr key={i}>
                            {csvColumns.map((c) => (
                              <td key={c.index}>{row[c.index] ?? ""}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="row">
                  <button
                    className="btn primary"
                    onClick={resolveCsv}
                    disabled={resolving || !csvMappingUsable}
                  >
                    <Icon name="play" />
                    {resolving
                      ? "Resolving..."
                      : `Resolve ${csvRows.length} row${csvRows.length === 1 ? "" : "s"}`}
                  </button>
                  {!csvMappingUsable && (
                    <span className="inline-err">Map a Place ID or Name column first.</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="card-block">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Paste lines</h3>
              <div className="row" style={{ gap: 6 }}>
                <button
                  className={`btn chip icon-only${scanMode === "name" ? " active" : ""}`}
                  onClick={() => setScanMode("name")}
                  type="button"
                  title="Scan by name"
                  aria-label="Scan by name"
                  aria-pressed={scanMode === "name"}
                >
                  <Icon name="user" />
                </button>
                <button
                  className={`btn chip icon-only${scanMode === "placeid" ? " active" : ""}`}
                  onClick={() => setScanMode("placeid")}
                  type="button"
                  title="Scan by place_id"
                  aria-label="Scan by place_id"
                  aria-pressed={scanMode === "placeid"}
                >
                  <Icon name="badge" />
                </button>
                <button
                  className={`btn chip icon-only${scanMode === "both" ? " active" : ""}`}
                  onClick={() => setScanMode("both")}
                  type="button"
                  title="Scan by name and place_id"
                  aria-label="Scan by name and place_id"
                  aria-pressed={scanMode === "both"}
                >
                  <Icon name="split" />
                </button>
                <button
                  className="btn chip icon-only ghost"
                  onClick={() => {
                    const detected = guessScanModeFor(scanText);
                    if (detected) setScanMode(detected);
                  }}
                  type="button"
                  disabled={!parseScanLines(scanText).length}
                  title="Detect the mode from the pasted rows"
                  aria-label="Detect scan mode automatically"
                >
                  <Icon name="sparkle" />
                </button>
              </div>
            </div>
            <textarea
              className="scan-textarea"
              value={scanText}
              onChange={(e) => setScanText(e.target.value)}
              placeholder={
                scanMode === "name"
                  ? "One name per line, optionally with an area. e.g.:\nវិទ្យាល័យ ពោធិ៍សែន ភ្នំពេញ\nRoyal Palace Phnom Penh"
                  : scanMode === "placeid"
                  ? "One place_id per line. e.g.:\nChIJM8qG5qs3DDERP162lCD26pY\nChIJ...XYZ"
                  : "One row per line as `place_id, name[, address]` or `name, place_id[, address]`. Comma or tab separated."
              }
              rows={7}
            />
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn primary"
                disabled={resolving || lineCount === 0}
                onClick={() => {
                  const cands = parseScanAs(scanMode, scanText);
                  if (cands.length === 0) {
                    setSearchStatus("No rows to scan.");
                    return;
                  }
                  runResolve(cands, `paste (${scanMode})`);
                }}
              >
                <Icon name="play" />
                {resolving ? "Resolving..." : `Resolve ${lineCount} row${lineCount === 1 ? "" : "s"}`}
              </button>
              <button
                className="btn icon-only"
                onClick={() => setScanText("")}
                disabled={!scanText}
                type="button"
                title="Clear the pasted rows"
                aria-label="Clear the pasted rows"
              >
                <Icon name="eraser" />
              </button>
            </div>
          </div>
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
              <Icon name="plus" />
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
            <Icon name="refresh" />
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
          <div className="export-groups">
            <div className="export-group">
              <span className="export-label">Places</span>
              <a
                className="btn"
                href="/api/places/export?type=places&format=csv"
                title="Export tracked places as CSV"
              >
                <Icon name="download" />
                CSV
              </a>
              <a
                className="btn"
                href="/api/places/export?type=places&format=json"
                title="Export tracked places as JSON"
              >
                <Icon name="download" />
                JSON
              </a>
            </div>
            <div className="export-group">
              <span className="export-label">History</span>
              <a
                className="btn"
                href="/api/places/export?type=history&format=csv"
                title="Export rename history as CSV"
              >
                <Icon name="download" />
                CSV
              </a>
              <a
                className="btn"
                href="/api/places/export?type=history&format=json"
                title="Export rename history as JSON"
              >
                <Icon name="download" />
                JSON
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
