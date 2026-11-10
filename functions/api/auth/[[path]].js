// Accounts (README "Accounts"): Google sign-in, the session cookie, sign-up with privacy consent, the profile
// (X and Telegram usernames, verification code, status) and account deletion. One file so the session code
// is not shared across routes.
//
// Routes (all under /api/auth/):
//   GET  google/start?return=/path   → Google consent screen
//   GET  google/callback             → back from Google; existing users get a session, new users go to sign-up
//   GET  me                          → the signed-in user (or { user: null }); also tells whether a sign-up is waiting
//   POST register   { consent: true }               → creates the account after the privacy consent
//   POST profile    { xHandle, telegramHandle }     → saves the usernames
//   POST delete                                     → deletes the account (the X username stays locked 30 days)
//   POST logout
//   GET  admin/users?status=pending&q=…            → admin only: accounts with counts per status
//   POST admin/action { id, action, note }          → admin only: approve | reject | suspend | reinstate
//   GET  admin/social?week=YYYY-MM-DD               → admin only: the week's social media plan (README "Social media planner")
//   POST admin/social/plan { week, posts }          → admin only: save the plan's assets
//   POST admin/social/post { week, day, status, text, xUrl } → admin only: draft text, status, link to the X post
//   POST admin/social/settings { mode }             → admin only: "auto" | "manual"
//
// Bindings and variables (Cloudflare Pages settings): USERS_DB (D1), GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
// SESSION_SECRET, ADMIN_EMAILS (comma separated). Secrets are never sent to the browser.

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const SESSION_DAYS = 30;
const X_LOCK_DAYS = 30;
const CONSENT_VERSION = "2026-11-08";
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L
const COOKIE = { session: "mlm_session", hint: "mlm_li", oauth: "mlm_oauth", signup: "mlm_signup" };
// registered: no X username yet · pending: X username given, waiting for the admin · approved · rejected · suspended
const STATUSES = ["registered", "pending", "approved", "rejected", "suspended"];

// ---------- small helpers ----------
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (text) => b64url(enc.encode(text));
const fromB64url = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
const now = () => Math.floor(Date.now() / 1000);
const iso = (seconds) => new Date(seconds * 1000).toISOString();

