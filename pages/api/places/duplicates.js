import { supabase } from "../../../lib/supabase";
import { getPlaceName } from "../../../lib/places";
import { sendTelegramMessage, formatDuplicatesFound } from "../../../lib/telegram";

const PROBE_LIMIT = 3;

function norm(s) {
  return (s || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clustersBy(list, keyFn) {
  const groups = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function unionClusters(listOfGroups) {
  const parent = new Map();
  function find(x) {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) {
      parent.set(r, parent.get(parent.get(r)));
      r = parent.get(r);
    }
    return r;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const ids = listOfGroups.flat();
  for (const id of ids) parent.set(id, id);
  for (const group of listOfGroups) {
    if (group.length < 2) continue;
    const [first, ...rest] = group;
    for (const r of rest) union(first, r);
  }
  const byRoot = new Map();
  for (const id of ids) {
    const r = find(id);
    if (!byRoot.has(r)) byRoot.set(r, new Set());
    byRoot.get(r).add(id);
  }
  return [...byRoot.values()].filter((s) => s.size >= 2).map((s) => [...s]);
}

async function limitMap(list, worker, limit) {
  const res = new Array(list.length);
  let next = 0;
  async function run() {
    while (next < list.length) {
      const i = next++;
      try {
        res[i] = await worker(list[i], i);
      } catch (err) {
        res[i] = { error: String(err?.message || err) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => run()));
  return res;
}

export default async function handler(req, res) {
  const db = supabase();

  // ---------- Merge action ----------
  if (req.method === "POST") {
    const { canonicalPlaceId, removePlaceIds } = req.body || {};
    if (!canonicalPlaceId || !Array.isArray(removePlaceIds) || removePlaceIds.length === 0) {
      return res.status(400).json({
        error: "canonicalPlaceId and removePlaceIds (non-empty array) are required",
      });
    }

    const cleanRemove = [...new Set(removePlaceIds.filter((x) => x && x !== canonicalPlaceId))];
    if (cleanRemove.length === 0) {
      return res.status(400).json({ error: "Nothing to remove" });
    }

    const { data: allRows, error: rowsErr } = await db
      .from("tracked_places")
      .select("*")
      .in("place_id", [canonicalPlaceId, ...cleanRemove]);
    if (rowsErr) return res.status(500).json({ error: rowsErr.message });
    const byId = new Map((allRows || []).map((r) => [r.place_id, r]));
    if (!byId.has(canonicalPlaceId)) {
      return res.status(404).json({ error: "canonicalPlaceId is not tracked" });
    }

    // Carry over label/category from removed rows if canonical is empty.
    const canonical = byId.get(canonicalPlaceId);
    const donors = cleanRemove
      .map((id) => byId.get(id))
      .filter(Boolean)
      .sort(
        (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
      );
    const patch = {};
    if (!canonical.label) {
      const label = donors.find((r) => !!r.label)?.label;
      if (label) patch.label = label;
    }
    if (!canonical.category) {
      const category = donors.find((r) => !!r.category)?.category;
      if (category) patch.category = category;
    }

    // 1. Move history from remove ids → canonical id, de-duplicating on (changed_at)
    const { data: existingHist, error: histErr } = await db
      .from("place_name_history")
      .select("place_id, changed_at")
      .eq("place_id", canonicalPlaceId);
    if (histErr) return res.status(500).json({ error: histErr.message });
    const seenKeys = new Set((existingHist || []).map((r) => `${r.changed_at}`));

    const { data: moveHist, error: moveErr } = await db
      .from("place_name_history")
      .select("*")
      .in("place_id", cleanRemove);
    if (moveErr) return res.status(500).json({ error: moveErr.message });

    if (moveHist && moveHist.length > 0) {
      const toInsert = [];
      for (const h of moveHist) {
        const k = `${h.changed_at}`;
        if (seenKeys.has(k)) continue;
        seenKeys.add(k);
        toInsert.push({
          place_id: canonicalPlaceId,
          old_name: h.old_name,
          new_name: h.new_name,
          changed_at: h.changed_at,
          source: h.source,
        });
      }
      if (toInsert.length > 0) {
        const { error: insErr } = await db.from("place_name_history").insert(toInsert);
        if (insErr) return res.status(500).json({ error: insErr.message });
      }
      const { error: delHistErr } = await db
        .from("place_name_history")
        .delete()
        .in("place_id", cleanRemove);
      if (delHistErr) return res.status(500).json({ error: delHistErr.message });
    }

    // 2. Apply category/label carry-over patch
    if (Object.keys(patch).length > 0) {
      const { error: patchErr } = await db
        .from("tracked_places")
        .update(patch)
        .eq("place_id", canonicalPlaceId);
      if (patchErr) return res.status(500).json({ error: patchErr.message });
    }

    // 3. Delete the removed tracked_places rows
    const { error: delErr } = await db
      .from("tracked_places")
      .delete()
      .in("place_id", cleanRemove);
    if (delErr) return res.status(500).json({ error: delErr.message });

    const { data: updatedCanonical } = await db
      .from("tracked_places")
      .select("*")
      .eq("place_id", canonicalPlaceId)
      .maybeSingle();

    return res.status(200).json({
      ok: true,
      canonical: updatedCanonical,
      removed: cleanRemove,
      patched: Object.keys(patch).length > 0 ? patch : null,
    });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end();
  }

  // ---------- Duplicate scan ----------
  const { data: places, error } = await db.from("tracked_places").select("*");
  if (error) return res.status(500).json({ error: error.message });

  const byPlaceId = new Map((places || []).map((p) => [p.place_id, p]));

  const nameGroups = clustersBy(places || [], (p) => norm(p.current_name));
  const addrGroups = clustersBy(places || [], (p) => norm(p.label));
  const allGroups = [...nameGroups.values(), ...addrGroups.values()].map((g) =>
    g.map((p) => p.place_id)
  );

  const clusters = unionClusters(allGroups);

  if (clusters.length === 0) {
    return res.status(200).json({ clusters: [], count: 0 });
  }

  // Probe each cluster's place_ids against Google to see which are still alive.
  // Cap the probe size to avoid massive API usage when the dataset is huge.
  let toProbe = [];
  for (const c of clusters) toProbe.push(...c);
  if (toProbe.length > 200) {
    toProbe = toProbe.slice(0, 200);
  }
  const probeResults = await limitMap(
    toProbe,
    async (id) => {
      try {
        const d = await getPlaceName(id);
        return {
          placeId: id,
          alive: true,
          canonicalPlaceId: d.canonicalPlaceId || id,
          currentName: d.name,
          currentAddress: d.address,
          primaryType: d.primaryType,
        };
      } catch (err) {
        const msg = String(err?.message || err || "");
        const notFound = /404|400|not\s*found|invalid/i.test(msg);
        return { placeId: id, alive: false, notFound, error: msg };
      }
    },
    PROBE_LIMIT
  );

  const probeById = new Map(probeResults.map((p) => [p.placeId, p]));
  const aliveIdByCanonical = new Map();
  for (const p of probeResults) {
    if (p.alive) aliveIdByCanonical.set(p.canonicalPlaceId || p.placeId, p.placeId);
  }

  const enriched = clusters.map((ids) => {
    const rows = ids.map((id) => byPlaceId.get(id)).filter(Boolean);
    const sharedName =
      rows
        .map((r) => r.current_name)
        .filter(Boolean)
        .sort((a, b) => (norm(a) === norm(rows[0]?.current_name || "") ? -1 : 1))[0] ||
      rows[0]?.current_name ||
      "(unknown)";
    const probes = ids.map((id) => probeById.get(id)).filter(Boolean);
    const alive = probes.filter((p) => p.alive);

    // Prefer the alive probe whose current Google name best matches the
    // cluster's shared tracked name (by normalized string equality, then
    // longest shared prefix). If there's a tie, the most recently created
    // tracked row wins.
    let canonical = null;
    if (alive.length === 1) {
      canonical = alive[0].placeId;
    } else if (alive.length > 1) {
      const target = norm(sharedName);
      const scored = alive.map((p) => {
        const name = norm(p.currentName || "");
        let score = 0;
        if (name === target) score += 10;
        else if (name.startsWith(target) || target.startsWith(name)) score += 6;
        // Longest common prefix len
        let prefix = 0;
        while (
          prefix < name.length &&
          prefix < target.length &&
          name.charCodeAt(prefix) === target.charCodeAt(prefix)
        )
          prefix++;
        score += Math.min(4, prefix / 5);
        // Newer tracked row → slight boost
        const row = byPlaceId.get(p.placeId);
        if (row?.created_at) score += Math.min(1, +new Date(row.created_at) / 1e13);
        return { p, score };
      });
      scored.sort((a, b) => b.score - a.score);
      canonical = scored[0].p.placeId;
    }

    return {
      sharedName,
      placeIds: ids,
      rows,
      probes,
      aliveCount: alive.length,
      deadCount: probes.length - alive.length,
      canonicalPlaceId: canonical,
    };
  });

  // Only worth a push when the scan actually surfaced something to act on.
  const telegram =
    enriched.length > 0
      ? await sendTelegramMessage(formatDuplicatesFound({ clusters: enriched }))
      : null;

  return res.status(200).json({
    clusters: enriched,
    count: enriched.length,
    probedCount: toProbe.length,
    telegram,
  });
}
