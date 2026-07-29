/**
 * Photo and video review uploads, stored in Shopify Files.
 *
 * Why Shopify Files rather than our own bucket
 * -------------------------------------------
 * The obvious alternative is Azure Blob Storage. Shopify Files wins on every axis that
 * matters here:
 *
 *   - **No infrastructure.** No storage account, no lifecycle rules, no CDN to configure.
 *   - **No storage cost to us.** Review media is the single largest data cost in this
 *     category — a merchant with 10,000 photo reviews is tens of gigabytes — and here it
 *     sits in the merchant's own Shopify plan rather than on our bill.
 *   - **Served from Shopify's CDN**, same origin family as the rest of the storefront, so
 *     images are fast and already covered by the merchant's own caching.
 *   - **The merchant keeps their assets** if they ever uninstall. An app that takes a
 *     merchant's customer photos hostage is a bad app.
 *
 * The cost is a three-step async dance (stage → upload → create → poll), and a
 * `write_files` scope.
 *
 * Security posture
 * ----------------
 * These files arrive from an unauthenticated storefront form, so everything is validated
 * before a single byte reaches Shopify:
 *
 *   - MIME type allowlist, not a denylist, and checked against the file's declared type
 *   - Magic-byte sniffing, because a declared Content-Type is attacker-controlled
 *   - Hard size caps per file and per submission
 *   - Hard count caps
 *
 * An SVG is deliberately NOT allowed: SVG is an executable document format that can carry
 * script, and serving one from the merchant's CDN origin is stored XSS.
 */

import { callShopifyGraphQL } from './shopify';

export const MAX_IMAGES = 5;
export const MAX_VIDEOS = 1;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

const IMAGE_TYPES: Record<string, { ext: string; magic: number[][] }> = {
  'image/jpeg': { ext: 'jpg', magic: [[0xff, 0xd8, 0xff]] },
  'image/png': { ext: 'png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  'image/gif': { ext: 'gif', magic: [[0x47, 0x49, 0x46, 0x38]] },
  // WebP is RIFF....WEBP — the magic check below handles the offset-8 marker.
  'image/webp': { ext: 'webp', magic: [[0x52, 0x49, 0x46, 0x46]] },
};

const VIDEO_TYPES: Record<string, { ext: string }> = {
  'video/mp4': { ext: 'mp4' },
  'video/quicktime': { ext: 'mov' },
  'video/webm': { ext: 'webm' },
};

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaError';
  }
}

/**
 * Verify a file's real type from its leading bytes.
 *
 * The browser-supplied Content-Type is just a string in a request an attacker controls.
 * A .exe renamed to .jpg arrives as `image/jpeg` and would otherwise be handed straight to
 * Shopify. Checking magic bytes means the declared type has to match the actual content.
 */
function sniffMatches(mime: string, head: Uint8Array): boolean {
  if (VIDEO_TYPES[mime]) {
    // Video containers vary too much for a simple prefix check — MP4/MOV carry an `ftyp`
    // box at offset 4, WebM starts with the EBML magic.
    if (mime === 'video/webm') {
      return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    }
    const ftyp = String.fromCharCode(head[4], head[5], head[6], head[7]);
    return ftyp === 'ftyp';
  }

  const spec = IMAGE_TYPES[mime];
  if (!spec) return false;

  if (mime === 'image/webp') {
    const riff = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46;
    const webp = String.fromCharCode(head[8], head[9], head[10], head[11]) === 'WEBP';
    return riff && webp;
  }

  return spec.magic.some((sig) => sig.every((b, i) => head[i] === b));
}

export interface ValidatedFile {
  file: File;
  mime: string;
  kind: 'image' | 'video';
  bytes: number;
}

/**
 * Validate a set of uploaded files. Throws MediaError with a shopper-readable message.
 *
 * Messages are written for a shopper, not a developer: "That image is too large (max 10MB)"
 * rather than "413 payload too large". They are the ones who has to fix it.
 */
