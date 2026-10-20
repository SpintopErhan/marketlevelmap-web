// Run from the repository root: node --experimental-detect-module --test workers/chart-data/test/
import test from "node:test";
import assert from "node:assert/strict";
import { runProbe, lastClosed, PAIRS, PRIMARY, FALLBACK, handleFetch, handleScheduled } from "../src/index.js";
import { isPrivatePath, onRequest } from "../../../functions/_middleware.js";

const HOUR = 3600 * 1000;
const NOW = Date.UTC(2026, 9, 19, 13, 2); // 13:02 UTC → last CLOSED 1H candle opened 12:00

function kline(openMs) {
  return [openMs, "1", "2", "0.5", "1.5", "10", openMs + HOUR - 1];
}

function fakeFetch({ primaryStatus = 200, fallbackStatus = 451, includeOpen = true } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (url.includes("cdn-cgi/trace")) return new Response("fl=1\ncolo=FRA\nloc=TR\n");
    const status = url.startsWith(PRIMARY) ? primaryStatus : fallbackStatus;
    if (status !== 200) return new Response('{"code":0,"msg":"restricted location"}', { status });
    const base = Date.UTC(2026, 9, 19, 10);
    const rows = [kline(base), kline(base + HOUR), kline(base + 2 * HOUR)];
    if (includeOpen) rows.push(kline(base + 3 * HOUR)); // 13:00 candle, still open at 13:02
    return new Response(JSON.stringify(rows));
  };
  return { impl, calls };
}

test("open candles are never treated as closed", () => {
  const base = Date.UTC(2026, 9, 19, 12);
  assert.equal(lastClosed([kline(base), kline(base + HOUR)], NOW)[0], base);
});

test("healthy run reports ok with fresh closed candles and the datacenter", async () => {
  const { impl, calls } = fakeFetch();
  const report = await runProbe(impl, NOW);
  assert.equal(report.ok, true);
  assert.equal(report.colo, "FRA");
  assert.equal(report.primary.length, PAIRS.length);
  for (const row of report.primary) {
    assert.equal(row.status, 200);
    assert.equal(row.lastClosedOpen, "2026-10-19T12:00:00.000Z");
    assert.equal(row.fresh, true);
  }
  assert.equal(report.fallback.status, 451);
  assert.equal(report.fallback.base, FALLBACK);
  assert.ok(calls.length <= 10, "stays far below the 50 subrequest limit");
});

test("restricted primary endpoint makes the run not ok and keeps the reason", async () => {
  const { impl } = fakeFetch({ primaryStatus: 451 });
  const report = await runProbe(impl, NOW);
  assert.equal(report.ok, false);
  assert.match(report.primary[0].body, /restricted/);
});

test("stale data (no new closed candle) is reported as not fresh", async () => {
  const { impl } = fakeFetch();
  const report = await runProbe(impl, NOW + 2 * HOUR);
  assert.equal(report.ok, false);
  assert.equal(report.primary[0].fresh, false);
});

test("network failure is recorded instead of throwing", async () => {
  const report = await runProbe(async () => { throw new Error("boom"); }, NOW);
  assert.equal(report.ok, false);
  assert.equal(report.primary[0].status, 0);
  assert.equal(report.primary[0].error, "boom");
});

test("site middleware hides worker sources", async () => {
  for (const path of ["/workers", "/workers/", "/workers/chart-data/wrangler.toml", "/Workers/x", "//workers/x", "/%77orkers/x"]) {
    assert.equal(isPrivatePath(path), true, path);
  }
  for (const path of ["/", "/bulletin", "/assets/workers.svg", "/workersx", "/api/publication"]) {
    assert.equal(isPrivatePath(path), false, path);
  }
  let nextCalled = false;
  const response = await onRequest({
    request: new Request("https://marketlevelmap.com/workers/chart-data/src/index.js"),
    next: async () => { nextCalled = true; return new Response("source"); },
    env: {},
  });
  assert.equal(response.status, 404);
  assert.equal(nextCalled, false);
});

test("fetch endpoint answers 404 without the exact secret token", async () => {
  const { impl, calls } = fakeFetch();
  for (const headers of [{}, { "x-probe-token": "wrong" }]) {
    const response = await handleFetch(new Request("https://w/probe", { headers }), { PROBE_TOKEN: "s3cret" }, impl, () => NOW);
    assert.equal(response.status, 404);
  }
  const noSecret = await handleFetch(new Request("https://w/probe", { headers: { "x-probe-token": "" } }), {}, impl, () => NOW);
  assert.equal(noSecret.status, 404);
  assert.equal(calls.length, 0, "no Binance request without authorization");
  const ok = await handleFetch(new Request("https://w/probe", { headers: { "x-probe-token": "s3cret" } }), { PROBE_TOKEN: "s3cret" }, impl, () => NOW);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.path, "manual");
});

test("cron probes directly and through its own fetch handler", async () => {
  const { impl } = fakeFetch();
  const env = {
    PROBE_TOKEN: "s3cret",
    SELF: { fetch: (url, init) => handleFetch(new Request(url, init), env, fakeFetch({ primaryStatus: 451 }).impl, () => NOW) },
  };
  const line = await handleScheduled(NOW, env, impl);
  assert.equal(line.probe, "placement-test-v1");
  assert.deepEqual(line.direct.statuses, [200, 200, 200, 200, 200]);
  assert.equal(line.direct.ok, true);
  assert.equal(line.viaFetch.ok, false);
  assert.deepEqual(line.viaFetch.statuses, [451, 451, 451, 451, 451]);
  const withoutSelf = await handleScheduled(NOW, { PROBE_TOKEN: "x" }, impl);
  assert.equal(withoutSelf.viaFetch, null);
});
