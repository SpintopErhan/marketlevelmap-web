// Earlier analyses of one asset, read from the R2 object `site-publication/archive/<SYMBOL>.json`
// written by the local engine (see README "Archive JSON"). Missing file: { items: [] }.
const SYMBOL = /^[A-Z0-9]{2,20}$/;
const CACHE_SECONDS = 300;

function json(value, maxAge) {
  return new Response(JSON.stringify(value), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

export async function onRequestGet(context) {
  const symbol = (new URL(context.request.url).searchParams.get("symbol") || "").toUpperCase();
  if (!SYMBOL.test(symbol)) return json({ items: [], error: "Invalid symbol." });
  const bucket = context.env.MARKETLEVELMAP_PUBLIC;
  if (!bucket) return json({ items: [], error: "R2 binding MARKETLEVELMAP_PUBLIC is not configured." });
  try {
    const object = await bucket.get(`site-publication/archive/${symbol}.json`);
    if (!object) return json({ symbol, items: [] }, CACHE_SECONDS);
    const data = await object.json();
    const items = (Array.isArray(data?.items) ? data.items : [])
      .filter((item) => item && !Number.isNaN(Date.parse(item.publishedAt)))
      .map((item) => ({
        publishedAt: new Date(Date.parse(item.publishedAt)).toISOString(),
        timeframes: (Array.isArray(item.timeframes) ? item.timeframes : []).map(String).filter((tf) => /^[0-9]{1,2}[mhdwM]$/.test(tf)),
        url: typeof item.url === "string" && item.url.startsWith("/") ? item.url : null,
      }))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, 50);
    return json({ symbol, items }, CACHE_SECONDS);
  } catch (_) {
    return json({ symbol, items: [], error: "The archive file could not be read." }, CACHE_SECONDS);
  }
}
