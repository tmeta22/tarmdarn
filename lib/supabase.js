import { createClient } from "@supabase/supabase-js";

let client;

export function supabase() {
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }
  return client;
}

// Supabase stops a single response at 1000 rows (PostgREST's max-rows), so
// every unbounded select silently saw only the first page: the dashboard
// listed 1000 places, the daily check only ever checked 1000 of them, and
// exports truncated without saying so.
const PAGE_SIZE = 1000;

/**
 * Reads every row by paging with range() until a short page arrives.
 *
 * `build` must return a FRESH query builder each call, and the query needs a
 * deterministic order — include an `id` tiebreaker, or rows sharing the sort
 * value can repeat on one page and vanish from the next.
 */
export async function selectAll(build, { pageSize = PAGE_SIZE } = {}) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