function json(body, status = 200, headers = {}) {
  const h = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  for (const [k, v] of Object.entries(headers)) Array.isArray(v) ? v.forEach((x) => h.append(k, x)) : h.set(k, v);
  return new Response(JSON.stringify(body), { status, headers: h });
}
function redirect(location, cookies = []) {
  const h = new Headers({ Location: location, "Cache-Control": "no-store" });
  cookies.forEach((c) => h.append("Set-Cookie", c));
  return new Response(null, { status: 302, headers: h });
}
function cookie(name, value, { maxAge, path = "/", httpOnly = true } = {}) {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; Secure; SameSite=Lax${httpOnly ? "; HttpOnly" : ""}`;
}
const clear = (name, path = "/", httpOnly = true) => cookie(name, "", { maxAge: 0, path, httpOnly });
function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(/;\s*/)) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1); }
  return null;
}
// Where to go after signing in: only paths on this site.
function safeReturn(value) {
  const v = String(value || "/");
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") && !v.startsWith("/api/") ? v.slice(0, 500) : "/";
}

// ---------- signed tokens (HMAC-SHA256 with SESSION_SECRET) ----------
async function hmacKey(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET is missing or too short");
  return crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function sign(env, payload) {
  const body = b64urlText(JSON.stringify(payload));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(body));
  return `${body}.${b64url(mac)}`;
}
async function verify(env, token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [body, mac] = token.split(".");
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", await hmacKey(env), fromB64url(mac), enc.encode(body)); } catch (_) { return null; }
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return payload && payload.exp > now() ? payload : null;
  } catch (_) { return null; }
}

// ---------- database ----------
let schemaReady = false;
async function db(env) {
  const d = env.USERS_DB;
  if (!d) throw new Error("USERS_DB binding is missing");
  if (!schemaReady) {
    await d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_sub TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        name TEXT,
        picture TEXT,
        x_handle TEXT,
        x_handle_lc TEXT UNIQUE,
        telegram_handle TEXT,
        code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'registered',
        reject_note TEXT,
        consent_version TEXT NOT NULL,
        consent_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        approved_at TEXT
      )`),
      d.prepare(`CREATE TABLE IF NOT EXISTS x_locks (x_handle_lc TEXT PRIMARY KEY, until TEXT NOT NULL)`),
    ]);
    schemaReady = true;
  }
  return d;
}
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `MLM-${chars.slice(0, 4)}-${chars.slice(4)}`;
}
const adminEmails = (env) => String(env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
function publicUser(row, env) {
  return {
    email: row.email, name: row.name || "", picture: row.picture || "",
    xHandle: row.x_handle || "", telegramHandle: row.telegram_handle || "",
    code: row.code, status: STATUSES.includes(row.status) ? row.status : "registered",
    rejectNote: row.status === "rejected" || row.status === "suspended" ? row.reject_note || "" : "",
    xLocked: row.status === "approved" || row.status === "suspended",
    createdAt: row.created_at, consentVersion: row.consent_version,
    isAdmin: adminEmails(env).includes(String(row.email).toLowerCase()),
  };
}
async function sessionUser(request, env) {
  const session = await verify(env, readCookie(request, COOKIE.session));
  if (!session || !session.uid) return null;
  return (await db(env)).prepare("SELECT * FROM users WHERE id = ? AND google_sub = ?").bind(session.uid, session.sub).first();
}
async function sessionCookies(env, user) {
  const maxAge = SESSION_DAYS * 86400;
  const token = await sign(env, { uid: user.id, sub: user.google_sub, exp: now() + maxAge });
  return [cookie(COOKIE.session, token, { maxAge }), cookie(COOKIE.hint, "1", { maxAge, httpOnly: false })];
}

// ---------- routes ----------
// Which Cloudflare settings this deployment cannot see (names only, never values), for the setup check.
function missingSettings(env) {
  return ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET", "USERS_DB"].filter((name) => !env[name])
    .concat(env.SESSION_SECRET && String(env.SESSION_SECRET).length < 32 ? ["SESSION_SECRET (too short)"] : []);
}

async function googleStart(request, env) {
  const missing = missingSettings(env);
  if (missing.length) return json({ error: "not_configured", missing }, 503);
  const url = new URL(request.url);
  const state = b64url(crypto.getRandomValues(new Uint8Array(18)));
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(18)));
  const oauth = await sign(env, { state, nonce, ret: safeReturn(url.searchParams.get("return")), exp: now() + 600 });
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${url.origin}/api/auth/google/callback`, response_type: "code",
    scope: "openid email profile", state, nonce, prompt: "select_account",
  });
  return redirect(`${GOOGLE_AUTH}?${params}`, [cookie(COOKIE.oauth, oauth, { maxAge: 600, path: "/api/auth" })]);
}

async function googleCallback(request, env) {
  const url = new URL(request.url);
  const oauth = await verify(env, readCookie(request, COOKIE.oauth));
  const fail = (reason) => redirect(`/account?error=${reason}`, [clear(COOKIE.oauth, "/api/auth")]);
  if (!oauth || url.searchParams.get("state") !== oauth.state) return fail("state");
  if (url.searchParams.get("error")) return fail("cancelled");
  const code = url.searchParams.get("code");
  if (!code) return fail("code");

  const tokenResponse = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/auth/google/callback`, grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) return fail("token");
  const tokens = await tokenResponse.json();
  // The ID token comes straight from Google's token endpoint over TLS in exchange for our client secret, so
  // its claims are checked rather than its signature (OpenID Connect Core 3.1.3.7).
  let claims = null;
  try { claims = JSON.parse(new TextDecoder().decode(fromB64url(String(tokens.id_token || "").split(".")[1] || ""))); } catch (_) { claims = null; }
  if (!claims || !GOOGLE_ISSUERS.includes(claims.iss) || claims.aud !== env.GOOGLE_CLIENT_ID || !(claims.exp > now())
      || claims.nonce !== oauth.nonce || !claims.sub || !claims.email || claims.email_verified !== true) return fail("token");

  const d = await db(env);
  const user = await d.prepare("SELECT * FROM users WHERE google_sub = ?").bind(claims.sub).first();
  const done = [clear(COOKIE.oauth, "/api/auth")];
  if (user) {
    // Keep the profile picture and name in step with Google.
    await d.prepare("UPDATE users SET email = ?, name = ?, picture = ?, updated_at = ? WHERE id = ?")
      .bind(claims.email, claims.name || "", claims.picture || "", iso(now()), user.id).run();
    return redirect(oauth.ret, done.concat(await sessionCookies(env, user)));
  }
  // New user: nothing is stored until the privacy consent on the account page.
  const ticket = await sign(env, { sub: claims.sub, email: claims.email, name: claims.name || "", picture: claims.picture || "", ret: oauth.ret, exp: now() + 1800 });
  return redirect("/account?signup=1", done.concat([cookie(COOKIE.signup, ticket, { maxAge: 1800, path: "/api/auth" })]));
}

