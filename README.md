# marketlevelmap-web
MarketLevelMap — Structure-Based Market Analysis

## Active publication reader

The site reads only the R2 object `site-publication/active.json`. It never lists
`publication-packages/` and therefore cannot accidentally expose staged or
archived packages.

Before merging `feature/r2-publication-reader-v1` into the deployment branch,
add this Pages production binding in Cloudflare:

1. **Workers & Pages → marketlevelmap → Settings → Bindings → Add → R2 bucket**
2. Variable name: `MARKETLEVELMAP_PUBLIC`
3. Bucket: `marketlevelmap-public`
4. Save and redeploy after the branch is merged.

The `/api/publication` Pages Function returns the active publication index and
safe image/comment URLs. `/api/publication/image/<publicationId>` and
`/api/publication/comment/<publicationId>` serve only objects referenced by the
current pointer. R2 remains private; browser clients never receive the R2 writer
credential.

## Chart times

Each entry returned by `/api/publication` carries `chartTime: { at, source }`, shown under the chart on
the bulletin page:

- `source: "publication"` — taken from the entry (or its `image`) in `active.json`. The publisher should
  write the chart's data/assessment time as an ISO-8601 field named `dataAsOf` (also accepted:
  `analysisTime`, `chartTime`, `generatedAt`, `renderedAt`, `createdAt`). Shown as "Chart data as of".
- `source: "metadata"` — the same field names in the image object's R2 custom metadata.
- `source: "upload"` — fallback: when the image was uploaded to R2. Shown as "Chart uploaded".

## Link previews

`functions/_middleware.js` adds description, Open Graph and Twitter tags to every HTML page. Every page,
analysis links included, previews the site image `assets/og-image.png` (logo only; linked with `?v=` so
X/Telegram fetch a new version). Analysis links get a title and description for the shared chart, the same
words as the page's share text: `/bulletin?asset=BTCUSDT&tf=1h` → "BTCUSDT 1H support and resistance zones ·
MarketLevelMap", "Critical Zones analysis of BTCUSDT on the 1H chart: …"; with `&lang=tr` (the share menu
adds it on the Turkish page) the Turkish text. The asset must have an active Critical Zones analysis and the
timeframe is named only if that analysis exists; otherwise the generic page text is used. Telegram and X
cache previews per link, so a link shared before a change keeps its old card for a while.

## Pages

- `index.html` — market table (live price, 24h change and volume, daily/weekly/monthly/yearly opens, ATH)
  and this week's events.
- `bulletin.html?asset=BTCUSDT&tf=4h` — analysis page: 1H/4H/1D chart, note, support/resistance zones,
  key levels and earlier analyses. Only Critical Zones (CZ) entries are shown; Price Action stays hidden.
- `weekly-events.html` — this/next week's events. `archive.html` — placeholder until archives are published.

## Live market data

`assets/market-feed.js` feeds the market table and the analysis page. Per symbol it paints the last figures
this browser saw (`assets/market-cache.js`, localStorage), then a snapshot from `/api/prices`
(`functions/api/prices.js`, edge-cached 3 s), then opens a public WebSocket from the browser: Binance
(miniTicker plus 1d/1w/1M klines for the daily, weekly and monthly opens) or, where Binance is blocked
(e.g. the Netherlands, the US — Binance also refuses requests from Cloudflare), Coinbase's `ticker` channel
(USD pair, else USDT). Only if no stream works does it refresh from `/api/prices` every 15 s. Live updates
never pass through Cloudflare. While Binance is marked unreachable (30 min) pages start on Coinbase but
keep probing Binance and switch back when it answers.

`/api/prices` itself reads Binance's REST API, falling back to Coinbase (`stats` + daily candles for the
opens); it always answers 200 with JSON and lists upstream status codes in `attempts` when it fell back.

The old scrolling price strip is kept in `assets/price-strip.js` / `assets/price-strip.css` but no page loads it.

## Key levels on the analysis chart

