// Web Push (README "Alarms") with the Web Crypto API only, so it runs on Cloudflare (Pages Functions and Workers).
// - VAPID (RFC 8292): an ES256-signed JWT for the push service of the subscription's endpoint.
// - Payload encryption (RFC 8291, "aes128gcm" content coding, RFC 8188): ECDH with the browser's key, HKDF, AES-GCM.
// Keys: VAPID_PUBLIC_KEY (65-byte uncompressed P-256 point) and VAPID_PRIVATE_KEY (32-byte scalar), both base64url,
// as printed by `npx web-push generate-vapid-keys`; VAPID_SUBJECT is a mailto: or https: contact for push services.

const enc = new TextEncoder();

export function b64urlToBytes(s) {
  const b = String(s).replace(/-/g, "+").replace(/_/g, "/"), pad = b.length % 4 ? "=".repeat(4 - (b.length % 4)) : "";
  const bin = atob(b + pad), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64url(bytes) {
  let s = ""; const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---- VAPID ----
async function vapidKey(publicKey, privateKey) {
  const pub = b64urlToBytes(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key must be an uncompressed P-256 point");
  const jwk = { kty: "EC", crv: "P-256", x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), d: privateKey, ext: true };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}
export async function vapidHeader(endpoint, { publicKey, privateKey, subject }, nowSec = Math.floor(Date.now() / 1000)) {
  const aud = new URL(endpoint).origin;
  const head = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = bytesToB64url(enc.encode(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: subject })));
  const key = await vapidKey(publicKey, privateKey);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body)); // raw r||s (64 bytes)
  return `vapid t=${head}.${body}.${bytesToB64url(sig)}, k=${publicKey}`;
}

// ---- payload encryption (aes128gcm) ----
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}
// subscription: { endpoint, keys: { p256dh, auth } } as the browser gives it. Returns the request body.
export async function encryptPayload(subscription, payload, { salt, localKeys } = {}) {
  const uaPublic = b64urlToBytes(subscription.keys.p256dh), authSecret = b64urlToBytes(subscription.keys.auth);
  const local = localKeys || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  salt = salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const plain = concat(typeof payload === "string" ? enc.encode(payload) : payload, new Uint8Array([2])); // last record: 0x02 delimiter
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// Send one notification. Returns { ok, status, gone } — gone: the subscription no longer exists (404/410), delete it.
export async function sendPush(subscription, payload, vapid, { ttl = 3600, urgency = "high" } = {}) {
  const body = await encryptPayload(subscription, JSON.stringify(payload));
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidHeader(subscription.endpoint, vapid),
      "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(ttl), Urgency: urgency,
    },
    body,
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
}
