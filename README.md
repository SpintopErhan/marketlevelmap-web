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
  "levels": [ { "code": "ATH", "price": 109588 }, { "code": "PWO", "price": 86510 },
              { "code": "MO", "price": 79210 }, { "code": "YO", "price": 71950 } ]
}
```

`type` is `resistance` or `support`; `drawn: false` zones appear only under "Show all zones", dashed.
Level codes: `ATH`, `PWO`, `MO`, `YO` from the engine; `DO` and `WO` are always taken live from the
exchange (`MO` falls back to the live monthly candle until a report provides it). Without a report the
note falls back to the entry's `analysisComment` text.

**Archive JSON** — `site-publication/archive/<SYMBOL>.json`, served by `/api/archive?symbol=`:

```json
{ "items": [ { "publishedAt": "2026-10-13T10:20:00Z", "timeframes": ["1h", "4h", "1d"], "url": "/archive.html#2026-10-13" } ] }
```

**Events JSON** — `site-events/events.json` (maintained by hand for now), served by `/api/events`, which
drops invalid or `enabled: false` entries and answers `{ events: [], error }` if the file is missing or broken:

```json
{
  "updatedAt": "2026-10-19T08:00:00Z",
  "events": [
    { "id": "tr-cbrt-2026-10", "startAt": "2026-10-22T11:00:00Z", "datePrecision": "EXACT",
      "title": { "tr": "TCMB faiz kararı", "en": "CBRT interest-rate decision" },
      "country": "TR", "category": "MACRO", "impact": "HIGH",
      "previous": "40,5%", "forecast": null, "actual": null, "sourceUrl": "https://www.tcmb.gov.tr/" }
  ]
}
```

`datePrecision` is `EXACT` (time shown, UTC) or `DAY`; `impact` is `VERY_HIGH`, `HIGH` or `MEDIUM`.

## Sample data on previews

`assets/demo-data.js` generates zones, key levels, notes, archive rows and events around the live price.
It is used only on preview hosts (`*.pages.dev`, `localhost`) or with `?demo=1` (`?demo=0` turns it off),
never on marketlevelmap.com by default, and every section it fills shows a "Sample data" badge.

## Shared assets and browser caches

Pages link the files in `assets/` (`site.css`, `disclaimer.js`, `market-cache.js`, `market-feed.js`,
`market-ui.js`, `demo-data.js`) with a `?v=` content hash so browsers pick up new versions. After editing
one, update its hash in every page that loads it, e.g. `sha1sum assets/site.css | cut -c1-8`.
