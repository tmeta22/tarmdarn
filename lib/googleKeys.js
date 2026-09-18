import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Google Places API key pool.
//
// The point of rotating keys and pacing requests is that a 7,000-row scan
// used to burn through one key's quota and then report every remaining row
// as a failure. Instead we space requests out, and when Google still pushes
// back we cool that key down and continue on another one.
// ---------------------------------------------------------------------------

// A "quota exceeded" won't clear for a long time; a plain "slow down" will.
const QUOTA_COOLDOWN_MS = 60 * 60 * 1000;
const RATE_COOLDOWN_MS = 30 * 1000;

// Don't let a fully-cooled pool stall a scan forever — waiting this long is
// worth it, anything longer means we hand a retryable error back instead.
const MAX_COOLDOWN_WAIT_MS = 30 * 1000;

// Re-read the key table at most this often, so a key added mid-scan is
// picked up without hitting the database on every single request.
const CACHE_MS = 15 * 1000;

const DEFAULT_QPS = 5;
const MIN_QPS = 0.5;
const RECOVERY_STEP = 25; // successful calls between speed-ups

let cache = { keys: null, at: 0 };
let cursor = 0;

// Whether the key table is reachable at all. Distinguishes "no saved keys
// yet" from "migration not applied", which the UI needs to tell apart.
let tableReady = false;

// In-memory state keyed by pool entry id. Persisted cooldowns live in the
// table; this covers env keys and keeps cooldowns working when the table
// isn't reachable.
const sessions = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- adaptive rate ---------------------------------------------------------

let effectiveQps = null;
let successesSinceRecovery = 0;
let nextSlot = 0;

/** The ceiling the adaptive limiter is allowed to recover back up to. */
function ceilingQps() {
  const n = Number(process.env.GOOGLE_PLACES_QPS);
  return Number.isFinite(n) && n >= MIN_QPS ? n : DEFAULT_QPS;
}

export function currentQps() {
  return effectiveQps ?? ceilingQps();
}

function slowDown() {
  effectiveQps = Math.max(MIN_QPS, currentQps() / 2);
  successesSinceRecovery = 0;
}

function speedUp() {
  if (effectiveQps === null) return;
  successesSinceRecovery += 1;
  if (successesSinceRecovery < RECOVERY_STEP) return;
  successesSinceRecovery = 0;
  effectiveQps = Math.min(ceilingQps(), effectiveQps * 1.25);
}

/**
 * Reserves the next send slot, spacing requests evenly across all workers.
 * A shared cursor is what makes the concurrency-capped workers obey one
 * global rate instead of each running at full speed.
 */
async function pace() {
  const interval = 1000 / currentQps();
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + interval;
  const wait = slot - now;
  if (wait > 0) await sleep(wait);
}

// --- pool loading ----------------------------------------------------------

/** Keys from env: GOOGLE_MAPS_API_KEY, _2.._10, plus a comma-separated list. */
function envKeys() {
  const found = [];
  const push = (v) => {
    const k = String(v || "").trim();
    if (k && !found.includes(k)) found.push(k);
  };
  push(process.env.GOOGLE_MAPS_API_KEY);
  for (let i = 2; i <= 10; i++) push(process.env[`GOOGLE_MAPS_API_KEY_${i}`]);
  for (const part of String(process.env.GOOGLE_MAPS_API_KEYS || "").split(",")) push(part);
  return found;
}

async function dbKeyRows() {
  try {
    const { data, error } = await supabase()
      .from("google_api_keys")
      .select("id, key, label, cooldown_until")
      .eq("disabled", false);
    // A missing table (migration not applied yet) must not break scans —
    // env keys alone are a perfectly valid pool.
    if (error) {
      tableReady = false;
      return [];
    }
    tableReady = true;
    return data || [];
  } catch {
    tableReady = false;
    return [];
  }
}

export async function loadKeys({ force = false } = {}) {
  if (!force && cache.keys && Date.now() - cache.at < CACHE_MS) return cache.keys;

  const list = [];
  envKeys().forEach((key, i) => {
    list.push({
      id: `env:${i}`,
      key,
      label: i === 0 ? "Primary (env)" : `Env key ${i + 1}`,
      source: "env",
      cooldownUntil: 0,
    });
  });

  for (const row of await dbKeyRows()) {
    if (list.some((k) => k.key === row.key)) continue;
    list.push({
      id: String(row.id),
      key: row.key,
      label: row.label || `Saved key ${row.id}`,
      source: "db",
      cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until).getTime() : 0,
    });
  }

  cache = { keys: list, at: Date.now() };
  return list;
}

function sessionFor(id) {
  if (!sessions.has(id)) sessions.set(id, { cooldownUntil: 0, lastUsed: 0 });
  return sessions.get(id);
}

function coolUntil(entry) {
  return Math.max(sessionFor(entry.id).cooldownUntil, entry.cooldownUntil || 0);
}

/** Coolest key first, so repeated scans spread load instead of hammering one. */
function pickKey(keys) {
  const now = Date.now();
  const usable = keys
    .filter((k) => coolUntil(k) <= now)
    .sort((a, b) => sessionFor(a.id).lastUsed - sessionFor(b.id).lastUsed);
  if (usable.length === 0) return null;
  const picked = usable[cursor % usable.length];
  cursor += 1;
  return picked;
}

async function cool(entry, ms) {
  const until = Date.now() + ms;
  sessionFor(entry.id).cooldownUntil = until;
  if (entry.source === "db") {
    entry.cooldownUntil = until;
    // Fire-and-forget: a failed write only costs us the cooldown memory.
    supabase()
      .from("google_api_keys")
      .update({ cooldown_until: new Date(until).toISOString() })
      .eq("id", Number(entry.id))
      .then(undefined, () => {});
  }
}

