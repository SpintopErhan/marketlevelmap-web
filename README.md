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
