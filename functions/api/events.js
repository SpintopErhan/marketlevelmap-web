// Market events for the homepage and the weekly events page, read from the R2 object
// `site-events/events.json` (maintained by hand for now; see README "Events JSON").
// Invalid entries are dropped instead of breaking the page; a missing or unreadable file gives
// { events: [], error } with status 200 so the page can say "could not be loaded".
const EVENTS_KEY = "site-events/events.json";
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
  if (typeof value === "string") return { en: value, tr: value };
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
    country: /^[A-Z]{2,3}$/.test(event.country || "") ? event.country : "",
    category: optional(event.category),
    impact: IMPACTS.includes(event.impact) ? event.impact : "MEDIUM",
    actual: optional(event.actual),
    previous: optional(event.previous),
    forecast: optional(event.forecast),
    sourceUrl: /^https:\/\//.test(event.sourceUrl || "") ? String(event.sourceUrl) : null,
  };
}

export async function onRequestGet(context) {
  const bucket = context.env.MARKETLEVELMAP_PUBLIC;
  if (!bucket) return json({ events: [], error: "R2 binding MARKETLEVELMAP_PUBLIC is not configured." });
  try {
    const object = await bucket.get(EVENTS_KEY);
    if (!object) return json({ events: [], error: "No events file is published." }, CACHE_SECONDS);
    const data = await object.json();
    const events = (Array.isArray(data?.events) ? data.events : []).map(clean).filter(Boolean)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    return json({ updatedAt: data?.updatedAt || null, events }, CACHE_SECONDS);
  } catch (_) {
    return json({ events: [], error: "The events file could not be read." }, CACHE_SECONDS);
  }
}
