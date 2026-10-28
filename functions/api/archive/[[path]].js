// Earlier analyses of one market pair (README "Archive JSON"; engine contract LOCAL_PUBLICATION_PACKAGE_CONTRACT_V1
// "Arşiv: önceki analizler — V1"). The local engine writes `site-publication/archive/<marketPair>.json` when a newer
// publication replaces a chart. Only objects listed there are served; `publication-packages/` is never listed.
const ACTIVE_POINTER_KEY = "site-publication/active.json";
const SYMBOL = /^[A-Z0-9]{2,20}$/;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const LIST_SECONDS = 300;
const OBJECT_SECONDS = 86400; // archived objects never change

function json(value, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

function validTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : null;
}

async function readJson(bucket, key) {
  const object = await bucket.get(key);
  if (!object) return null;
  try { return await object.json(); } catch (_) { return null; }
}

async function archiveItems(bucket, symbol) {
  const data = await readJson(bucket, `site-publication/archive/${symbol}.json`);
  if (!data || data.schemaVersion !== "marketlevelmap-site-archive-v1" || !Array.isArray(data.items)) return [];
  return data.items.filter((item) => item && typeof item.publicationId === "string" && ID.test(item.publicationId)
    && typeof item.graphicKey === "string" && item.graphicKey.split(":")[1] === symbol);
}

function resource(item, kind, symbol) {
  const value = item[kind];
  if (!value || typeof value.objectKey !== "string") return null;
  return {
    url: `/api/archive/${kind === "analysisComment" ? "comment" : kind}/${encodeURIComponent(item.publicationId)}?symbol=${symbol}`,
    mediaType: value.mediaType,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
  };
}

// One row per analysis: the same release republished (same chart, same sourceReleaseId) is shown once, with the
// newest publication and the whole time it was on the site. A publication that is active today is left out.
// Newest analysis first.
function publicItems(items, activeIds, symbol) {
  const groups = new Map();
  for (const item of items) {
    if (activeIds.has(item.publicationId)) continue;
    const until = validTime(item.liveUntil);
    if (!until) continue;
    const key = `${item.graphicKey}|${item.sourceReleaseId || item.publicationId}`;
    const from = validTime(item.liveFrom);
    const group = groups.get(key);
    if (!group) { groups.set(key, { item, from, until }); continue; }
    if (until > group.until) { group.item = item; group.until = until; }
    if (from && (!group.from || from < group.from)) group.from = from;
  }
  return [...groups.values()].map(({ item, from, until }) => ({
    graphicKey: item.graphicKey,
    publicationId: item.publicationId,
    sourceReleaseId: item.sourceReleaseId || null,
    analyzedAt: validTime(item.analyzedAt) || from,
    liveFrom: from,
    liveUntil: until,
    ...(item.rangeStatus === "NO_CONFIRMED_RANGE" || item.rangeStatus === "CONFIRMED" ? { rangeStatus: item.rangeStatus } : {}),
    image: resource(item, "image", symbol),
    analysisComment: resource(item, "analysisComment", symbol),
    report: resource(item, "report", symbol),
  })).sort((a, b) => String(b.analyzedAt).localeCompare(String(a.analyzedAt)) || b.liveUntil.localeCompare(a.liveUntil)
    || b.publicationId.localeCompare(a.publicationId));
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
  if (!SYMBOL.test(symbol)) return json({ items: [], error: "Invalid symbol." }, 400);
  const bucket = context.env.MARKETLEVELMAP_PUBLIC;
  if (!bucket) return json({ items: [], error: "R2 binding MARKETLEVELMAP_PUBLIC is not configured." }, 503);
  const path = context.params.path || [];
  try {
    const items = await archiveItems(bucket, symbol);
    if (!path.length) {
      const pointer = await readJson(bucket, ACTIVE_POINTER_KEY);
      const activeIds = new Set((Array.isArray(pointer?.entries) ? pointer.entries : []).map((entry) => entry && entry.publicationId));
      return json({ symbol, items: publicItems(items, activeIds, symbol) }, 200, LIST_SECONDS);
    }
    const kinds = { report: "report", image: "image", comment: "analysisComment" };
    if (path.length !== 2 || !kinds[path[0]]) return json({ error: "Unknown archive resource." }, 404);
    const item = items.find((row) => row.publicationId === path[1]);
    const value = item && item[kinds[path[0]]];
    if (!value || typeof value.objectKey !== "string" || !value.objectKey.startsWith("publication-packages/")) {
      return json({ error: "This analysis is not in the archive." }, 404);
    }
    const object = await bucket.get(value.objectKey);
    if (!object) return json({ error: "Archived resource is unavailable." }, 404);
    const headers = new Headers();
    headers.set("Content-Type", object.httpMetadata?.contentType || value.mediaType || "application/octet-stream");
    headers.set("Cache-Control", `public, max-age=${OBJECT_SECONDS}`);
    if (object.etag) headers.set("ETag", object.etag);
    return new Response(object.body, { headers });
  } catch (_) {
    return json({ symbol, items: [], error: "The archive could not be read." }, 500);
  }
}