function isQuotaBody(body) {
  const text = String(body || "").toLowerCase();
  return (
    text.includes("quota") ||
    text.includes("resource_exhausted") ||
    text.includes("billing") ||
    text.includes("rate limit")
  );
}

function googleError(status, body, retryable) {
  const err = new Error(`Google Places ${status}: ${body}`);
  err.status = status;
  err.retryable = retryable;
  return err;
}

// --- the request itself ----------------------------------------------------

/**
 * fetch() against Google Places with key rotation, pacing, and retry.
 * Throws an error carrying `status` and `retryable` on failure.
 *
 * `maxCooldownWaitMs` caps how long a caller is willing to wait out a key's
 * cooldown. The daily check lowers it, because it runs inside a function
 * timeout and would rather hand the row back as retryable than be killed.
 */
export async function googleFetch(url, init = {}, { maxCooldownWaitMs = MAX_COOLDOWN_WAIT_MS } = {}) {
  const keys = await loadKeys();
  if (keys.length === 0) {
    const err = new Error(
      "No Google API key available. Add one under Controls, or set GOOGLE_MAPS_API_KEY."
    );
    err.status = 500;
    err.retryable = false;
    throw err;
  }

  let lastError;
  // Enough passes to try every key, then a second round once cooldowns lapse.
  const maxAttempts = keys.length + 2;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const picked = pickKey(keys);

    if (!picked) {
      const soonest = Math.min(...keys.map(coolUntil));
      const wait = soonest - Date.now();
      if (wait > 0 && wait <= maxCooldownWaitMs) {
        await sleep(wait);
        continue;
      }
      // Every key is out of quota for a long while — hand back something the
      // caller can legitimately retry later rather than failing for good.
      throw (
        lastError ||
        googleError(429, "All Google API keys are rate limited or out of quota", true)
      );
    }

    await pace();
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), "X-Goog-Api-Key": picked.key },
    });

    if (res.ok) {
      sessionFor(picked.id).lastUsed = Date.now();
      speedUp();
      return res;
    }

    const status = res.status;
    const body = await res.text();

    if (status === 429 || isQuotaBody(body)) {
      const quota = isQuotaBody(body);
      await cool(picked, quota ? QUOTA_COOLDOWN_MS : RATE_COOLDOWN_MS);
      slowDown();
      lastError = googleError(status, body, true);
      continue;
    }

    // A bad request or missing place is not a quota problem, so trying it
    // against the other keys would just waste calls.
    throw googleError(status, body, status >= 500);
  }

  throw lastError || googleError(429, "Google rate limit reached", true);
}

// --- management API used by /api/google-keys ------------------------------

export function maskKey(key) {
  const s = String(key || "");
  if (s.length <= 12) return "…";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

/**
 * Cheap live check so a typo'd or unenabled key is rejected at add time
 * instead of silently poisoning a 7,000-row scan.
 */
export async function probeKey(key) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id",
    },
    body: JSON.stringify({ textQuery: "Phnom Penh", pageSize: 1 }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: `${res.status}: ${await res.text()}` };
}

export async function addKey(key, label) {
  const trimmed = String(key || "").trim();
  if (!/^AIza[0-9A-Za-z_-]{35}$/.test(trimmed)) {
    return { error: "That doesn't look like a Google API key (they start with AIza)." };
  }

  const existing = await loadKeys({ force: true });
  if (!tableReady) {
    return {
      error:
        "The google_api_keys table doesn't exist yet — run supabase/migrations/0004_google_api_keys.sql in the Supabase SQL editor.",
    };
  }
  if (existing.some((k) => k.key === trimmed)) {
    return { error: "That key is already in the pool." };
  }

  // Verify before saving, so a typo can't quietly join a 7,000-row scan.
  const probe = await probeKey(trimmed);
  if (!probe.ok) return { error: `Google rejected the key — ${probe.error}` };

  const { data, error } = await supabase()
    .from("google_api_keys")
    .insert({ key: trimmed, label: label ? String(label).trim() : null })
    .select("id")
    .single();
  if (error) return { error: error.message };

  await loadKeys({ force: true });
  return { id: data.id };
}

export async function removeKey(id) {
  const { error } = await supabase().from("google_api_keys").delete().eq("id", Number(id));
  if (error) return { error: error.message };
  sessions.delete(String(id));
  await loadKeys({ force: true });
  return { ok: true };
}

/** Pool state for the Controls UI: masked keys plus the current safe rate. */
export async function poolStatus() {
  const keys = await loadKeys();
  const now = Date.now();
  const usable = keys.filter((k) => coolUntil(k) <= now);

  return {
    qps: Number(currentQps().toFixed(2)),
    ceilingQps: ceilingQps(),
    // What the pace limiter will actually sustain right now.
    rowsPerMinute: Math.round(currentQps() * 60),
    keys: keys.map((k) => ({
      id: k.id,
      label: k.label,
      masked: maskKey(k.key),
      source: k.source,
      cooling: coolUntil(k) > now,
      cooldownUntil: coolUntil(k) > now ? new Date(coolUntil(k)).toISOString() : null,
    })),
    usableKeys: usable.length,
    // A run that fits in roughly ten minutes is the practical ceiling before
    // a browser tab (and the user's patience) becomes the limiting factor.
    recommendedMaxRows: Math.max(100, Math.round(currentQps() * 60 * 10)),
    tableReady,
  };
}