export async function validateFiles(files: File[]): Promise<ValidatedFile[]> {
  if (!files.length) return [];

  const out: ValidatedFile[] = [];
  let images = 0;
  let videos = 0;
  let total = 0;

  for (const file of files) {
    const mime = (file.type || '').toLowerCase();
    const isImage = Boolean(IMAGE_TYPES[mime]);
    const isVideo = Boolean(VIDEO_TYPES[mime]);

    if (!isImage && !isVideo) {
      throw new MediaError(
        `"${file.name}" is not a supported file type. Please upload a JPG, PNG, GIF, WebP, MP4, MOV or WebM.`
      );
    }

    const limit = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (file.size > limit) {
      const mb = Math.round(limit / 1024 / 1024);
      throw new MediaError(`"${file.name}" is too large. The limit is ${mb}MB.`);
    }
    if (file.size === 0) {
      throw new MediaError(`"${file.name}" appears to be empty.`);
    }

    if (isImage && ++images > MAX_IMAGES) {
      throw new MediaError(`Please upload at most ${MAX_IMAGES} photos.`);
    }
    if (isVideo && ++videos > MAX_VIDEOS) {
      throw new MediaError(`Please upload at most ${MAX_VIDEOS} video.`);
    }

    total += file.size;
    if (total > MAX_TOTAL_BYTES) {
      throw new MediaError('Those files are too large in total. Please upload fewer or smaller files.');
    }

    // Sniff the first 16 bytes. Cheap, and it closes the renamed-file hole.
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!sniffMatches(mime, head)) {
      throw new MediaError(`"${file.name}" does not look like a valid ${isImage ? 'image' : 'video'}.`);
    }

    out.push({ file, mime, kind: isImage ? 'image' : 'video', bytes: file.size });
  }

  return out;
}

const STAGED_UPLOADS_CREATE = `
  mutation StagedUploads($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const FILE_CREATE = `
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        ... on MediaImage { image { url width height } }
        ... on Video { sources { url mimeType } preview { image { url } } }
      }
      userErrors { field message code }
    }
  }
`;

const FILE_STATUS = `
  query FileStatus($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on MediaImage { id fileStatus image { url width height } }
      ... on Video { id fileStatus sources { url mimeType } preview { image { url } } }
    }
  }
