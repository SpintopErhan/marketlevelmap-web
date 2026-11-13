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
  and this week's events. Under the events a **Topic of the week** card links one library page: name, first
  summary sentence, track, "Next week: …". The list is `content/library/weekly-topics.json` (page ids in week
  order from a Monday 00:00 UTC anchor; it repeats); `scripts/build-library.mjs` checks it and writes
  `assets/weekly-topics.json`, and the page picks the week in the browser (before the anchor: the first topic).
- `bulletin.html?asset=BTCUSDT&tf=4h` — analysis page: 1H/4H/1D chart, note, support/resistance zones,
  key levels and earlier analyses. A switch at the top chooses the discipline: Critical Zones (default) or
  Price Action (`&method=pa`, see "Price Action view").
- Home page **"For members"** section (under the table): the live flow, scanner and flow summary with sample
  screenshots (`assets/members/*.jpg`, made from the test feeds) and a call to action that follows the account:
  guests sign in to apply, applicants see their profile, members open the live flow.
- `flow.html?asset=BTCUSDT` — members-only live order flow (see "Live order flow").
- `scanner.html` — members-only zone scanner, alarms and big trades (see "Zone scanner").
- `weekly-events.html` — this/next week's events. `archive.html` — placeholder until archives are published.
- `tr/hakkinda/`, `en/about/` — About: what the site is and why (approach and engine steps, what it offers,
  membership, analysis time, what it is not). `tr/rehber/`, `en/guide/` — Reading guide: what is on the chart
  and how to read it (the two views, zones, key levels, timeframes, five-step checklist, examples, mistakes,
  glossary). The guide does not link to About. Both pages use the library's type sizes and its sticky
  "On this page" card (hidden on phones; the guide keeps a contents list at the top there). Edited by hand.

## Live order flow

`flow.html?asset=BTCUSDT` (`/flow`), linked as "Live flow" from the analysis page of USDT (crypto) assets.
Opened without an asset (the menu link), it shows the asset and market (spot/futures) looked at last in this browser
(`localStorage` `mlm-flow-last`; BTC spot the first time).
Members only: guests get a sign-in card and registered/pending accounts a profile link (admins count as members).
The gate is in the page, because the data never passes through our server: `assets/flow.js` opens the exchanges'
public spot WebSockets in the visitor's browser, and nothing is stored or recorded. The session starts when the
page opens and keeps running in a background tab. Browsers slow background timers (Chrome and Opera to once a
minute), but WebSocket messages keep arriving, so each message drives a once-a-second tick (heatmap column, the zone
the price is in, the open-interest series, Binance futures polls); drawing waits until the tab is shown again. A tab
the browser freezes or discards (memory/energy saver) stops; keep the site active in the browser's settings or the
page in its own unminimised window.

- **Venues** — Binance (`<sym>@depth@100ms` kept in sync with a 5000-level REST snapshot, `aggTrade`),
  OKX (`books` 400 levels, `trades`), Coinbase Advanced Trade (`level2`, `market_trades`, `heartbeats`;
  `BASE-USD`). Combined by default; one venue can be picked. In the combined book each venue's prices are scaled
  by the first live venue's mid over its own, so the USD book lines up with the USDT books. Coinbase's trade side
  is taken from its own book (at/above the ask = buy). A venue that does not list the asset is marked "not listed".
- **Layout** — spot: order book on the left, Time & Sales (30 rows) on the right; in the middle a 2×2 grid: CVD and
  volume profile (up to 16 rows), then flow in the zone and depth. Futures: depth, CVD, volume profile and
  liquidations across the top; below them order book, Time & Sales, and flow in the zone with funding and open
  interest under it (`flow.js` moves the same cards into `.fx-top` / `.fx-bot`).
- **Order book** — 12 buckets each side (grouping 0.5 bp of the price rounded to 1-2-5 and three larger steps),
  notional per bucket, walls (≥3× the median bucket and ≥half the largest) in bold, buckets inside a Critical
  Zones band striped in the zone's colour, book balance within ±50 bp (narrower when the books do not reach).
- **CVD** — taker buy minus sell volume since the page opened, per 1s/5s/15s/1m bar with the price dashed;
  divergence flag when over the last minute the price moved ≥3 bp one way and the CVD (≥10% of the volume) the
  other. Last 5/15 min buy/sell share.
