// Adds link-preview (Open Graph / Twitter) and description tags to every HTML page.
// Crawlers do not run the page scripts, so bulletin titles and chart images are set here.
const ACTIVE_POINTER_KEY = "site-publication/active.json";
const SITE = "MarketLevelMap";
const DEFAULT_DESCRIPTION = "Critical Zones and Price Action chart bulletins for crypto markets. Structure-based market analysis.";

const PAGES = {
  "/": { title: "MarketLevelMap — Market Bulletins", description: DEFAULT_DESCRIPTION },
  "/weekly-events": { title: "Weekly events · MarketLevelMap", description: "Market-moving events as an independent calendar, separate from asset bulletins." },
  "/archive": { title: "Archive · MarketLevelMap", description: "Earlier MarketLevelMap bulletin publications by date." },
  "/bulletin": { title: "Bulletin · MarketLevelMap", description: DEFAULT_DESCRIPTION },
};

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function pageKey(pathname) {
  const path = pathname.replace(/\.html$/, "").replace(/\/index$/, "/");
  return path === "" ? "/" : path;
}

// Image of the asset's active chart, Critical Zones first. Null when the asset has no active bulletin.
async function bulletinImage(env, asset) {
  const bucket = env.MARKETLEVELMAP_PUBLIC;
  if (!bucket) return null;
  try {
    const object = await bucket.get(ACTIVE_POINTER_KEY);
    if (!object) return null;
    const pointer = await object.json();
    const rows = (pointer?.entries || []).filter((entry) => entry.image && (entry.graphicKey || "").split(":")[1] === asset);
    rows.sort((a, b) => (/cz|critical/i.test(b.graphicKey) - /cz|critical/i.test(a.graphicKey)) || a.graphicKey.localeCompare(b.graphicKey));
    return rows.length ? `/api/publication/image/${encodeURIComponent(rows[0].publicationId)}` : null;
  } catch (_) {
    return null;
  }
}

export async function onRequest(context) {
  const response = await context.next();
  if (!(response.headers.get("content-type") || "").includes("text/html")) return response;

  try {
    const url = new URL(context.request.url);
    const key = pageKey(url.pathname);
    const page = PAGES[key];
    if (!page) return response;

    let { title, description } = page;
    let image = "/assets/og-image.png";
    if (key === "/bulletin") {
      const asset = (url.searchParams.get("asset") || "").toUpperCase();
      const chart = /^[A-Z0-9]{2,20}$/.test(asset) ? await bulletinImage(context.env, asset) : null;
      if (chart) {
        title = `${asset} bulletin · ${SITE}`;
        description = `Critical Zones and Price Action charts for ${asset}. Structure-based market analysis.`;
        image = chart;
      }
    }

    const absolute = (path) => new URL(path, url.origin).toString();
    const tags = [
      ["name", "description", description],
      ["property", "og:site_name", SITE],
      ["property", "og:type", "website"],
      ["property", "og:title", title],
      ["property", "og:description", description],
      ["property", "og:url", url.toString()],
      ["property", "og:image", absolute(image)],
      ["name", "twitter:card", "summary_large_image"],
      ["name", "twitter:title", title],
      ["name", "twitter:description", description],
      ["name", "twitter:image", absolute(image)],
    ].map(([attr, name, content]) => `<meta ${attr}="${name}" content="${escapeAttr(content)}">`).join("");

    return new HTMLRewriter()
      .on('meta[name="description"]', { element: (element) => element.remove() })
      .on("title", { element: (element) => { if (key === "/bulletin") element.setInnerContent(title); } })
      .on("head", { element: (element) => element.append(tags, { html: true }) })
      .transform(response);
  } catch (_) {
    // Never break a page because preview tags could not be added.
    return response;
  }
}
