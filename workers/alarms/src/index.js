// Alarm Worker (README "Alarms"): every minute, checks the members' active alarms against OKX prices and closed
// candles and sends a web push to the member's devices for each alarm that fired. Same D1 database as the site
// (binding USERS_DB). Settings (Cloudflare → this Worker → Settings → Variables and secrets):
//   VAPID_PUBLIC_KEY (text), VAPID_PRIVATE_KEY (secret), VAPID_SUBJECT (text, e.g. mailto:contact address).
import { SCHEMA, runAlarms } from "./alarms.js";
import { sendPush } from "./webpush.js";

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  schemaReady = true;
}
function vapidOf(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

export default {
  async scheduled(event, env, ctx) {
    const vapid = vapidOf(env);
    if (!env.USERS_DB || !vapid) { console.error("alarms: missing", !env.USERS_DB ? "USERS_DB" : "VAPID settings"); return; }
    await ensureSchema(env.USERS_DB);
    const summary = await runAlarms(env.USERS_DB, vapid, sendPush);
    if (summary.fired) console.log("alarms", JSON.stringify(summary));
  },
  // No public endpoint: only a health line (which settings are present, never their values).
  async fetch(request, env) {
    const missing = ["USERS_DB", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"].filter((k) => !env[k]);
    return new Response(JSON.stringify({ ok: !missing.length, missing }), { headers: { "Content-Type": "application/json" } });
  },
};
