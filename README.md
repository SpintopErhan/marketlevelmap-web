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