Each row of the analysis page's "Key levels" table starts with an eye toggle. A switched-on level is drawn
on the interactive chart as a dashed orange (`#e8a765`) price line labelled with its code (`DO`, `WO`,
`ATH`…) on the price axis (`LiveChart` `setLevels`). The choice is stored in this browser under
`mlm-chart-levels-v1` (a list of codes) and applies to every asset and timeframe; nothing is shown by
default. `DO`, `WO` and `MO` follow the live feed, so their lines move when a new period opens. Price lines
do not stretch the price scale: a level outside the visible range (often `ATH`) is simply not drawn.

## Chart watermark

The interactive analysis chart carries a faint "MarketLevelMap / marketlevelmap.com" text watermark in the
middle of the price pane (Lightweight Charts `createTextWatermark`, behind the candles). Its font size
follows the chart width (22–56 px). It is drawn on the chart canvas itself, so chart screenshots used for
downloads and sharing include it.

## Chart download

The analysis chart header has a Download button (next to Expand). It saves the interactive chart as drawn
— zones, chosen key levels, watermark, current zoom; no crosshair — as a PNG built in the browser
(`LiveChart` `screenshot()` = Lightweight Charts `takeScreenshot(true, false)`), with a title bar (asset ·
timeframe, "Critical Zones · <name>", MarketLevelMap / marketlevelmap.com) and a footer (the chart's
analysis and last-candle times, "Not investment advice."; on narrow charts the times shrink and the note is
left out). File name: `MarketLevelMap_<SYMBOL>_<TF>_<YYYYMMDD-HHMM>UTC.png` (download time, UTC). Older
PNG-only publications offer no download.

## Chart sharing

The chart header's Share button opens a menu:

- **X (Twitter)** — `x.com/intent/post?text=…&url=…`; **Telegram** — `t.me/share/url?url=…&text=…`. Both share
  the analysis page link `https://marketlevelmap.com/bulletin?asset=<SYMBOL>&tf=<tf>` with a short text
  ("BTCUSDT 4H support and resistance zones · MarketLevelMap", Turkish on the Turkish page).
- **Copy link** — the same link to the clipboard ("Link copied").
- **Share image…** — only where the browser can share files (`navigator.canShare({ files })`, i.e. most
  phones): the same PNG as Download plus the text and link go to the system share sheet. The PNG is built
  when the menu opens, so the share call stays inside the tap. Needs `chartDownload` to be allowed too.

Link previews show the site logo image and the shared chart's title (README "Link previews"); the chart
itself is not in the card.

On phones (≤ 600 px) the chart buttons (Share, Download, Expand) show icons only and carry `aria-label`s.

### Feature plans (premium)

`assets/features.js` decides who may use a feature: `PLAN = { chartDownload: "all", chartShare: "all" }`, where a value is
`"all"`, `"premium"` or `"off"`. `Features.state(name)` answers `allowed`, `locked` (premium-only and the
visitor is not premium: the button shows a lock, "For premium members", and does nothing) or `off`
(hidden). There are no accounts yet, so `isPremium()` returns false; a membership check plugs in there.
This only shapes the page — it is not access control, since anything drawn in a browser can be captured.

## Market table sparkline

The market table's Analysis column shows a 7-day price line per asset (`assets/sparkline.js`, wired in
`index.html`). It is decoration for the link to the analysis page; it reads no report and no zones.

- **Where it shows:** desktop only (`min-width: 701px`). On mobile, and on desktop until the line is drawn
  or when no data could be loaded, the cell shows the bar-chart icon instead. Resizing a narrow window to
  desktop width loads the lines then. All rows load at once (no IntersectionObserver: it does not fire in
  hidden or emulated panes, and the table is short).