- **Depth** — cumulative book within ±1% (or as far as every selected book reaches), with the zones shaded;
  bid/ask ratios within ±10 and ±25 bp (only books that reach that far count).
- **Time & Sales** — newest 40 trades with venue, filters ≥2×/≥5×/≥10× the venue's average trade size
  (≥5× highlighted), buy/sell share of the last 200 trades.
- **Zones** — the latest Critical Zones reports of the asset: all timeframes together by default ("All"), or one
  (remembered in `localStorage` `mlm-flow-ztf`). Each zone carries its timeframe (a tag in the context bar, a label on
  the heatmap band); where zones of different timeframes overlap the list is joined ("1D+1W"), the band is drawn
  stronger and order-book/profile rows get an amber stripe. The context bar shows whether the price is inside a
  band and the nearest resistance above and support below.
- **Coinbase premium** — Coinbase USD mid over Binance USDT mid (OKX when Binance is not reachable), in the
  context bar, whatever venue is shown.
- **Flow in the zone** — from the moment the price enters a band (the narrowest one it is in): buys, sells and CVD of
  the shown venues inside it, resting orders inside the band on the zone's side (as far as the books reach), and
  after 30 s a one-line description (buying lifts the price / is absorbed, selling pushes it down / is absorbed,
  balanced within 5% of the volume; ±3 bp counts as a move). It resets when the price leaves the band; the last
  zone stays shown until the next one.
- **Session volume profile** — traded volume per price since the page opened (up to 24 rows, at least the book's
  grouping), the busiest level (POC) highlighted, rows inside a zone striped.

