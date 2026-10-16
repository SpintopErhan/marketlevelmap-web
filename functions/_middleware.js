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

const METHOD_NAMES = { cz: "Critical Zones", pa: "Price Action" };

// Same rule as the pages: which evaluation method a chart belongs to.
function methodOf(graphicKey) {
  const key = (graphicKey || "").toLowerCase();
  if (/cz|critical/.test(key)) return "cz";
  if (/(^|[^a-z])pa([^a-z]|$)|price[ _-]?action/.test(key)) return "pa";
  return "";
}

// Image of the asset's active chart for the requested method (Critical Zones by default).
// Null when the asset has no active bulletin.
async function bulletinImage(env, asset, method) {
  const bucket = env.MARKETLEVELMAP_PUBLIC;
  if (!bucket) return null;
  try {
    const object = await bucket.get(ACTIVE_POINTER_KEY);
    if (!object) return null;
    const pointer = await object.json();
    const rows = (pointer?.entries || []).filter((entry) => entry.image && (entry.graphicKey || "").split(":")[1] === asset);
    const wanted = method || "cz";
    rows.sort((a, b) => ((methodOf(b.graphicKey) === wanted) - (methodOf(a.graphicKey) === wanted)) || a.graphicKey.localeCompare(b.graphicKey));
    if (!rows.length) return null;
    return { url: `/api/publication/image/${encodeURIComponent(rows[0].publicationId)}`, method: methodOf(rows[0].graphicKey) };
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
      const requested = (url.searchParams.get("method") || "").toLowerCase();
      const chart = /^[A-Z0-9]{2,20}$/.test(asset) ? await bulletinImage(context.env, asset, METHOD_NAMES[requested] ? requested : "") : null;
      if (chart) {
        const name = METHOD_NAMES[chart.method];
        title = name ? `${asset} ${name} bulletin · ${SITE}` : `${asset} bulletin · ${SITE}`;
        description = name
          ? `${name} charts for ${asset}. Structure-based market analysis.`
          : `Critical Zones and Price Action charts for ${asset}. Structure-based market analysis.`;
        image = chart.url;
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