`;

export interface UploadedMedia {
  gid: string;
  kind: 'image' | 'video';
  url: string | null;
  previewUrl: string | null;
}

/**
 * Upload validated files to Shopify Files and return their CDN URLs.
 *
 * Three round trips per batch, by Shopify's design:
 *   1. stagedUploadsCreate — Shopify hands back a signed upload target per file
 *   2. POST the bytes to that target (Google Cloud Storage under the hood)
 *   3. fileCreate — register the staged resource as a Shopify File
 *
 * Then a poll, because file processing is asynchronous: fileCreate returns immediately with
 * fileStatus UPLOADED, and the CDN URL only exists once it reaches READY. Images are
 * typically ready within a second or two; video transcoding can take much longer, which is
 * why unresolved GIDs are returned rather than waited on indefinitely.
 */
export async function uploadToShopify(
  shop: string,
  accessToken: string,
  files: ValidatedFile[],
  onUnauthorized?: () => Promise<string | null>
): Promise<UploadedMedia[]> {
  if (!files.length) return [];

  // ── 1. Ask Shopify where to put them ──
  const staged = await callShopifyGraphQL<{
    stagedUploadsCreate: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }>;
      userErrors: Array<{ message: string }>;
    };
  }>(
    shop,
    accessToken,
    STAGED_UPLOADS_CREATE,
    {
      input: files.map((f) => ({
        filename: sanitiseFilename(f.file.name, f.kind),
        mimeType: f.mime,
        resource: f.kind === 'image' ? 'IMAGE' : 'VIDEO',
        httpMethod: 'POST',
        fileSize: String(f.bytes),
      })),
    },
    onUnauthorized
  );

  const errs = staged.stagedUploadsCreate.userErrors;
  if (errs?.length) {
    throw new MediaError(`Upload could not be prepared: ${errs.map((e) => e.message).join('; ')}`);
  }

  const targets = staged.stagedUploadsCreate.stagedTargets;
  if (targets.length !== files.length) {
    throw new MediaError('Upload could not be prepared for all files.');
  }

  // ── 2. Push the bytes ──
  await Promise.all(
    targets.map(async (target, i) => {
      const form = new FormData();
      // Shopify's signed parameters must be appended BEFORE the file field — the storage
      // backend reads the policy fields in order and rejects the request otherwise.
      for (const p of target.parameters) form.append(p.name, p.value);
      form.append('file', files[i].file);

      const res = await fetch(target.url, { method: 'POST', body: form });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new MediaError(`Upload failed for "${files[i].file.name}" (${res.status}). ${text.slice(0, 200)}`);
      }
    })
  );

  // ── 3. Register them as Shopify Files ──
  const created = await callShopifyGraphQL<{
    fileCreate: {
      files: Array<{ id: string; fileStatus: string }>;
      userErrors: Array<{ message: string }>;
    };
  }>(
    shop,
    accessToken,
    FILE_CREATE,
    {
      files: targets.map((t, i) => ({
        originalSource: t.resourceUrl,
        contentType: files[i].kind === 'image' ? 'IMAGE' : 'VIDEO',
        alt: files[i].kind === 'image' ? 'Customer review photo' : 'Customer review video',
      })),
    },
    onUnauthorized
  );

  const createErrs = created.fileCreate.userErrors;
  if (createErrs?.length) {
    throw new MediaError(`Shopify rejected the upload: ${createErrs.map((e) => e.message).join('; ')}`);
  }

  const gids = created.fileCreate.files.map((f) => f.id);
  const resolved = await resolveMediaUrls(shop, accessToken, gids, onUnauthorized);

  return gids.map((gid, i) => {
    const r = resolved.find((x) => x.gid === gid);
    return {
      gid,
      kind: files[i].kind,
      url: r?.url ?? null,
      previewUrl: r?.previewUrl ?? null,
    };
  });
}

/**
 * Poll Shopify until files reach READY and expose a CDN URL.
 *
 * Bounded, with backoff. Nothing interactive waits on this any more — the submit endpoint
 * runs the whole upload after the response has flushed — so a few hundred milliseconds
 * here costs the shopper nothing. Anything still processing keeps its GID for
 * /api/media/resolve to pick up later.
 */
export async function resolveMediaUrls(
  shop: string,
  accessToken: string,
  gids: string[],
  onUnauthorized?: () => Promise<string | null>,
  attempts = 3
): Promise<UploadedMedia[]> {
  if (!gids.length) return [];

  const out = new Map<string, UploadedMedia>();

  for (let attempt = 0; attempt < attempts; attempt++) {
    const pending = gids.filter((g) => !out.get(g)?.url);
    if (!pending.length) break;

    // 400ms, 800ms, 1.6s, 3.2s — roughly 6 seconds total before giving up.
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));

    const data = await callShopifyGraphQL<{
      nodes: Array<
        | {
            id: string;
            fileStatus: string;
            image?: { url: string } | null;
            sources?: Array<{ url: string; mimeType: string }> | null;
            preview?: { image?: { url: string } | null } | null;
          }
        | null
      >;
    }>(shop, accessToken, FILE_STATUS, { ids: pending }, onUnauthorized).catch(() => null);

    if (!data) continue;

    for (const node of data.nodes) {
      if (!node) continue;
      const isVideo = Array.isArray(node.sources);
      const url = isVideo ? node.sources?.[0]?.url ?? null : node.image?.url ?? null;
      out.set(node.id, {
        gid: node.id,
        kind: isVideo ? 'video' : 'image',
        url,
        previewUrl: node.preview?.image?.url ?? null,
      });
    }
  }

  return gids.map(
    (gid) => out.get(gid) ?? { gid, kind: 'image', url: null, previewUrl: null }
  );
}

/**
 * Make a filename safe.
 *
 * Shopify stores the filename, and it ends up in a public CDN URL. Shopper-supplied names
 * can carry path traversal, unicode tricks, or simply be 300 characters of nonsense.
 */
function sanitiseFilename(name: string, kind: 'image' | 'video'): string {
  const ext = (name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ext && ext.length <= 5 ? ext : kind === 'image' ? 'jpg' : 'mp4';
  const base = name
    .replace(/\.[^.]*$/, '')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^-|-$/g, '');
  return `review-${base || 'media'}-${Date.now()}.${safeExt}`;
}