- **Liquidity heatmap** — full width above the other panels, on spot and futures. Every second the resting size of
  the shown venues is summed per price bucket (1 bp of the price, rounded 1-2-5) within ±1% (or as far as the books
  reach) and kept in memory for 60 minutes; nothing is stored. Window 15/30/60 min (30 by default; a younger session
  fills the width), price range ±0.1/0.25/0.5/1% around the price (±0.5% by default; −/+ buttons, the wheel in full
  screen), brightness by the 99th percentile of the visible cells, approached gradually so colours do not jump
  between frames (power 0.9, so only clear walls glow; a venue whose book is briefly unusable keeps its last
  column for 15 s; a dark ramp on
  the light theme). A legend under the title explains the marks. On top: the price line, big trades (≥5× the venue's running average, circles), liquidations on futures
  (squares) and the Critical Zones bands. "Full screen" uses the Fullscreen API, else a fixed overlay.
- **Wall marks** on the heatmap (`detectWalls`): a wall is a bucket with ≥5× the median resting size within ±0.5%.
  Pulled (×): a wall within ±0.15% of the price shrinks by ≥70% in 3 s while <30% of the drop traded there and the
  price has not reached it. Absorption (◆): the price is within 2 buckets of a wall; over 10 s at least half the
  wall's size traded into it, yet it keeps ≥70% of its size. One mark per bucket and kind every 30 s.
- **Save PNG** — a 1600×900 image in the page's theme: title (asset, spot/futures, venues, UTC time), the context
  line, the heatmap, CVD and depth as drawn, and the key figures (zone flow, buy/sell; futures: OI, liquidations).
- **How to read** — a button next to the title and a "?" on every panel open one dialog (`HELP` in `flow.js`, TR/EN)
  with a section per panel (what it shows, how to read it); a panel's "?" opens it at that section. Futures-only
  sections show on futures, the Coinbase premium on spot.
- **Spot | Futures** — the switch at the top reloads the page with `&market=futures` (a new session). On futures, a Binance
  feed with no book and no funding after 20 s is marked unavailable, so the combined view runs on OKX and Bybit. Futures uses
  USDT perpetuals of Binance (USD-M: `aggTrade`, `markPrice@1s`, `forceOrder` on `fstream.binance.com/market/ws`,
  top-20 `depth20@100ms` on `/public/ws` plus a 1000-level REST snapshot every 5 s beyond it, open interest from
  `/fapi/v1/openInterest` every 5 s, funding interval from `/fapi/v1/fundingInfo`), OKX (`<BASE>-USDT-SWAP`; sizes
  × `ctVal` from `/api/v5/public/instruments`; `books`, `trades`, `open-interest`, `funding-rate`, `index-tickers`,
  `liquidation-orders`) and Bybit linear (`orderbook.1000`, `publicTrade`, `tickers`, `allLiquidation`). Every spot
  panel works the same on futures data; on top of them:
  - context bar: funding (open-interest weighted average of the shown venues), countdown to the next funding, total
    open interest (coin and $), its change since the page opened, basis (perp mid − index price; Binance, else Bybit,
    else OKX index). The Coinbase premium is spot only.
  - **Funding and open interest** — per venue: funding, annualised (by the venue's interval, 8 h when unknown),
    open interest and its session change; the session's open interest and price (sampled every 5 s); after 5 min a
    one-line description of the last 5 min (OI change under 0.1% counts as flat).
  - **Liquidations** — the venues' public liquidation feeds (long = forced sell, red; short = forced buy, green),
    long/short totals of the last 15 min, ≥$100K highlighted. Exchanges publish only part of them (Binance at most one
    per second per symbol), so totals are a floor; the page says so.

## Flow summary

`assets/flow-mini.js`, on the analysis page of USDT assets for members (not in the admin desk embed): a card at the
top of the side column with the last 5 min buy/sell share and the session CVD, funding and basis, liquidations of the
last 15 min, the open-interest 1-hour change, a one-line "last 5 min: price, CVD" and a link to the live flow. One
venue at a time, chosen on the card (Binance | OKX, remembered in `localStorage` `mlm-fm-venue`; switching closes the
old sockets and starts over). Binance: spot `aggTrade`, USD-M `<sym>@markPrice@1s` and `<sym>@forceOrder`,
`openInterestHist` (else its own minute samples of `/fapi/v1/openInterest`). OKX: one socket with spot `trades`, swap `funding-rate`, `mark-price`, `index-tickers` and
`liquidation-orders` (sizes × `ctVal`), and `rubik/stat/contracts/open-interest-volume` (5-minute periods) for the
1-hour change. When Binance sends no funding within 10 s, the card switches to OKX for that visit (the saved
choice is kept). Read in the browser; nothing is stored.

## Zone scanner

`scanner.html` (`/scanner`), members only (same gate as the live flow). Every asset with a Critical Zones report
on the chosen timeframe (4H/1D/1W, as published; remembered per browser): live price (`assets/market-feed.js`),
status (inside the support/resistance zone, within 1% of the nearest resistance/support, between zones), a
position bar from the support zone below to the resistance zone above, and the nearest resistance and support
with their distance. Rows are sorted by closeness; the asset links to its live flow.

- **Alarms** — the bell on a row: ring when the price enters a zone and/or leaves one (per asset and timeframe).
  They are kept in this browser only (`localStorage` `mlm-zone-alarms`) and ring while the page is open, also in a
  background tab (the scanner starts the price feed with `background: true`, so it does not pause there): a card
  on the page and, when allowed, a browser notification. Nothing is sent to our server.
- **Big trades** — Binance `aggTrade` for every USDT asset in one public stream (`data-stream.binance.vision`, else
  `stream.binance.com`). aggTrades of one taker order (same time and side) are added up first; a print is listed
  when it is at least 5×/10×/20× (chosen) the asset's average print of the last 500 and at least $10K.

- **Spot | Futures** — `?market=futures` swaps the zone columns (position bar, nearest zones) for Binance USD-M
  figures: funding (annualised under it), open interest ($; `/fapi/v1/openInterest` every minute × mark price) and its
  1-hour change (`/futures/data/openInterestHist`, 5-minute periods, every 5 min; when that does not answer, from the
  page's own minute samples, marked "session"), and liquidations of the last 15 min since the page opened
  (`<sym>@markPrice@1s` and `<sym>@forceOrder` per asset in one socket on `fstream.binance.com/market/ws`, the streams
  the live flow uses; the all-market `!…@arr` streams delivered nothing there). Clicking a futures column title sorts by it
  (again: back to the zone order). Big trades then come from futures `aggTrade`. **Rule:** when Binance futures sends
  no funding within 10 s (it is restricted in some countries), the page switches to OKX USDT swaps and says so: one
  socket with `funding-rate`, `mark-price` and `trades` per asset plus `liquidation-orders` (sizes × `ctVal` from the
  instrument list), open interest from `/api/v5/public/open-interest` every minute and its 1-hour change from
  `rubik/stat/contracts/open-interest-history` (else the page's samples). Assets without an OKX swap show "—". Status and alarms stay on spot prices.

`assets/scanner.js` does all of it in the browser. The menu of every page (and the library template) links
"Live flow" and "Scanner"; between 521 and 1180 px wide the menu takes its own row under the logo.


## Weekly outlook

`weekly.html` (`/weekly`) and a card at the top right of the home page. Data: `GET /api/weekly`
(`functions/api/weekly.js`), one snapshot per week (Monday 00:00 UTC), cached at the edge for an hour once
every asset has last week's candle. Every analysed asset except PAXG:

- **Last week** — open → close of the weekly candle that opened the Monday before (public candles,
  `data.marketlevelmap.com/candles/<SYMBOL>/1w/latest.json`, else the newest 1W archive). If that candle is not
  uploaded yet the asset shows "–"; an older week is never used in its place.
- **Levels and structure** — last week's close against the monthly open, yearly open and ATH: `keyLevels` of
  `levels.json` (a level whose period began after the week closed is left out); until an asset's file has
  them, its 1D Critical Zones report (`MO`, `YO`, `ATH` else `OATH`).
- **Structure direction** (1D timeframe alignment) — `structure.state` of the 1W, 1D and 4H Price Action reports, with the analysis
  page's rule (aligned / main trend with 4H against / conflict). Only these three states are public; the 4H
  and 1W reports stay members-only.

The page shows a heat map (BTC on top, then the usual market order) and one row per asset; "Download image"
draws the same as a 1600×900 PNG (dark look, page language) for X.

## Price Action view

Price Action (PA) is a separate discipline from Critical Zones (CZ), so the analysis page shows it as its own
view, not as more support/resistance zones.

- **Switch.** Under the coin's name, before the timeframe tabs: "Critical Zones | Price Action". The choice
  is in the address (`method=cz` / `method=pa`; CZ when absent) so shared links open the same view. The coin,
  live price, key levels and earlier analyses stay the same; the timeframe tabs, chart and analysis tables
  follow the discipline. Market-table rows still open Critical Zones. An asset with no CZ entry opens PA.
- **Which timeframes.** CZ entries are `CZ:` and `CZ_SHORT:` graphic keys, PA entries `PA:`. A PA timeframe
  is listed only when its report has a confirmed range (one `resistance` = range high RH, one `equilibrium`
  = EQ, one `support` = range low RL); a PA chart without a confirmed range is not listed. With no listed PA
  timeframe the "Price Action" side of the switch is disabled.
- **Chart.** RH, EQ and RL bands (red, blue, green, as published) and the report's FVG boxes: neutral grey,
  dashed edge, label `FVG ↑` (bullish) / `FVG ↓` (bearish), from `createdAt` to the right edge, drawing the
  remaining gap (`low`–`high`) and fading as `filledPercent` grows.
- **Range table** (instead of "Support and resistance zones"): range high, equilibrium and range low with
  their bands and distance; range width (`RH.high − RL.low`, also as % of the price); and where the live price
  sits: `(price − RL.low) / (RH.high − RL.low)` as a percentage, read as **premium** above EQ, **equilibrium**
  inside EQ, **discount** below EQ, or **above / below the range** outside RL–RH (then without a percentage).
  No "Formed" column.
- **FVG table.** One row per FVG: direction, remaining gap, filled %, distance. Hidden when the report has no
  `fvg`. A note under it says when the fill was computed ("Fill as of `fvgAsOf`"): the analysis time belongs to
  the range, while the fill follows the closed candles up to the publication.
- **Structure** (when the report has `structure`). On the chart: BOS / CHoCH as a short horizontal line from the
  broken swing's candle to the break candle with a label in the middle (`BOS ↑ / ↓`, `CHoCH ↑ / ↓`; BOS soft lavender
  `#a99cf0` dashed, CHoCH stronger pink-violet `#e27bd0` solid), sweeps as a small `#dfe3ea` circle marker above (RH) or
  below (RL) their candle with the text "Sweep". The protected level is not drawn. Below the FVG table a **Structure**
  table: current direction (Up / Down / Undetermined), protected low / high with distance, then the events (newest
  first) and the sweeps (newest first) with level, date and distance; a short explanation above it and "Structure and
  events as of `structure.asOf`" under it (the range itself is as analysed). No eye toggles on the site.
- **AVWAP** (when `structure.avwap` exists). A near-white `#f2f4f8` 2 px long-dashed curve with an "AVWAP" price-axis
  label, drawn from the report's points on the loaded candles only (the values are the engine's cumulative values
  from the anchor; scrolling left reaches the anchor; the curve ends at `avwap.asOf`). In the Structure table an
  AVWAP row right after the protected level: value, anchor date, distance; the explanation gains one AVWAP sentence.
- **Library links.** A term can be a link to its library page, in the page language (dotted underline):
  `<a class="lib-link" href="<en url>" data-href-tr="<tr url>" aria-label="…" data-label-tr="…">FVG</a>`
  (switched by `applyLanguage`). The FVG heading is one; in the Structure explanation BOS, CHoCH, Sweep and
  AVWAP are links (`structureSub` is rebuilt by `renderStructure`). Pages:

  | Term | EN | TR |
  |---|---|---|
  | FVG | `/en/library/fair-value-gap-fvg/` | `/tr/kutuphane/fvg-fair-value-gap/` |
  | BOS | `/en/library/break-of-structure-bos/` | `/tr/kutuphane/yapi-kirilimi-bos/` |
  | CHoCH | `/en/library/change-of-character-choch/` | `/tr/kutuphane/karakter-degisimi-choch/` |
  | Sweep | `/en/library/sweep/` | `/tr/kutuphane/sweep/` |
  | AVWAP | `/en/library/anchored-vwap-avwap/` | `/tr/kutuphane/avwap-sabitlenmis-vwap/` |
- **No confirmed range** (2026-10-27; report `rangeStatus: "NO_CONFIRMED_RANGE"`, publication contract
  "PA raporunda aralık yok"). The tab stays; an older PA report with empty zones and no `rangeStatus` stays hidden. A notice card above the chart says why there is no range, generated
  from `noRange.failedRules` and `analysisClose` against `noRange.lastValid` (e.g. "At the 27 Oct 06:59 UTC close
  price was below the range low (RL). **The range of the 24 Oct analysis is no longer valid.** Until a new range
  forms, a return to the old band or a new sideways zone can be watched."; the sentence with the date is bold). The
  chart shows the candles and the invalid range faded and dashed, labelled "Invalid range · 24 Oct analysis"; the
  range, FVG and Structure tables are hidden. Without `lastValid` only the card is shown.
- **Link previews.** `method=pa` links get "BTCUSDT 1D price action range · MarketLevelMap" and a Price Action
  description (Turkish with `lang=tr`).

## Live market data

`assets/market-feed.js` feeds the market table and the analysis page. Per symbol it paints the last figures
this browser saw (`assets/market-cache.js`, localStorage), then a snapshot from `/api/prices`
(`functions/api/prices.js`, edge-cached 3 s), then opens a public WebSocket from the browser: Binance
(miniTicker plus 1d/1w/1M klines for the daily, weekly and monthly opens) or, where Binance is blocked
(e.g. the Netherlands, the US — Binance also refuses requests from Cloudflare), Coinbase's `ticker` channel
(USD pair, else USDT). Only if no stream works does it refresh from `/api/prices` every 15 s. In a background
tab the feed closes and resumes on return, unless the page starts it with `background: true` (the scanner). Live updates
never pass through Cloudflare. While Binance is marked unreachable (30 min) pages start on Coinbase but
keep probing Binance and switch back when it answers.

`/api/prices` itself reads Binance's REST API, falling back to Coinbase (`stats` + daily candles for the
opens); it always answers 200 with JSON and lists upstream status codes in `attempts` when it fell back.

The old scrolling price strip is kept in `assets/price-strip.js` / `assets/price-strip.css` but no page loads it.

## Key levels on the analysis chart

Each row of the analysis page's "Key levels" table starts with an eye toggle. A switched-on level is drawn
on the interactive chart as a dashed soft-white (`#d6dbe3`) price line labelled with its code (`DO`, `WO`,
`ATH`…) on the price axis (`LiveChart` `setLevels`). The choice is stored in this browser under
`mlm-chart-levels-v1` (a list of codes) and applies to every asset and timeframe; nothing is shown by
default. `DO`, `WO` and `MO` follow the live feed, so their lines move when a new period opens. Price lines
do not stretch the price scale: a level outside the visible range (often `ATH`) is simply not drawn.

**Where the values come from.** The local program writes `keyLevels` into `candles/<SYMBOL>/levels.json`
with every candle upload (`DO`, `WO`, `PWO`, `MO`, `YO`, `MH`/`MM`/`ML`, `ATH` + `asOf`; `periodStart` per
level, `time` for the ATH). `ATH` is the real all-time high of the candle history. `MH`/`MM`/`ML` are only
written once Monday's candle has closed, so on Mondays the Monday range is not shown. On the current
analysis these values replace the report's (which date from the analysis); the note under the table then
gives the file's `asOf`. `DO`/`WO`/`MO` still prefer the live feed. Archived analyses, and assets whose
file has no `keyLevels` yet, keep the report's levels (the report's `OATH`, the previous ATH, then stands
in for ATH). The market table (YO, ATH, opens as fallback) and the weekly outlook (MO, YO, ATH) read the
same file.

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

The downloaded image also carries this view's tables beside the chart, the same as the admin desk's "PNG with
tables" (`fullImage()`): Price Action → at a glance, price range, FVG, structure; Critical Zones → support and
resistance zones. Titles, column heads and values only. The tables get at least ~440 CSS px, so a phone-sized
chart still yields readable columns. The share sheet's image ("Share with image…") stays the chart alone.

## Chart sharing

The chart header's Share button opens a menu:

- **X (Twitter)** — `x.com/intent/post?text=…&url=…`; **Telegram** — `t.me/share/url?url=…&text=…`. Both share
  the analysis page link `https://marketlevelmap.com/bulletin?asset=<SYMBOL>&tf=<tf>` with a short text
  ("BTCUSDT · 4H · Critical Zones · MarketLevelMap"; "Kritik Bölgeler" on the Turkish page).
- **Copy link** — the same link to the clipboard ("Link copied").
- **Share with image…** (first in the menu) — only where the browser can share files (`navigator.canShare({ files })`, i.e. most
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

`type` is `resistance` or `support` (and `equilibrium` in PA reports); `drawn: false` zones appear only
under "Show all zones", dashed. `method` is `cz`, `cz_short` or `pa`.

PA reports (`method: "pa"`) carry the range as three zones (`resistance` = RH, `equilibrium` = EQ, `support`
= RL; no `formedAt`) and may carry the drawn FVG boxes, at most one per direction:

```json
"fvg": [ { "id": "f1a2b3c4", "direction": "bullish", "low": 78490.79, "high": 79800.05,
           "gapLow": 78490.79, "gapHigh": 80555.54, "filledPercent": 36.6,
           "state": "partially_mitigated", "createdAt": "2026-10-20T08:00:00Z" } ],
"fvgAsOf": "2026-10-26T07:59:59Z"
```

`low`–`high` is the remaining (drawn) gap, `gapLow`–`gapHigh` the original gap. `fvgAsOf` (ISO-8601, present
with `fvg`) is the close of the last candle the fill was computed with.

PA reports may also carry the drawn structure (engine contract "PA raporunda Yapı"):

```json
"structure": { "state": "bearish",
  "protectedLevel": { "price": 82060.88, "kind": "high", "time": "2026-10-23T12:00:00Z" },
  "events": [ { "id": "bos-bearish-202610240400", "type": "BOS", "direction": "bearish", "level": 80939.54,
                "swingTime": "2026-10-22T16:00:00Z", "breakTime": "2026-10-24T04:00:00Z" } ],
  "sweeps": [ { "id": "sweep-rl-202610242200", "band": "RL", "time": "2026-10-24T22:00:00Z", "extreme": 80418.0 } ],
  "avwap": { "value": 81234.5, "anchorTime": "2026-10-23T12:00:00Z", "anchorPrice": 82060.88, "anchorKind": "high",
             "points": [ { "time": "2026-10-23T12:00:00Z", "value": 81990.1 } ], "asOf": "2026-10-26T07:59:59Z" },
  "asOf": "2026-10-26T07:59:59Z" }
```

`state` is `bullish` / `bearish` / `undetermined`; `protectedLevel` may be `null`; `type` is `BOS` or `CHOCH`;
`avwap` is optional (at most 1,000 points, one per candle from the anchor).
Level codes are the engine's Market Reference Levels, in this order: `DO`, `MH`, `MM`, `ML` (Monday
high/mid/low), `WO`, `PWO`, `MO`, `YO`, `OATH` (highest Binance candle; shown as the market table's ATH).
`levelsAsOf` is when they were computed. `DO`, `WO` and `MO` prefer the live exchange feed and fall back
to the report; the other levels are shown with "as of `levelsAsOf`". Without a report the note falls back
to the entry's `analysisComment` text.

**Archive JSON** (engine contract "Arşiv: önceki analizler — V1") — one immutable-history file per market
pair, `site-publication/archive/<marketPair>.json` (e.g. `BTCUSDT.json`), written by the local engine when an
activation replaces a chart's entry. Each item is the replaced pointer entry plus its analysis and live times:

```json
{ "schemaVersion": "marketlevelmap-site-archive-v1", "marketPair": "ETHUSDT",
  "items": [ { "graphicKey": "PA:ETHUSDT:1h", "publicationId": "publication-…", "packageId": "pub-…",
               "sourceReleaseId": "…", "analyzedAt": "2026-10-24T08:59:59Z", "liveFrom": "…", "liveUntil": "…",
               "rangeStatus": "CONFIRMED",
               "report": { "objectKey": "publication-packages/…", "mediaType": "application/json", "sizeBytes": 1, "sha256": "…" } } ] }
```

- `/api/archive?symbol=<marketPair>` returns the items, newest analysis first, without object keys. An item whose
  `publicationId` is in the active pointer is left out, and the same release published more than once (same
  `graphicKey` and `sourceReleaseId`) is one row: its newest publication, `liveFrom` of the first, `liveUntil` of the last.
  Archived objects never change, so they are served with a one-day cache.
- `/api/archive/report/<publicationId>?symbol=<marketPair>` and `/api/archive/image/…` and `/api/archive/comment/…` serve
  only an object listed in that pair's archive file (404 otherwise); `publication-packages/` is never listed.
- Old analysis view: `bulletin.html?asset=<marketPair>&method=<cz|pa>&tf=<tf>&at=<publicationId>` draws the archived
  report on today's candles with an "Archive · <analysis date> · Back to the current analysis" strip; nothing is
  recomputed; only that chart is shown, and sharing it shares the archive link. Not in the sitemap.
- "Earlier analyses" on the analysis page shows the pair's latest items and links to `archive.html`, which lists
  every item by date, method and timeframe.

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

## Social media planner

Admin panel → **Social media** (`admin.html`, `/api/auth/admin/social*`, admin only): this week's publishing flow
and a workspace for the selected post. The week (Monday, UTC): Monday the weekly outlook, Tuesday/Thursday/
Saturday a 1D chart, Wednesday/Friday a 4H chart, Sunday the week's review, plus the library's topic of the
week as an extra Wednesday post (`day` 7). Chart slots rotate through the analysed assets (PAXG left out),
alternating Critical Zones and Price Action, and skip analyses that are not published.

- **Automatic** mode stores the suggested plan the first time a week is opened; **Choose myself** only
  suggests it until saved. In both, changing a post's asset, method or timeframe in the workspace saves the plan.
- **Chart posts** embed the analysis page itself (`bulletin.html?…&embed=1`, no site header or footer), so every
  tool of that page is there; **Save PNG** presses that page's own Download (chart with the chosen indicators
  and key levels). Admins (`ADMIN_EMAILS`) count as members, so every timeframe opens.
- **Monday** embeds the weekly outlook (`weekly.html?embed=1`) and saves its image. **Sunday** lists the week's
  chart posts; each opens as it is now.
- **Library post**: the week's topic (`assets/weekly-topics.json`); its English page gives a 1600×900 image of
  the page's figure and a tweet thread built from the page's own text (title and summary, key points, link),
  each tweet ≤ 280 characters, editable and copyable.
- The desk keeps the plan and each post's status (planned / prepared / posted, saved on change); post text and
  X links are not stored. Nothing is posted to X from the site.
- Tables `social_posts (week, day, kind, symbol, method, timeframe, status, text, x_url, updated_at)` and
  `social_settings (key, value)` in `USERS_DB`, created on first use.

## Accounts

Sign-in with Google, the profile, membership verification, the admin panel and the guest / member split
(steps 1–3 of the membership plan; Telegram comes later).

- **Server:** `functions/api/auth/[[path]].js`: `google/start`, `google/callback`, `me`, `register`, `profile`,
  `delete`, `logout` under `/api/auth/`. Responses are `Cache-Control: no-store` and the service worker never
  caches `/api/auth/*`.
- **Cloudflare settings:** D1 binding `USERS_DB` (database `marketlevelmap-users`); variables `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET` (secret), `SESSION_SECRET` (secret, 64 random hex characters), `ADMIN_EMAILS` (comma
  separated). The tables (`users`, `x_locks`) are created by the code on first use.
- **Google client:** the redirect URI is `<origin>/api/auth/google/callback`, so every origin used (the site and
  the branch preview) must be listed under the client's origins and redirect URIs.
- **Cookies:** `mlm_session` (HttpOnly, HMAC-signed with `SESSION_SECRET`, 30 days) and `mlm_li` (readable hint
  only, so pages ask `/api/auth/me` only when a session exists); `mlm_oauth` and `mlm_signup` are short-lived
  and limited to `/api/auth`.
- **Sign-up:** a new Google user is stored only after accepting the privacy notice on `/account`
  (consent version `2026-11-08` is saved with the account).
- **Profile:** e-mail, name and picture from Google; X username (fixed once approved; saving it sends the account
  for verification); Telegram username (typed by hand); a permanent verification code `MLM-XXXX-XXXX`; status
  `registered` → `pending` → `approved` / `rejected` / `suspended`. A rejected user re-applies by saving the X
  username again with the same code.
- **Deletion:** removes the account; the X username stays reserved for 30 days (`x_locks`).
- **Header:** `assets/account.js` (on every page, library pages included) shows "Sign in" or the profile menu;
  admins also get an "Admin panel" link.
- **Members only** (step 3): only `approved` accounts are members. On `/api/publication/report/…` and
  `/api/archive/report/…` every timeframe but **1D** is cut on the server for everyone else: the response keeps
  only what names the chart (`locked: true`, see `guestReport`); comments and images of those timeframes answer 403.
  Members get the full object with `Cache-Control: private, no-store`; 1D stays public and cacheable. The index
  carries `viewer { member, status }` and per entry `restricted` / `locked`; archive items carry `restricted`. A
  database error keeps the data locked. On a locked timeframe the analysis page shows the candles only (no
  indicators, key levels, volume profile or Fibonacci), a blurred band over the price pane and a side card with
  the call to action (sign in / complete membership / account), locks download and hides share, and marks other
  timeframes "Members only" in "Structure by timeframe" and in the archive lists, where they are not links.
  Visitors who are not members land on Critical Zones 1D when the link names no timeframe; the timeframe
  alignment box is for members. `assets/account.js` fires `mlm-account` once the user is known.
- **Admin panel** (`/admin`, step 2): only for e-mails in `ADMIN_EMAILS`, checked on the server
  (`admin/users`, `admin/action`). Tabs per status with counts; search by code (dashes optional), e-mail, name
  or X / Telegram username. Actions: approve (needs an X username), reject (with a note shown to the user),
  suspend (with a note), reinstate. Approval sends no message: the user is told by X DM by hand.

## Shared assets and browser caches

Pages link the files in `assets/` (`site.css`, `disclaimer.js`, `market-cache.js`, `market-feed.js`,
`market-ui.js`, `demo-data.js`, `sparkline.js`, `features.js`, `live-chart.js`) with a `?v=` content hash (the library
pages get theirs from the build script) so browsers pick up new versions. After editing
one, update its hash in every page that loads it, e.g. `sha1sum assets/site.css | cut -c1-8`.
