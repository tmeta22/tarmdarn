import { supabase } from "../../../lib/supabase";

// Excel ignores the charset in Content-Type when opening a .csv and falls
// back to the system ANSI codepage, which mangles Khmer text. A leading
// UTF-8 BOM is the only reliable signal that the file is UTF-8. The
// importer strips it back off, so round-trips stay clean.
const BOM = "\uFEFF";

function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.map((c) => esc(c.label)).join(",");
  const lines = rows.map((r) => columns.map((c) => esc(r[c.key])).join(","));
  return BOM + [header, ...lines].join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end();
  }

  const type = req.query.type === "history" ? "history" : "places";
  const format = req.query.format === "json" ? "json" : "csv";
  const db = supabase();

  if (type === "history") {
    const { data, error } = await db
      .from("place_name_history")
      .select("*, tracked_places(label, category, current_name)")
      .order("changed_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const rows = (data || []).map((h) => ({
      place_id: h.place_id,
      label: h.tracked_places?.label ?? "",
      category: h.tracked_places?.category ?? "",
      old_name: h.old_name,
      new_name: h.new_name,
      changed_at: h.changed_at,
    }));

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", 'attachment; filename="taamdan-history.json"');
      return res.status(200).send(JSON.stringify(rows, null, 2));
    }
    const csv = toCsv(rows, [
      { key: "place_id", label: "place_id" },
      { key: "label", label: "label" },
      { key: "category", label: "category" },
      { key: "old_name", label: "old_name" },
      { key: "new_name", label: "new_name" },
      { key: "changed_at", label: "changed_at" },
    ]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="taamdan-history.csv"');
    return res.status(200).send(csv);
  }

  const { data, error } = await db
    .from("tracked_places")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  if (format === "json") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", 'attachment; filename="taamdan-places.json"');
    return res.status(200).send(JSON.stringify(data, null, 2));
  }
  const csv = toCsv(data, [
    { key: "place_id", label: "place_id" },
    { key: "label", label: "label" },
    { key: "category", label: "category" },
    { key: "current_name", label: "current_name" },
    { key: "last_checked_at", label: "last_checked_at" },
    { key: "created_at", label: "created_at" },
  ]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="taamdan-places.csv"');
  return res.status(200).send(csv);
}
