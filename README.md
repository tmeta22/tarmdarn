# តាមដាន (Taamdan) — place-name tracker

Google occasionally renames a place — a school, a road, a market — while
its `place_id` stays the same. This app watches a list of place IDs and
logs the moment the name on file changes, so you find out from your own
dashboard instead of stumbling on it on the map.

Built to search Google Maps in bulk (e.g. every high school in a
province), track hundreds of places, and check them daily.

## 1. Get a Google Maps API key
1. In Google Cloud Console, enable **Places API (New)**.
2. Create an API key and (recommended) restrict it to that API.
3. Note: the calls this app makes are the cheapest tier (Text Search
   "Basic Data" fields, Place Details "Basic Data" fields) — Google's
   free monthly credit comfortably covers checking a few hundred places
   once a day.

## 2. Set up Supabase
1. Create a project at supabase.com.
2. Open the SQL editor and run `schema.sql`.
3. From Project Settings → API, copy the **Project URL** and the
   **service_role key** (not the anon key — this app runs server-side only).

## 3. Configure environment variables
Copy `.env.example` to `.env.local` for local dev, and fill in:
- `GOOGLE_MAPS_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET` — any random string; protects the daily-check endpoint
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — optional; when set, every
  check (manual "Check now" or the daily cron) sends a Telegram message
  summarizing how many places were checked and which were renamed.
  Create a bot via [@BotFather](https://t.me/BotFather), message it once,
  then hit `https://api.telegram.org/bot<token>/getUpdates` to read back
  your chat id.

## 4. Run it locally
```bash
npm install
npm run dev
```
Open http://localhost:3000.

## 5. Deploy to Vercel
```bash
npm i -g vercel   # if you don't have it
vercel
```
Add the environment variables above in the Vercel project settings
(Settings → Environment Variables), then redeploy. `vercel.json` already
schedules `/api/cron/check` to run daily at **00:00 UTC (7:00 AM Phnom
Penh time, UTC+7)** — Vercel automatically attaches
`Authorization: Bearer <CRON_SECRET>` to that request when `CRON_SECRET`
is set, which is what the endpoint checks.

## Pages
- **Dashboard** (`/`) — a bento-grid overview: tracked-place count,
  categories, all-time rename count, next scheduled check, a filterable
  /sortable/groupable table of everything you're tracking, and a feed of
  the most recent renames across all places.
- **Controls** (`/controls`) — everything you *do*: search & bulk-add
  places, add a place by ID, run a check on demand, and export your
  data.

## Using it
- **Find places to track** (Controls) — search by name and area, e.g.
  "high school Battambang Cambodia" or "market Kampong Cham", tick the
  ones you want (or "Add all N new" — already-tracked results are
  greyed out and skipped automatically). Category is a free-text field
  with suggestions (school, market, pagoda, hospital, road/bridge,
  etc.), so it isn't limited to schools.
- **Scan all pages** (Controls) — instead of clicking "Load more
  results" repeatedly, this auto-pages through every page Google
  returns for that query (up to its own ~60-result cap) in one go.
- **Add a specific place by ID** (Controls) — for one-off tracking,
  like `ChIJM8qG5qs3DDERP162lCD26pY`. Already-tracked IDs are rejected
  (client-side and server-side) instead of silently overwriting the
  existing entry's category/label.
- **Filter / sort / group** (Dashboard) — the tracked-places table has a
  toolbar to filter by name/note/place_id, filter by category, sort
  (name, category, last checked, recently added), and optionally group
  rows by category.
- **Check now** (Controls) — runs the same check the daily cron does,
  on demand, useful right after a bulk add or to test the setup. Sends
  a Telegram push when it finishes, if Telegram is configured.
- **History** (Dashboard) — click on any tracked place to see its full
  rename timeline (old name → new name, with timestamp).
- **Export** (Controls) — download all tracked places as CSV or JSON,
  or the full rename history as CSV/JSON.

## Notes
- If Google issues a *new* place_id for the same location (rare, but it
  happens), the old one may start failing lookups. Re-searching and
  re-adding it will pick up the new ID.
- The category field is free text for your own filtering/grouping —
  nothing in Google's data drives it, and it isn't restricted to a
  fixed list of school types.
- Long result lists and long tracked-places tables scroll within their
  own panel instead of stretching the whole page.
- To change the daily check time, edit the `"schedule"` cron string in
  `vercel.json` (it's in UTC) and redeploy.
