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

// Must not exceed the per-request cap in /api/places/resolve — the client
// splits large inputs into batches of this size.
const RESOLVE_BATCH = 100;

// A bulk add posts the whole selection, and Next.js caps an API route body
// at 1 MB. Rows carry a name, address and types array, so pack by encoded
// size rather than row count — Khmer text is 3 bytes per character in
// UTF-8, which a plain string length would badly undercount.
const ADD_BODY_BUDGET = 400 * 1024;
const utf8 = new TextEncoder();

function chunkByBytes(rows, budget = ADD_BODY_BUDGET) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const row of rows) {
    const rowSize = utf8.encode(JSON.stringify(row)).length + 1;
    if (current.length > 0 && size + rowSize > budget) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(row);
    size += rowSize;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Human-readable summary of a Telegram send result. */
function describePush(result) {
  if (!result) return "";
  if (result.skipped) return "Telegram not configured.";
  if (result.ok) return "Telegram notified.";
  return "Telegram push failed.";
}

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
  const [adding, setAdding] = useState(false);
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
  const [testingPush, setTestingPush] = useState(false);
  const [pushStatus, setPushStatus] = useState("");
  const [resultsSource, setResultsSource] = useState("search");

  // --- Google API key pool + safe scan rate ---
  const [pool, setPool] = useState(null);
  const [newKey, setNewKey] = useState("");
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMessage, setKeyMessage] = useState("");

  async function loadPool() {
    try {
      const res = await fetch("/api/google-keys");
      const data = await res.json();
      if (res.ok) setPool(data);
    } catch {
      // Advisory panel only — a failure here must not block scanning.
    }
  }

  useEffect(() => {
    fetch("/api/places")
      .then((r) => r.json())
      .then((data) => setPlaces(Array.isArray(data) ? data : []));
    loadPool();
  }, []);

  async function submitKey(e) {
    e.preventDefault();
    if (!newKey.trim()) return;
    setKeyBusy(true);
    setKeyMessage("Checking the key against Google...");
    try {
      const res = await fetch("/api/google-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: newKey.trim(), label: newKeyLabel.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setKeyMessage(data.error || "Could not save that key.");
        return;
      }
      setPool(data.status);
      setNewKey("");
      setNewKeyLabel("");
      setKeyMessage("Key added and verified — new scans will use it.");
    } catch (err) {
      setKeyMessage(String(err.message || err));
    } finally {
      setKeyBusy(false);
    }
  }

  async function deleteKey(id) {
    setKeyBusy(true);
    setKeyMessage("");
    try {
      const res = await fetch("/api/google-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setKeyMessage(data.error || "Could not remove that key.");
        return;
      }
      setPool(data.status);
      setKeyMessage("Key removed.");
    } catch (err) {
      setKeyMessage(String(err.message || err));
    } finally {
      setKeyBusy(false);
    }
  }

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
    setResultsSource("search");
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
    setResultsSource("scan all pages");
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

  /**
   * Batch size follows the rate the server is currently pacing at, so one
   * request stays inside the function timeout. If the limiter has slowed
   * down we send fewer rows per call rather than risk a 504.
   */
  function batchSizeFor(qps) {
    const target = Math.round((Number(qps) || 5) * 25); // aim for ~25s per request
    return Math.max(10, Math.min(RESOLVE_BATCH, target));
  }

  async function runResolve(candidates, sourceLabel) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      setSearchStatus(`Nothing to resolve from ${sourceLabel}.`);
      return;
    }
    setResolving(true);
    setResolveErrors([]);
    setResultsSource(sourceLabel);
    setSearchStatus(`Resolving ${candidates.length} rows from ${sourceLabel}...`);
    try {
      const seen = new Set();
      const merged = [];
      const errors = [];
      let size = batchSizeFor(pool?.qps);
      let start = 0;

      while (start < candidates.length) {
        const batch = candidates.slice(start, start + size);
        if (candidates.length > size) {
          setSearchStatus(
            `Resolving ${start + 1}–${start + batch.length} of ${candidates.length} from ${sourceLabel}...`
          );
        }

        let qps = null;
        try {
          const res = await fetch("/api/places/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows: batch }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data) {
            throw new Error(data?.error || `Server returned ${res.status}`);
          }
          qps = data.qps ?? null;

          for (const base of data.resolved || []) {
            if (seen.has(base.placeId)) continue;
            seen.add(base.placeId);
            // Carry over any user-supplied label/category from the candidate
            // that produced this row.
            const match = batch.find(
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
          for (const e of data.errors || []) {
            errors.push({ ...e, index: start + (e.index ?? 0) });
          }
        } catch (err) {
          // A single bad or timed-out batch must not abandon the other six
          // thousand rows — mark them retryable so the retry button can
          // pick them up once the rate has settled.
          const message = String(err?.message || err);
          for (let i = 0; i < batch.length; i++) {
            errors.push({ index: start + i, row: batch[i], error: message, retryable: true });
          }
        }

        start += batch.length;
        size = batchSizeFor(qps ?? pool?.qps);
      }

      setResults(merged);
      setNextPageToken(null);
      setResolveErrors(errors);
      const retryable = errors.filter((e) => e.retryable).length;
      const parts = [`Resolved ${merged.length} of ${candidates.length} from ${sourceLabel}.`];
      if (errors.length > 0) {
        parts.push(
          retryable === errors.length
            ? `${errors.length} row${errors.length === 1 ? "" : "s"} hit the Google rate limit — retry them below.`
            : `${errors.length} row${errors.length === 1 ? "" : "s"} failed — see list below.`
        );
      }
      setSearchStatus(parts.join(" "));
      loadPool();
    } catch (err) {
      setSearchStatus(String(err.message || err));
    } finally {
      setResolving(false);
    }
  }

  /** Re-runs only the rows that failed, so a partial run is recoverable. */
  function retryFailed() {
    const rows = resolveErrors.filter((e) => e.row).map((e) => e.row);
    if (rows.length === 0) return;
    runResolve(rows, `${resultsSource} (retry)`);
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
    setAdding(true);
    setSearchStatus(`Adding ${fresh.length}...`);
    const overrideCategory = searchCategory.trim() || null;
    const rows = fresh.map((p) => ({
      ...p,
      label: p.label || p.address || null,
      category: overrideCategory ?? p.category ?? effectiveCategoryFor(p.placeId) ?? null,
    }));

    const chunks = chunkByBytes(rows);
    const added = [];
    const failures = [];
    let skipped = 0;

    for (let i = 0; i < chunks.length; i++) {
      if (chunks.length > 1) {
        setSearchStatus(
          `Adding ${added.length + 1}–${added.length + chunks[i].length} of ${fresh.length}...`
        );
      }
      try {
        const res = await fetch("/api/places/bulk-add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            places: chunks[i],
            category: overrideCategory,
            source: resultsSource,
          }),
        });
        // A body-limit rejection or a crash replies with text, not JSON, so
        // reading it as JSON would throw and lose the reason.
        const data = await res.json().catch(async () => ({
          error: (await res.text().catch(() => "")).slice(0, 200) || `HTTP ${res.status}`,
        }));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        added.push(...(data.places || []));
        skipped += data.skipped || 0;
      } catch (err) {
        failures.push(String(err.message || err));
      }
    }

    setSelected({});
    if (added.length > 0) setPlaces((prev) => [...prev, ...added]);
    const parts = [`Now tracking ${added.length} new place${added.length === 1 ? "" : "s"}.`];
    if (skipped) parts.push(`${skipped} already tracked.`);
    if (failures.length) {
      parts.push(
        `${failures.length} batch${failures.length === 1 ? "" : "es"} failed — ${failures[0]}`
      );
    }
    setSearchStatus(parts.join(" "));
    setAdding(false);
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
      // The scheduled route is secret-gated, so manual runs use the
      // user-facing equivalent instead of leaking CRON_SECRET to the client.
      const res = await fetch("/api/places/check", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check failed");

      const parts = [
        `Checked ${data.checked}.`,
        `${data.changed} name${data.changed === 1 ? "" : "s"} changed.`,
      ];
      if (data.gone) parts.push(`${data.gone} no longer on Google.`);
      if (data.failed) parts.push(`${data.failed} lookup${data.failed === 1 ? "" : "s"} failed.`);
      parts.push(describePush(data.telegram));
      setCheckStatus(parts.join(" "));
    } catch (err) {
      setCheckStatus(String(err.message || err));
    } finally {
      setChecking(false);
    }
  }

  async function sendTestPush() {
    setTestingPush(true);
    setPushStatus("Sending test notification...");
    try {
      const res = await fetch("/api/telegram/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test failed");

      if (!data.configured) {
        setPushStatus(
          "Telegram isn't configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."
        );
      } else if (data.ok) {
        setPushStatus("Test notification sent — check Telegram.");
      } else {
        setPushStatus(`Telegram rejected the message: ${data.error}`);
      }
    } catch (err) {
      setPushStatus(String(err.message || err));
    } finally {
      setTestingPush(false);
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
                <button
                  className="btn primary"
                  onClick={addSelected}
                  disabled={addableResultsCount === 0 || adding}
                >
                  <Icon name="checkSquare" />
                  Add selected
                </button>
                <button
                  className="btn icon-only"
                  onClick={addAllLoaded}
                  disabled={addableResultsCount === 0 || adding}
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
                    <button
                      className="btn icon-only"
                      type="button"
                      onClick={retryFailed}
                      disabled={resolving}
                      title={`Retry ${resolveErrors.length} failed rows`}
                      aria-label={`Retry ${resolveErrors.length} failed rows`}
                    >
                      <Icon name="refresh" />
                    </button>
                  </div>
                  {resolveErrors.map((e, idx) => (
                    <div className="resolve-error" key={idx}>
                      <span className="resolve-err-row">
                        {e.row?.placeId || e.row?.name || "(row)"}
                        {e.retryable && <span className="resolve-err-tag">rate limit</span>}
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

          <div className="card-block capacity">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                Safe scan size
              </h3>
              <button
                className="btn icon-only"
                type="button"
                onClick={loadPool}
                disabled={keyBusy}
                title="Refresh API keys and rate"
                aria-label="Refresh API keys and rate"
              >
                <Icon name="refresh" />
              </button>
            </div>

            {pool ? (
              <>
                <div className="capacity-stats">
                  <div>
                    <span className="capacity-num">{pool.usableKeys}</span>
                    <span className="capacity-label">
                      usable key{pool.usableKeys === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div>
                    <span className="capacity-num">{pool.rowsPerMinute}</span>
                    <span className="capacity-label">rows / minute</span>
                  </div>
                  <div>
                    <span className="capacity-num">{pool.recommendedMaxRows}</span>
                    <span className="capacity-label">safe per run</span>
                  </div>
                </div>
                <p className="hint" style={{ fontSize: 12 }}>
                  Paced at {pool.qps} requests/sec
                  {pool.qps < pool.ceilingQps
                    ? ` — slowed down from ${pool.ceilingQps} after Google pushed back. It recovers automatically.`
                    : "."}{" "}
                  A run of {pool.recommendedMaxRows} rows takes roughly ten minutes.
                </p>
              </>
            ) : (
              <p className="hint" style={{ fontSize: 12 }}>
                Checking the key pool...
              </p>
            )}

            {pool && pool.keys.length > 0 && (
              <ul className="key-list">
                {pool.keys.map((k) => (
                  <li key={k.id} className={k.cooling ? "cooling" : ""}>
                    <Icon name="key" />
                    <span className="key-label">{k.label}</span>
                    <code className="key-mask">{k.masked}</code>
                    {k.cooling && <span className="key-state">cooling down</span>}
                    {k.source === "db" && (
                      <button
                        className="btn icon-only"
                        onClick={() => deleteKey(k.id)}
                        disabled={keyBusy}
                        title={`Remove ${k.label}`}
                        aria-label={`Remove ${k.label}`}
                      >
                        <Icon name="trash" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {pool && !pool.tableReady && (
              <p className="hint" style={{ fontSize: 12 }}>
                Saved keys need the <code>0004_google_api_keys.sql</code> migration
                first — until then only keys set in the environment are used.
              </p>
            )}

            <form className="key-add" onSubmit={submitKey}>
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="Add another Google API key (AIza...)"
                aria-label="New Google API key"
                spellCheck={false}
                autoComplete="off"
              />
              <input
                type="text"
                value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
                placeholder="Label (optional)"
                aria-label="Label for the new key"
              />
              <button className="btn" type="submit" disabled={keyBusy || !newKey.trim()}>
                {keyBusy ? <Icon name="refresh" /> : <Icon name="plus" />}
                Add key
              </button>
            </form>
            {keyMessage && <p className="status">{keyMessage}</p>}
          </div>

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
          <div className="row">
            <button className="btn primary" onClick={runCheckNow} disabled={checking}>
              <Icon name="refresh" />
              {checking ? "Checking..." : "Check now"}
            </button>
            <button
              className={`btn icon-only${testingPush ? " loading" : ""}`}
              onClick={sendTestPush}
              disabled={testingPush}
              type="button"
              title="Send a test Telegram notification"
              aria-label="Send a test Telegram notification"
            >
              <Icon name="send" />
            </button>
          </div>
          {checkStatus && <p className="status">{checkStatus}</p>}
          {pushStatus && <p className="status">{pushStatus}</p>}
          <p className="hint" style={{ marginTop: 16, marginBottom: 0 }}>
            Automatic check runs daily at <strong>7:00 AM Phnom Penh time</strong> (00:00 UTC).
            Set <code>TELEGRAM_BOT_TOKEN</code> / <code>TELEGRAM_CHAT_ID</code> to receive a push
            when a check finishes, when places are added, and when a duplicate scan finds
            matching place IDs.
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