- **Data:** 84 closed 2h candles (7 days) from Binance REST in the visitor's browser,
  `data-api.binance.vision/api/v3/klines?interval=2h&limit=84`, close = `k[4]`. Requests never pass through
  Cloudflare (Binance refuses Workers). If Binance cannot be reached, the 1h candles the local program
  uploads to R2 are used (`data.marketlevelmap.com/candles/index.json` → `<SYMBOL>/1h/<last archive>.json`
  plus `latest.json`, merged by open time). R2 has no 2h files, so only 1h candles opening on an odd UTC hour
  are kept: their close is the close of the 2h candle that opened an hour earlier. Checked against Binance:
  identical closes.
- **Live end:** the last point is replaced by the table's live price; a row is redrawn at most every 5 s.
- **Colour:** green (`--up`) if the live price is at or above the first close, red (`--down`) otherwise,
  with a dot on the last point. The link's `aria-label` carries the 7-day change ("7 days +2.41%").
- **Cache:** series are kept 10 minutes in localStorage under `mlm-spark-v2`. Change the key whenever the
  series format or candle size changes, so browsers do not draw old series. At least 12 points are needed.
- **Size:** 112 × 32 px SVG (2 px padding); the column is 132 px wide on desktop.

History: the first version (PR #36) used 168 × 1h candles and drew the nearest support/resistance zone of
the asset's report as faint bands behind the line. The bands looked cluttered and were removed together
with the switch to 2h candles (PR #37).

## Installable app (PWA)

The site can be added to the home screen (Android: install prompt or browser menu; iPhone: Safari → Share → Add
to Home Screen) and then opens full screen as "MLMap". No store and no push notifications.

- `manifest.webmanifest` (one for both languages; `start_url` `/?source=pwa`), icons in `assets/icons/`
  (192, 512, 512 maskable, 180 apple-touch; logo symbol on the dark background `#10161d`).
- Every page's head carries the manifest, theme-color, apple-touch-icon and app-title tags and loads
  `assets/pwa.js` (service worker registration, offline notice, install button / iPhone hint — dismissed for good
  once closed, never shown inside the installed app). The library generator adds the same tags.
- `sw.js` (site root), cache `mlm-v1` — market data is never served stale while the network works:
  pages network-first (offline: last copy, else `offline.html`); `/api/publication`, `/api/events`,
  `/api/archive` network-first (offline: last copy + "offline – data may not be up to date" notice);
  `/api/prices` never cached; `/assets/*` and the manifest stale-while-revalidate; other origins (exchanges,
  `data.marketlevelmap.com` candles) and websockets untouched. Updates install at once (`skipWaiting` +
  `clients.claim`); bump `VERSION` in `sw.js` when its rules change so old caches are deleted.
- `_headers` keeps `sw.js` and the manifest out of the CDN/browser cache and sets the manifest's content type;
  `_routes.json` keeps them and `offline.html` out of Pages Functions.



`/tr/kutuphane/…` and `/en/library/…` are static pages generated from `content/library` (one YAML file and one
SVG per pattern, both languages in the same file) by `scripts/build-library.mjs`, which also writes `sitemap.xml`.
The generated pages are committed, so Pages still has no build step: after changing the content run
`cd scripts && npm ci && node build-library.mjs` and commit the result. The `Library` GitHub check runs
`node build-library.mjs --check` on every PR and fails on invalid content or out-of-date pages. Authoring rules
(schema, SVG colour classes, URLs) are in `content/library/README.md`. Each language has its own URL so search
engines index both; the other pages link to the library in the visitor's language.

Weekly events link to the library: a concept with `event_keywords` (and optional `event_countries`) is listed in
the generated `assets/library-events.json`; `assets/event-links.js` adds a small book icon after an event title on
the weekly events page and the market page when a keyword appears in the title at the start of a word (case-insensitive, so Turkish suffixes match) and
the event's country matches. Nothing needs to be added to the hand-made events files.

`_routes.json` keeps `assets/`, the library pages, `sitemap.xml` and `robots.txt` out of Pages Functions, so they
do not run the middleware or count towards the Functions quota (library pages carry their own preview tags).

## Engine data contracts (R2)

The local engine does not publish these yet; the site reads them as soon as they exist. Until then the
sections stay hidden on marketlevelmap.com and are filled with sample data on preview hosts (see below).

**Report JSON** — one per chart, referenced from its entry in `site-publication/active.json` as
`"report": { "objectKey": "…", "mediaType": "application/json" }` and served at
`/api/publication/report/<publicationId>`:

```json
{
  "symbol": "BTCUSDT", "timeframe": "1h", "method": "cz",
  "analyzedAt": "2026-10-16T10:21:00Z",
  "note": { "tr": "…", "en": "…" },
  "noteSource": { "tr": "Algoritma tarafından üretildi, editör tarafından kontrol edildi", "en": "…" },
  "zones": [ { "type": "resistance", "low": 86200, "high": 86900, "formedAt": "2026-09-22", "drawn": true } ],
  "levels": [ { "code": "DO", "price": 82116 }, { "code": "MH", "price": 83158 }, { "code": "PWO", "price": 83773.12 },
              { "code": "MO", "price": 83623.59 }, { "code": "YO", "price": 87648.21 }, { "code": "OATH", "price": 125708.42 } ],
  "levelsAsOf": "2026-10-19T11:00:00Z"
}
```

`type` is `resistance` or `support`; `drawn: false` zones appear only under "Show all zones", dashed.
Level codes are the engine's Market Reference Levels, in this order: `DO`, `MH`, `MM`, `ML` (Monday
high/mid/low), `WO`, `PWO`, `MO`, `YO`, `OATH` (highest Binance candle; shown as the market table's ATH).
`levelsAsOf` is when they were computed. `DO`, `WO` and `MO` prefer the live exchange feed and fall back
to the report; the other levels are shown with "as of `levelsAsOf`". Without a report the note falls back
to the entry's `analysisComment` text.

**Archive JSON** — `site-publication/archive/<SYMBOL>.json`, served by `/api/archive?symbol=`:

```json
{ "items": [ { "publishedAt": "2026-10-13T10:20:00Z", "timeframes": ["1h", "4h", "1d"], "url": "/archive.html#2026-10-13" } ] }
```

**Events JSON** — maintained by hand, one simple list per language so the Turkish list can include
Turkey-only events: `site-events/events.en.json` and `site-events/events.tr.json` in the private bucket,
served by `/api/events?lang=en|tr` (the pages ask for the current language and refetch on a switch):

```json
[
  { "date": "2026-10-22", "time": "11:00", "country": "TR", "title": "TCMB faiz kararı", "actual": "" },
  { "date": "2026-10-24", "time": "", "country": "CRYPTO", "title": "Avalanche (AVAX) token unlock", "actual": "" }
]
```

`time` is UTC; an empty `time` means the date is known but not the hour (shown as "—"). `country` is 2–6
capital letters (`US`, `TR`, `EU`, `CRYPTO`). Optional per row: `impact` (`VERY_HIGH`, `HIGH`, `MEDIUM`),
`previous`, `forecast`, `sourceUrl` (https), `enabled: false`. Invalid rows are dropped. If the requested
language's file is missing the other language is used, then the legacy bilingual `site-events/events.json`
(`{ "events": [ { "startAt", "datePrecision", "title": { "tr", "en" }, … } ] }`). With no file at all the API
answers `{ events: [], error }` and the pages say the events could not be loaded.

## Sample data on previews

`assets/demo-data.js` generates zones, key levels, notes, archive rows and events around the live price.
It is used only on preview hosts (`*.pages.dev`, `localhost`) or with `?demo=1` (`?demo=0` turns it off),
never on marketlevelmap.com by default, and every section it fills shows a "Sample data" badge.

## Shared assets and browser caches

Pages link the files in `assets/` (`site.css`, `disclaimer.js`, `market-cache.js`, `market-feed.js`,
`market-ui.js`, `demo-data.js`, `sparkline.js`, `features.js`, `live-chart.js`) with a `?v=` content hash (the library
pages get theirs from the build script) so browsers pick up new versions. After editing
one, update its hash in every page that loads it, e.g. `sha1sum assets/site.css | cut -c1-8`.
