// Adds link-preview (Open Graph / Twitter) and description tags to every HTML page.
// Crawlers do not run the page scripts, so analysis titles and chart images are set here.
const ACTIVE_POINTER_KEY = "site-publication/active.json";
const SITE = "MarketLevelMap";
const DEFAULT_DESCRIPTION = "Live market table and structure-based analysis of crypto markets: support and resistance zones and key levels.";

const PAGES = {
  "/": { title: "MarketLevelMap — Market table", description: DEFAULT_DESCRIPTION },
  "/weekly-events": { title: "Weekly events · MarketLevelMap", description: "Market-moving events of the week: macro data releases and central-bank decisions." },
  "/archive": { title: "Archive · MarketLevelMap", description: "Earlier MarketLevelMap analyses by date." },
  "/bulletin": { title: "Analysis · MarketLevelMap", description: DEFAULT_DESCRIPTION },
};

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function pageKey(pathname) {
  const path = pathname.replace(/\.html$/, "").replace(/\/index$/, "/");
  return path === "" ? "/" : path;
}

// Link previews always use the site image (logo); charts are no longer published as images.
const OG_IMAGE = "/assets/og-image.png?v=dd26b484";

// Texts for a shared analysis link. They match the share text on the page (bulletin.html "shareText");
// `lang=tr` in the link (added when the page is in Turkish) gives the Turkish preview.
const ANALYSIS_TEXT = {
  en: {
    title: (asset, tf) => `${asset}${tf ? " " + tf : ""} support and resistance zones · ${SITE}`,
    description: (asset, tf) => `Critical Zones analysis of ${asset}${tf ? " on the " + tf + " chart" : ""}: support and resistance zones and key levels.`,
  },
  tr: {
    title: (asset, tf) => `${asset}${tf ? " " + tf : ""} destek ve direnç bölgeleri · ${SITE}`,
    description: (asset, tf) => `${asset}${tf ? " " + tf + " grafiğinin" : ""} Critical Zones analizi: destek ve direnç bölgeleri ve anahtar seviyeler.`,
  },
};

// Timeframes of the asset's active Critical Zones analyses (graphicKey "<source>:<ASSET>:<tf>:…"), or null
// when the asset has none, so a preview never describes an analysis that does not exist. Price Action
// entries are left out, as on the page.
const PRICE_ACTION = /(^|[^a-z])pa([^a-z]|$)|price[ _-]?action/;
async function activeTimeframes(env, asset) {
  const bucket = env.MARKETLEVELMAP_PUBLIC;
  if (!bucket) return null;
  try {
    const object = await bucket.get(ACTIVE_POINTER_KEY);
    if (!object) return null;
    const pointer = await object.json();
    const tfs = (pointer?.entries || [])
      .filter((entry) => (entry.image || entry.report) && (entry.graphicKey || "").split(":")[1] === asset)
      .filter((entry) => !PRICE_ACTION.test((entry.graphicKey || "").toLowerCase()))
      .map((entry) => ((entry.graphicKey || "").split(":")[2] || "").toLowerCase());
    return tfs.length ? tfs : null;
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
    const image = OG_IMAGE;
    if (key === "/bulletin") {
      const asset = (url.searchParams.get("asset") || "").toUpperCase();
      const tf = (url.searchParams.get("tf") || "").toLowerCase();
      const text = ANALYSIS_TEXT[url.searchParams.get("lang") === "tr" ? "tr" : "en"];
      const tfs = /^[A-Z0-9]{2,20}$/.test(asset) ? await activeTimeframes(context.env, asset) : null;
      if (tfs) {
        const label = tfs.includes(tf) ? tf.toUpperCase() : "";
        title = text.title(asset, label);
        description = text.description(asset, label);
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
