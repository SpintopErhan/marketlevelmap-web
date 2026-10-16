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

`functions/_middleware.js` adds description, Open Graph and Twitter tags to every HTML page. Bulletin
links preview the asset's active chart for the method in the query string — `/bulletin?asset=BTCUSDT&method=pa`
for Price Action, Critical Zones otherwise. The method must be a query parameter: a `#pa` fragment is never
sent to the server, so link previews cannot see it. Other pages use `assets/og-image.png`.

## Live price strip (homepage)

The strip shows the assets of the active publication. The first prices come from `/api/prices`
(`functions/api/prices.js`), which calls Binance's public REST API from Cloudflare and caches each symbol set
for 3 seconds. The browser then opens a public WebSocket directly — Binance, or Coinbase's `ticker` channel
where Binance is blocked — so live updates never go through Cloudflare and use no Functions quota. Only if no
stream can be opened does the strip refresh from `/api/prices`, every 15 seconds.
Binance refuses requests from some countries (e.g. the Netherlands, the US) — including from the Cloudflare
location serving those visitors — so `/api/prices` falls back to Coinbase's public API (USD pair — Coinbase's liquid market — else USDT)
and reports `source: "coinbase"`; the strip's source label follows. When both fail it still answers 200
with `prices: []` and the upstream status codes in `attempts`.

## Market summary (bulletin page)

`/api/stats?symbol=BTCUSDT` (`functions/api/stats.js`) returns the last price, 24h open/high/low and quote
volume, and this week's (Monday 00:00 UTC) and month's opening prices — from Binance, or from Coinbase
(USD pair, else USDT; opens from the latest daily candles) where Binance refuses the request. Cached for 60 seconds per
symbol. Binance refuses requests coming from Cloudflare, so the bulletin page first opens Binance's public
stream from the visitor's browser (`<symbol>@ticker`, `@kline_1w`, `@kline_1M`) and shows live Binance figures;
`/api/stats` (in practice Coinbase) is used only when the browser cannot reach Binance — shown after 2.5 s
without Binance data and refreshed every 5 minutes while the tab is visible.

## Shared assets and browser caches

Pages link `assets/site.css` and `assets/disclaimer.js` with a `?v=` content hash so browsers pick up new
versions. After editing either file, update the hash in all four HTML pages, e.g.
`sha1sum assets/site.css | cut -c1-8`.

## Browser-side market cache

`assets/market-cache.js` (linked with a `?v=` hash like the other shared assets) keeps, in the visitor's
`localStorage`: the latest 24h figures per symbol (written by the homepage strip and the bulletin summary),
this week's/month's opening prices, and whether both Binance streams failed in the last 30 minutes. Pages
paint cached figures (≤15 minutes old, labelled with their time) immediately, and skip Binance while it is
marked unreachable so blocked visitors go straight to Coinbase.
