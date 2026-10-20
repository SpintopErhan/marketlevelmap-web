// Market events for the homepage and the weekly events page, read from private R2.
//
// Preferred source (maintained by hand): one simple list per language, so the Turkish list can
// carry Turkey-only events —
//   site-events/events.en.json, site-events/events.tr.json
//   [ { "date": "2026-10-22", "time": "11:00", "country": "TR", "title": "TCMB faiz kararı", "actual": "" }, … ]
// `time` is UTC ("" = date only); optional: impact, previous, forecast, sourceUrl, enabled.
// /api/events?lang=tr reads the Turkish list, falling back to the other language and finally to the
// legacy bilingual site-events/events.json (README "Events JSON").
// Invalid entries are dropped instead of breaking the page; when nothing can be read the answer is
// { events: [], error } with status 200 so the page can say "could not be loaded".
const LEGACY_KEY = "site-events/events.json";
const LANGS = ["en", "tr"];
const CACHE_SECONDS = 60;
const IMPACTS = ["VERY_HIGH", "HIGH", "MEDIUM"];
const PRECISIONS = ["EXACT", "DAY"];

function json(value, maxAge) {
  return new Response(JSON.stringify(value), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

function text(value) {
  if (typeof value === "string") return value.trim() ? { en: value, tr: value } : null;
  if (value && typeof value === "object" && (typeof value.en === "string" || typeof value.tr === "string")) {
    return { en: String(value.en || value.tr), tr: String(value.tr || value.en) };
  }
  return null;
}

function optional(value) {
  return value == null || value === "" ? null : String(value).slice(0, 40);
}

function clean(event) {
  if (!event || typeof event !== "object" || event.enabled === false) return null;
  const title = text(event.title);
  const start = Date.parse(event.startAt);
  if (!title || Number.isNaN(start)) return null;
  return {
    id: String(event.id || `${event.startAt}-${title.en}`).slice(0, 80),
    startAt: new Date(start).toISOString(),
    datePrecision: PRECISIONS.includes(event.datePrecision) ? event.datePrecision : "EXACT",
    title,
    country: /^[A-Z]{2,6}$/.test(event.country || "") ? event.country : "",
    category: optional(event.category),
    impact: IMPACTS.includes(event.impact) ? event.impact : "MEDIUM",
    actual: optional(event.actual),
    previous: optional(event.previous),
    forecast: optional(event.forecast),
    sourceUrl: /^https:\/\//.test(event.sourceUrl || "") ? String(event.sourceUrl) : null,
  };
}

// Simple row → the bilingual shape above. A missing time means "date only".
export function fromSimple(row) {
  if (!row || typeof row !== "object" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || "")) return null;
  const time = String(row.time || "").trim();
  if (time && !/^\d{2}:\d{2}$/.test(time)) return null;
  return clean({
    ...row,
    id: row.id || `${row.date}T${time || "--"}-${row.country || ""}-${row.title || ""}`,
    startAt: `${row.date}T${time || "00:00"}:00Z`,
    datePrecision: time ? "EXACT" : "DAY",
  });
}

// Date-only events have no hour, so they sort after that day's timed events.
function sortKey(event) {
  const start = Date.parse(event.startAt);
  return event.datePrecision === "DAY" ? start + 86400000 - 1 : start;
}

export function normalizeEvents(data) {
  const rows = Array.isArray(data) ? data.map(fromSimple) : (Array.isArray(data?.events) ? data.events.map(clean) : []);
  return rows.filter(Boolean).sort((a, b) => sortKey(a) - sortKey(b) || a.startAt.localeCompare(b.startAt));
}

async function readJson(bucket, key) {
  const object = await bucket.get(key);
  return object ? { key, data: await object.json(), uploaded: object.uploaded } : null;
}

export async function onRequestGet(context) {
  const bucket = context.env.MARKETLEVELMAP_PUBLIC;
  if (!bucket) return json({ events: [], error: "R2 binding MARKETLEVELMAP_PUBLIC is not configured." });
  const wanted = new URL(context.request.url).searchParams.get("lang");
  const lang = LANGS.includes(wanted) ? wanted : "en";
  const keys = [lang, ...LANGS.filter((l) => l !== lang)].map((l) => `site-events/events.${l}.json`).concat(LEGACY_KEY);
  try {
    for (const key of keys) {
      const found = await readJson(bucket, key);
      if (!found) continue;
      const updatedAt = found.data?.updatedAt || (found.uploaded ? found.uploaded.toISOString() : null);
      return json({ lang: key.match(/events\.(\w+)\.json$/)?.[1] || null, updatedAt, events: normalizeEvents(found.data) }, CACHE_SECONDS);
    }
    return json({ events: [], error: "No events file is published." }, CACHE_SECONDS);
  } catch (_) {
    return json({ events: [], error: "The events file could not be read." }, CACHE_SECONDS);
  }
}
