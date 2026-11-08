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
    rejectNote: row.status === "rejected" ? row.reject_note || "" : "",
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
async function googleStart(request, env) {
  if (!env.GOOGLE_CLIENT_ID) return json({ error: "not_configured" }, 503);
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
  if (row) return json({ user: publicUser(row, env) });
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

export async function onRequest(context) {
  const { request, env, params } = context;
  const route = (Array.isArray(params.path) ? params.path : [params.path || ""]).join("/");
  try {
    if (request.method === "GET") {
      if (route === "google/start") return await googleStart(request, env);
      if (route === "google/callback") return await googleCallback(request, env);
      if (route === "me") return await me(request, env);
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
    return json({ error: "not_found" }, 404);
  } catch (error) {
    console.error("auth", route, error && error.message);
    return json({ error: "server" }, 500);
  }
}
