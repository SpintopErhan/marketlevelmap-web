# Chart-data Worker (`marketlevelmap-chart-data`)

Scheduled Cloudflare Worker that will keep the public chart data in R2 up to
date: candles first, later the home-page sparklines and key levels (see the engine repository: `interaktif-grafik-plani.md` and
`PUBLIC_CHART_CANDLE_DATA_CONTRACT_V1.md`). It is a separate Worker from the
Pages site: Pages Functions cannot run on a schedule.

The site's `functions/_middleware.js` answers 404 for `/workers/*`, so these
sources are never served by Pages even though Pages publishes the repository root.

## Phase 0 — Binance access probe (current)

Every hour at `:02` UTC the Worker reads the last three 1H klines for BTC, ETH,
SOL, XRP and AVAX from `https://data-api.binance.vision` (plus one request to
`api.binance.com` for comparison) and logs one JSON line:

```json
{"probe":"binance-access-v1","at":"…","colo":"FRA","loc":"DE","ok":true,
 "primary":[{"pair":"BTCUSDT","status":200,"ms":180,"lastClosedOpen":"…","fresh":true}, …],
 "fallback":{"base":"https://api.binance.com","pair":"BTCUSDT","status":451, …}}
```

- `ok` is `true` only when every pair answered 200 with the expected latest
  CLOSED candle (`fresh`). Open candles are ignored.
- `colo`/`loc` show which Cloudflare datacenter ran the job — Binance restricts
  some countries, so failures must be read together with the location.
- No writes. The only secret is `PROBE_TOKEN` (placement test); ~14 subrequests per run.

Acceptance: a few days of hourly runs with `ok: true` (across whatever
datacenters Cloudflare chooses). Any `ok: false` line is kept as evidence.

## Placement test (2026-10-20)

The first probe run (colo MEL, loc US) got 403 from both Binance endpoints. This variant asks
Cloudflare to run the Worker near Frankfurt (`[placement] region = "aws:eu-central-1"`, documented for
fetch handlers). Each cron run logs one `placement-test-v1` line with two probes: `direct` (scheduled
handler) and `viaFetch` (its own fetch handler through the `SELF` service binding). The fetch handler is
also on workers.dev for a manual test, but answers 404 unless the `x-probe-token` header equals the
`PROBE_TOKEN` secret. Success means `viaFetch.ok: true` with a non-US `loc` over several runs.

**Result (2026-10-20 05:48 UTC, manual call):** placement applied (`Cf-Placement: remote-FRA`, colo FRA),
but every request still got 403 — CloudFront `403 Forbidden` from data-api.binance.vision and 403 from
api.binance.com. Running in Europe does not help: Binance rejects Cloudflare Worker traffic itself. The
`loc` field showed the caller's country (TR), so it is not an egress-country signal. The Worker was
deleted after the test; this code stays only as a record.

## Deploy and observe (run inside `workers/chart-data/`)

```
npx wrangler login            # once
npx wrangler deploy           # creates the Worker and its cron trigger
npx wrangler tail             # live logs; or Dashboard → Workers → marketlevelmap-chart-data → Logs
```

Local check before deploying:

```
npx wrangler dev --test-scheduled
# in another terminal:
curl "http://localhost:8787/__scheduled?cron=2+*+*+*+*"
```

Remove the probe later with `npx wrangler delete` or by deploying the real job.

## Tests

From the repository root (Node 20+):

```
node --experimental-detect-module --test workers/chart-data/test/
```
