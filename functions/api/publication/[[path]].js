import { viewerAccess, isOpenEntry, guestReport } from "../auth/[[path]].js";
import { readSnapshot, writeSnapshot } from "../weekly.js";

const ACTIVE_POINTER_KEY = "site-publication/active.json";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function publicEntry(entry, member) {
  const id = encodeURIComponent(entry.publicationId);
  return {
    graphicKey: entry.graphicKey,
    // Members only (README "Accounts"): every timeframe but 1D needs an approved membership.
    restricted: !isOpenEntry(entry),
    locked: !isOpenEntry(entry) && !member,
    publicationId: entry.publicationId,
    sourceReleaseId: entry.sourceReleaseId,
    packageId: entry.packageId,
    image: entry.image ? {
      url: `/api/publication/image/${id}`,
      mediaType: entry.image.mediaType,
      sizeBytes: entry.image.sizeBytes,
      sha256: entry.image.sha256,
    } : null,
    analysisComment: entry.analysisComment ? {
      url: `/api/publication/comment/${id}`,
      mediaType: entry.analysisComment.mediaType,
      sizeBytes: entry.analysisComment.sizeBytes,
      sha256: entry.analysisComment.sha256,
    } : null,
    // Structured analysis (zones, key levels, note) written by the local engine; see README "Report JSON".
    report: entry.report ? {
      url: `/api/publication/report/${id}`,
      mediaType: entry.report.mediaType,
      sizeBytes: entry.report.sizeBytes,
      sha256: entry.report.sha256,
    } : null,
  };
}

// The chart's own time: an explicit field written by the publisher wins; otherwise the
// R2 custom metadata of the image (or, for image-less publications, the report); otherwise
// the time that object was uploaded to R2.
const TIME_FIELDS = ["dataAsOf", "analysisTime", "chartTime", "generatedAt", "renderedAt", "createdAt"];

function explicitTime(source) {
  if (!source) return null;
  for (const field of TIME_FIELDS) {
    const value = source[field];
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  }
  return null;
}

async function chartTime(bucket, entry) {
  const declared = explicitTime(entry) || explicitTime(entry.image) || explicitTime(entry.report);
  if (declared) return { at: declared, source: "publication" };
  const artifact = entry.image?.objectKey ? entry.image : entry.report;
  if (!artifact?.objectKey) return null;
  try {
    const head = await bucket.head(artifact.objectKey);
    if (!head) return null;
    const fromMetadata = explicitTime(head.customMetadata);
    if (fromMetadata) return { at: fromMetadata, source: "metadata" };
    if (head.uploaded) return { at: head.uploaded.toISOString(), source: "upload" };
  } catch (_) {
    // A missing time must not break the publication index.
  }
  return null;
}

// Chart times of every entry. Without a declared time each one costs an R2 HEAD request (63 of them on every page
// load took 1–3 s), yet they only change with the published files. So they are computed once per set of files
// (the key is a hash of every entry's object keys and checksums) and kept in this worker's memory and in D1.
const timesMemory = new Map();
async function timesKey(pointer) {
  const parts = pointer.entries.map((e) => [e.publicationId, e.image?.objectKey, e.image?.sha256, e.report?.objectKey, e.report?.sha256].join("|"));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\n")));
  return "pubtimes:" + [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function entryTimes(bucket, pointer, db, waitUntil) {
  const key = await timesKey(pointer);
  if (timesMemory.has(key)) return timesMemory.get(key);
  const stored = await readSnapshot(db, key);
  if (stored && stored.data) { timesMemory.set(key, stored.data); return stored.data; }
  const list = await Promise.all(pointer.entries.map((entry) => chartTime(bucket, entry)));
  const times = {};
  pointer.entries.forEach((entry, i) => { times[entry.publicationId] = list[i]; });
  // Kept only when every time was found, so a failed lookup is tried again on the next request.
  if (list.every((t, i) => t || !(pointer.entries[i].image?.objectKey || pointer.entries[i].report?.objectKey))) {
    if (timesMemory.size > 20) timesMemory.clear();
    timesMemory.set(key, times);
    const put = writeSnapshot(db, key, times, Date.now());
    if (waitUntil) waitUntil(put); else await put;
  }
  return times;
}

async function activePointer(bucket) {
  const object = await bucket.get(ACTIVE_POINTER_KEY);
  if (!object) return null;
  try {
    const pointer = await object.json();
    if (!pointer || pointer.schemaVersion !== "marketlevelmap-site-publication-index-v1" || !Array.isArray(pointer.entries)) {
      return null;
    }
    return pointer;
  } catch (_) {
    return null;
  }
}

function mediaHeaders(object, declaredType) {
  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || declaredType || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=300");
  if (object.etag) headers.set("ETag", object.etag);
  return headers;
}

export async function onRequestGet(context) {
  const bucket = context.env.MARKETLEVELMAP_PUBLIC;
  if (!bucket) {
    return json({ error: "R2 binding MARKETLEVELMAP_PUBLIC is not configured." }, 503);
  }
  const pointer = await activePointer(bucket);
  if (!pointer) return json({ error: "No active publication is available." }, 404);

  const path = context.params.path || [];
  if (!path.length) {
    const [access, times] = await Promise.all([
      pointer.entries.some((entry) => !isOpenEntry(entry)) ? viewerAccess(context.request, context.env) : { member: false, status: "guest" },
      entryTimes(bucket, pointer, context.env.USERS_DB, context.waitUntil && context.waitUntil.bind(context)),
    ]);
    return json({
      viewer: { member: access.member, status: access.status },
      schemaVersion: pointer.schemaVersion,
      sitePublicationId: pointer.sitePublicationId,
      activatedAt: pointer.activatedAt,
      entries: pointer.entries.map((entry) => ({
        ...publicEntry(entry, access.member),
        chartTime: times[entry.publicationId] || null,
      })),
    });
  }
  if (path.length !== 2 || !["image", "comment", "report"].includes(path[0])) {
    return json({ error: "Unknown publication resource." }, 404);
  }
  const entry = pointer.entries.find((item) => item.publicationId === path[1]);
  const resource = path[0] === "image" ? entry?.image : path[0] === "report" ? entry?.report : entry?.analysisComment;
  if (!resource?.objectKey) return json({ error: "Publication resource is not active." }, 404);
  const object = await bucket.get(resource.objectKey);
  if (!object) return json({ error: "Publication resource is unavailable." }, 404);
  if (isOpenEntry(entry)) return new Response(object.body, { headers: mediaHeaders(object, resource.mediaType) });
  // Members-only timeframe: members get the object, never cached where another visitor could reuse it;
  // everyone else gets the key levels only (report) or nothing (image, comment).
  const access = await viewerAccess(context.request, context.env);
  if (access.member) {
    const headers = mediaHeaders(object, resource.mediaType);
    headers.set("Cache-Control", "private, no-store");
    return new Response(object.body, { headers });
  }
  if (path[0] !== "report") return json({ error: "members_only", locked: true }, 403);
  let report = null;
  try { report = await object.json(); } catch (_) { report = null; }
  return json(guestReport(report));
}
