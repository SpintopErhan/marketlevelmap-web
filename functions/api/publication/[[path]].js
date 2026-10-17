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

function publicEntry(entry) {
  const id = encodeURIComponent(entry.publicationId);
  return {
    graphicKey: entry.graphicKey,
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
// image's R2 custom metadata; otherwise the time the image was uploaded to R2.
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
  const declared = explicitTime(entry) || explicitTime(entry.image);
  if (declared) return { at: declared, source: "publication" };
  if (!entry.image?.objectKey) return null;
  try {
    const head = await bucket.head(entry.image.objectKey);
    if (!head) return null;
    const fromMetadata = explicitTime(head.customMetadata);
    if (fromMetadata) return { at: fromMetadata, source: "metadata" };
    if (head.uploaded) return { at: head.uploaded.toISOString(), source: "upload" };
  } catch (_) {
    // A missing time must not break the publication index.
  }
  return null;
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
    return json({
      schemaVersion: pointer.schemaVersion,
      sitePublicationId: pointer.sitePublicationId,
      activatedAt: pointer.activatedAt,
      entries: await Promise.all(pointer.entries.map(async (entry) => ({
        ...publicEntry(entry),
        chartTime: await chartTime(bucket, entry),
      }))),
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
  return new Response(object.body, { headers: mediaHeaders(object, resource.mediaType) });
}