async function me(request, env) {
  const row = await sessionUser(request, env);
  if (row) {
    const user = publicUser(row, env);
    // Admins: how many applications wait for a decision (the badge on the account button).
    if (user.isAdmin) {
      try { user.pendingCount = Number(((await (await db(env)).prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'").first()) || {}).n) || 0; } catch (_) { user.pendingCount = 0; }
    }
    return json({ user });
  }
  const signup = await verify(env, readCookie(request, COOKIE.signup));
  const headers = readCookie(request, COOKIE.hint) ? { "Set-Cookie": [clear(COOKIE.hint, "/", false), clear(COOKIE.session)] } : {};
  return json({ user: null, signup: signup ? { email: signup.email, name: signup.name, picture: signup.picture } : null }, 200, headers);
}

async function register(request, env, body) {
  const signup = await verify(env, readCookie(request, COOKIE.signup));
  if (!signup) return json({ error: "no_signup" }, 400);
  if (body.consent !== true) return json({ error: "consent_required" }, 400);
  const d = await db(env);
  let user = await d.prepare("SELECT * FROM users WHERE google_sub = ?").bind(signup.sub).first();
  if (!user) {
    const at = iso(now());
    for (let attempt = 0; attempt < 5 && !user; attempt++) {
      try {
        await d.prepare(`INSERT INTO users (google_sub, email, name, picture, code, status, consent_version, consent_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'registered', ?, ?, ?, ?)`)
          .bind(signup.sub, signup.email, signup.name, signup.picture, newCode(), CONSENT_VERSION, at, at, at).run();
      } catch (e) { if (!/UNIQUE/i.test(String(e && e.message))) throw e; }
      user = await d.prepare("SELECT * FROM users WHERE google_sub = ?").bind(signup.sub).first();
    }
    if (!user) return json({ error: "code_collision" }, 500);
  }
  return json({ user: publicUser(user, env), returnTo: signup.ret || "/" }, 200,
    { "Set-Cookie": [clear(COOKIE.signup, "/api/auth")].concat(await sessionCookies(env, user)) });
}

const X_RE = /^@?([A-Za-z0-9_]{1,15})$/;
const TG_RE = /^@?([A-Za-z0-9_]{5,32})$/;
async function profile(request, env, body) {
  const row = await sessionUser(request, env);
  if (!row) return json({ error: "signed_out" }, 401);
  const d = await db(env);
  const at = iso(now());
  // Telegram: free to change (entered by hand for now; verified later).
  let telegram = row.telegram_handle || "";
  if (body.telegramHandle !== undefined) {
    const t = String(body.telegramHandle || "").trim();
    if (t && !TG_RE.test(t)) return json({ error: "telegram_invalid" }, 400);
    telegram = t ? "@" + t.match(TG_RE)[1] : "";
  }
  // X: fixed once approved; otherwise saving it sends the account for verification.
  let x = row.x_handle || "", xlc = row.x_handle_lc || null, status = row.status;
  if (body.xHandle !== undefined) {
    const raw = String(body.xHandle || "").trim();
    const wanted = raw ? "@" + (raw.match(X_RE) || [])[1] : "";
    if (raw && !X_RE.test(raw)) return json({ error: "x_invalid" }, 400);
    if (wanted.toLowerCase() !== String(x).toLowerCase()) {
      if (row.status === "approved" || row.status === "suspended") return json({ error: "x_locked" }, 409);
      if (wanted) {
        const lc = wanted.toLowerCase();
        const lock = await d.prepare("SELECT until FROM x_locks WHERE x_handle_lc = ?").bind(lc).first();
        if (lock && lock.until > at) return json({ error: "x_taken" }, 409);
        const other = await d.prepare("SELECT id FROM users WHERE x_handle_lc = ? AND id != ?").bind(lc, row.id).first();
        if (other) return json({ error: "x_taken" }, 409);
        x = wanted; xlc = lc; status = "pending";
      } else { x = ""; xlc = null; status = "registered"; }
    } else if (row.status === "rejected" && x) status = "pending"; // apply again with the same username and code
  }
  try {
    await d.prepare("UPDATE users SET x_handle = ?, x_handle_lc = ?, telegram_handle = ?, status = ?, reject_note = CASE WHEN ? = 'pending' THEN NULL ELSE reject_note END, updated_at = ? WHERE id = ?")
      .bind(x || null, xlc, telegram || null, status, status, at, row.id).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) return json({ error: "x_taken" }, 409);
    throw e;
  }
  return json({ user: publicUser(await d.prepare("SELECT * FROM users WHERE id = ?").bind(row.id).first(), env) });
}

async function remove(request, env) {
  const row = await sessionUser(request, env);
  if (!row) return json({ error: "signed_out" }, 401);
  const d = await db(env);
  const statements = [d.prepare("DELETE FROM users WHERE id = ?").bind(row.id)];
  if (row.x_handle_lc) statements.push(d.prepare("INSERT OR REPLACE INTO x_locks (x_handle_lc, until) VALUES (?, ?)").bind(row.x_handle_lc, iso(now() + X_LOCK_DAYS * 86400)));
  await d.batch(statements);
  return json({ ok: true }, 200, { "Set-Cookie": [clear(COOKIE.session), clear(COOKIE.hint, "/", false)] });
}

// ---------- membership, for other routes (README "Accounts": guest / member split) ----------
// Who is asking: { member, status }. Only "approved" accounts are members. Without a session cookie nothing is
// read from the database, so guests cost no D1 reads.
export async function viewerAccess(request, env) {
  if (!readCookie(request, COOKIE.session)) return { member: false, status: "guest" };
  try {
    const row = await sessionUser(request, env);
    if (!row) return { member: false, status: "guest" };
    // Admins (ADMIN_EMAILS) see every timeframe too: the social media desk opens any analysis.
    const admin = adminEmails(env).includes(String(row.email).toLowerCase());
    return { member: row.status === "approved" || admin, status: row.status, admin };
  } catch (_) {
    return { member: false, status: "guest" }; // a database problem must never open members-only data
  }
}

// The timeframe open to guests; every other timeframe needs an approved membership.
export const OPEN_TIMEFRAME = "1d";
export function timeframeOfKey(graphicKey) { return String(graphicKey || "").split(":")[2]?.toLowerCase() || ""; }
export function isOpenEntry(item) { return timeframeOfKey(item && item.graphicKey) === OPEN_TIMEFRAME; }
// What a guest receives instead of a members-only report: only what names the chart, and locked: true.
// Zones, range, FVG, structure, key levels, note and the no-range card are left out on the server.
export function guestReport(report) {
  const r = report && typeof report === "object" ? report : {};
  const out = { locked: true };
  ["symbol", "timeframe", "method", "analyzedAt", "schemaVersion"].forEach((k) => { if (r[k] !== undefined) out[k] = r[k]; });
  return out;
}

// ---------- admin (ADMIN_EMAILS only) ----------
async function adminUser(request, env) {
  const row = await sessionUser(request, env);
  return row && adminEmails(env).includes(String(row.email).toLowerCase()) ? row : null;
}
function adminRow(row) {
  return {
    id: row.id, email: row.email, name: row.name || "", picture: row.picture || "",
    xHandle: row.x_handle || "", telegramHandle: row.telegram_handle || "", code: row.code,
    status: row.status, note: row.reject_note || "", createdAt: row.created_at, updatedAt: row.updated_at, approvedAt: row.approved_at || "",
  };
}
async function adminUsers(request, env) {
  if (!(await adminUser(request, env))) return json({ error: "forbidden" }, 403);
  const url = new URL(request.url), d = await db(env);
  const status = url.searchParams.get("status") || "pending";
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 80);
  const where = [], args = [];
  if (STATUSES.includes(status)) { where.push("status = ?"); args.push(status); }
  if (q) {
    // A code from a DM may come without dashes or in lower case.
    const bare = q.replace(/[^a-z0-9]/g, "");
    where.push("(lower(email) LIKE ? OR x_handle_lc LIKE ? OR lower(name) LIKE ? OR lower(replace(code, '-', '')) LIKE ? OR lower(telegram_handle) LIKE ?)");
    args.push(`%${q}%`, `%${q.replace(/^@?/, "@")}%`, `%${q}%`, `%${bare}%`, `%${q}%`);
  }
  const sql = `SELECT * FROM users${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT 200`;
  const rows = (await d.prepare(sql).bind(...args).all()).results || [];
  const counts = Object.fromEntries(STATUSES.map((st) => [st, 0]));
  ((await d.prepare("SELECT status, COUNT(*) AS n FROM users GROUP BY status").all()).results || []).forEach((r) => { counts[r.status] = r.n; });
  return json({ users: rows.map(adminRow), counts });
}
// Which status each action leads to, and from which statuses it is allowed.
const ACTIONS = {
  approve: { to: "approved", from: ["pending", "rejected", "registered"] },
  reject: { to: "rejected", from: ["pending", "registered", "approved"] },
  suspend: { to: "suspended", from: ["approved", "pending"] },
  reinstate: { to: "approved", from: ["suspended"] },
};
async function adminAction(request, env, body) {
  if (!(await adminUser(request, env))) return json({ error: "forbidden" }, 403);
  const action = ACTIONS[body.action];
  if (!action) return json({ error: "action" }, 400);
  const d = await db(env);
  const row = await d.prepare("SELECT * FROM users WHERE id = ?").bind(Number(body.id) || 0).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (!action.from.includes(row.status)) return json({ error: "status", status: row.status }, 409);
  if (body.action === "approve" && !row.x_handle) return json({ error: "no_x" }, 409);
  const at = iso(now());
  const note = body.action === "reject" || body.action === "suspend" ? String(body.note || "").trim().slice(0, 300) || null : null;
  await d.prepare("UPDATE users SET status = ?, reject_note = ?, approved_at = CASE WHEN ? = 'approved' THEN COALESCE(approved_at, ?) ELSE approved_at END, updated_at = ? WHERE id = ?")
    .bind(action.to, note, action.to, at, at, row.id).run();
  return json({ user: adminRow(await d.prepare("SELECT * FROM users WHERE id = ?").bind(row.id).first()) });
}

// ---------- social media planner (admin only; README "Social media planner") ----------
// One plan per week (Monday, UTC): Mon weekly outlook · Tue/Thu/Sat a 1D chart · Wed/Fri a 4H chart · Sun the
// week's review, plus the library's topic of the week as an extra Wednesday post. Mode "auto" stores the suggested plan the first time a week is opened; mode "manual" only
// suggests it until the admin saves their own choice. The admin writes the post text; nothing is posted to X.
const SOCIAL_DAYS = [
  { kind: "weekly" }, { kind: "chart", tf: "1d" }, { kind: "chart", tf: "4h" }, { kind: "chart", tf: "1d" },
  { kind: "chart", tf: "4h" }, { kind: "chart", tf: "1d" }, { kind: "review" },
  { kind: "library", on: 2 }, // extra post on Wednesday: the library's topic of the week
];
const PLAN_DAYS = 7; // days 0–6 form the plan; the library post (day 7) is always there
const SOCIAL_STATUSES = ["planned", "prepared", "posted"];
const SOCIAL_LEFT_OUT = new Set(["PAXGUSDT"]);
const POPULAR = ["BTC", "ETH", "SOL", "XRP", "BNB", "AVAX", "DOGE", "ADA", "LINK", "DOT", "LTC", "TRX"];
const byPopularity = (a, b) => {
  const i = POPULAR.indexOf(a.replace(/USDT$/, "")), j = POPULAR.indexOf(b.replace(/USDT$/, ""));
  return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.localeCompare(b);
};
let socialReady = false;
async function socialDb(env) {
  const d = await db(env);
  if (!socialReady) {
    await d.batch([
      d.prepare(`CREATE TABLE IF NOT EXISTS social_posts (
        week TEXT NOT NULL, day INTEGER NOT NULL, kind TEXT NOT NULL, symbol TEXT, method TEXT, timeframe TEXT,
        status TEXT NOT NULL DEFAULT 'planned', text TEXT, x_url TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (week, day))`),
      d.prepare(`CREATE TABLE IF NOT EXISTS social_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`),
    ]);
    socialReady = true;
  }
  return d;
}
// Monday (YYYY-MM-DD) of the week that holds `day` (YYYY-MM-DD or now).
export function mondayOf(day) {
  const t = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(day + "T00:00:00Z") : Date.now();
  if (Number.isNaN(t)) return null;
  const d = new Date(t), dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(dayStart - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
}
// Active analyses by asset: { BTCUSDT: { cz: { "1d": entry, … }, pa: { … } } } (PAXG left out).
async function activeByAsset(env) {
  const bucket = env.MARKETLEVELMAP_PUBLIC;
  let active = null;
  try { const o = bucket && (await bucket.get("site-publication/active.json")); active = o ? await o.json() : null; } catch (_) { active = null; }
  const out = {};
  for (const e of (active && Array.isArray(active.entries) ? active.entries : [])) {
    const [source, symbol, tf] = String(e && e.graphicKey || "").split(":");
    const method = String(source || "").toLowerCase();
    if (!/^[A-Z0-9]{2,20}$/.test(symbol || "") || SOCIAL_LEFT_OUT.has(symbol) || !["cz", "pa"].includes(method) || !e.report || !e.report.objectKey) continue;
    ((out[symbol] ||= { cz: {}, pa: {} })[method])[String(tf).toLowerCase()] = e;
  }
  return out;
}
// The suggested plan: assets rotate week by week (five chart slots, each a different asset when there are five or
// more), Critical Zones and Price Action alternate; a slot falls back to the other method, then the next asset,
// when that analysis is not published.
export function suggestPlan(week, byAsset) {
  const assets = Object.keys(byAsset).sort(byPopularity), n = assets.length;
  const k = Math.round((Date.parse(week + "T00:00:00Z") - Date.parse("2026-01-05T00:00:00Z")) / (7 * 86400000));
  let slot = 0;
  return SOCIAL_DAYS.slice(0, PLAN_DAYS).map((d, day) => {
    if (d.kind !== "chart" || !n) return { day, kind: d.kind, symbol: null, method: null, timeframe: null };
    const i = slot++;
    for (let step = 0; step < n; step++) {
      const symbol = assets[(((k * 5 + i + step) % n) + n) % n];
      const first = (((k + i) % 2) + 2) % 2 === 0 ? "cz" : "pa";
      for (const method of [first, first === "cz" ? "pa" : "cz"]) if (byAsset[symbol][method][d.tf]) return { day, kind: "chart", symbol, method, timeframe: d.tf };
    }
    return { day, kind: "chart", symbol: null, method: null, timeframe: d.tf };
  });
}
const socialRow = (r) => ({ day: r.day, kind: r.kind, symbol: r.symbol || null, method: r.method || null, timeframe: r.timeframe || null,
  status: SOCIAL_STATUSES.includes(r.status) ? r.status : "planned", text: r.text || "", xUrl: r.x_url || "" });
async function socialMode(d) {
  const row = await d.prepare("SELECT value FROM social_settings WHERE key = 'mode'").first();
  return row && row.value === "manual" ? "manual" : "auto";
}
async function adminSocial(request, env) {
  if (!(await adminUser(request, env))) return json({ error: "forbidden" }, 403);
  const week = mondayOf(new URL(request.url).searchParams.get("week"));
  if (!week) return json({ error: "week" }, 400);
  const d = await socialDb(env), mode = await socialMode(d), byAsset = await activeByAsset(env);
  let rows = ((await d.prepare("SELECT * FROM social_posts WHERE week = ? ORDER BY day").bind(week).all()).results || []).map(socialRow);
  if (!rows.some((r) => r.day === 7)) {
    await d.prepare("INSERT OR IGNORE INTO social_posts (week, day, kind, status, updated_at) VALUES (?, 7, 'library', 'planned', ?)").bind(week, iso(now())).run();
    rows.push({ day: 7, kind: "library", symbol: null, method: null, timeframe: null, status: "planned", text: "", xUrl: "" });
  }
  let saved = rows.filter((r) => r.day < PLAN_DAYS).length === PLAN_DAYS;
  if (!saved) {
    const plan = suggestPlan(week, byAsset), at = iso(now());
    const have = Object.fromEntries(rows.map((r) => [r.day, r]));
    rows = plan.map((p) => have[p.day] || { ...p, status: "planned", text: "", xUrl: "" }).concat(rows.filter((r) => r.day >= PLAN_DAYS));
    if (mode === "auto") {
      await d.batch(rows.filter((r) => !have[r.day]).map((r) => d.prepare("INSERT OR IGNORE INTO social_posts (week, day, kind, symbol, method, timeframe, status, updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(week, r.day, r.kind, r.symbol, r.method, r.timeframe, "planned", at)));
      saved = true;
    }
  }
  const posts = rows.sort((a, b) => a.day - b.day);
  const assets = Object.keys(byAsset).sort(byPopularity).map((s) => ({ symbol: s, cz: Object.keys(byAsset[s].cz), pa: Object.keys(byAsset[s].pa) }));
  return json({ week, mode, saved, posts, assets });
}
async function adminSocialPlan(request, env, body) {
  if (!(await adminUser(request, env))) return json({ error: "forbidden" }, 403);
  const week = mondayOf(body.week);
  if (!week || body.week !== week || !Array.isArray(body.posts)) return json({ error: "week" }, 400);
  const d = await socialDb(env), at = iso(now()), statements = [];
  for (const p of body.posts) {
    const day = Number(p && p.day);
    if (!Number.isInteger(day) || day < 0 || day >= PLAN_DAYS) return json({ error: "day" }, 400);
    const kind = SOCIAL_DAYS[day].kind;
    let symbol = null, method = null, timeframe = null;
    if (kind === "chart") {
      symbol = String(p.symbol || "").toUpperCase(); method = String(p.method || ""); timeframe = String(p.timeframe || "");
      if (!/^[A-Z0-9]{2,20}$/.test(symbol) || !["cz", "pa"].includes(method) || !["1h", "4h", "1d", "1w"].includes(timeframe)) return json({ error: "post" }, 400);
    }
    statements.push(d.prepare(`INSERT INTO social_posts (week, day, kind, symbol, method, timeframe, status, updated_at) VALUES (?,?,?,?,?,?, 'planned', ?)
      ON CONFLICT (week, day) DO UPDATE SET symbol = excluded.symbol, method = excluded.method, timeframe = excluded.timeframe, updated_at = excluded.updated_at`)
      .bind(week, day, kind, symbol, method, timeframe, at));
  }
  if (statements.length) await d.batch(statements);
  return json({ ok: true });
}
async function adminSocialPost(request, env, body) {
  if (!(await adminUser(request, env))) return json({ error: "forbidden" }, 403);
  const week = mondayOf(body.week), day = Number(body.day);
  if (!week || body.week !== week || !Number.isInteger(day) || day < 0 || day >= SOCIAL_DAYS.length) return json({ error: "post" }, 400);
  const status = SOCIAL_STATUSES.includes(body.status) ? body.status : "planned";
  const text = String(body.text || "").slice(0, 2000);
  const xUrl = String(body.xUrl || "").trim();
  if (xUrl && !/^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+/.test(xUrl)) return json({ error: "x_url" }, 400);
  const d = await socialDb(env);
  const res = await d.prepare("UPDATE social_posts SET status = ?, text = ?, x_url = ?, updated_at = ? WHERE week = ? AND day = ?")
    .bind(status, text, xUrl || null, iso(now()), week, day).run();
  if (!res || !res.meta || !res.meta.changes) return json({ error: "not_saved" }, 409);
  return json({ ok: true });
}
async function adminSocialSettings(request, env, body) {
  if (!(await adminUser(request, env))) return json({ error: "forbidden" }, 403);
  const mode = body.mode === "manual" ? "manual" : body.mode === "auto" ? "auto" : null;
  if (!mode) return json({ error: "mode" }, 400);
  const d = await socialDb(env);
  await d.prepare("INSERT INTO social_settings (key, value) VALUES ('mode', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(mode).run();
  return json({ ok: true, mode });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const route = (Array.isArray(params.path) ? params.path : [params.path || ""]).join("/");
  try {
    if (request.method === "GET") {
      if (route === "google/start") return await googleStart(request, env);
      if (route === "google/callback") return await googleCallback(request, env);
      if (route === "me") return await me(request, env);
      if (route === "admin/users") return await adminUsers(request, env);
      if (route === "admin/social") return await adminSocial(request, env);
      return json({ error: "not_found" }, 404);
    }
    if (request.method !== "POST") return json({ error: "method" }, 405);
    // Same-origin writes only (the cookies are SameSite=Lax as well).
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) return json({ error: "origin" }, 403);
    if (route === "logout") return json({ ok: true }, 200, { "Set-Cookie": [clear(COOKIE.session), clear(COOKIE.hint, "/", false)] });
    let body = {};
    try { body = (await request.json()) || {}; } catch (_) { body = {}; }
    if (route === "register") return await register(request, env, body);
    if (route === "profile") return await profile(request, env, body);
    if (route === "delete") return await remove(request, env);
    if (route === "admin/action") return await adminAction(request, env, body);
    if (route === "admin/social/plan") return await adminSocialPlan(request, env, body);
    if (route === "admin/social/post") return await adminSocialPost(request, env, body);
    if (route === "admin/social/settings") return await adminSocialSettings(request, env, body);
    return json({ error: "not_found" }, 404);
  } catch (error) {
    console.error("auth", route, error && error.message);
    return json({ error: "server" }, 500);
  }
}
