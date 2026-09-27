/**
 * Uploading to R2.
 *
 * Deliberately behind an interface. The sync command depends on `Uploader`,
 * not on any particular SDK, which means the whole pipeline can be tested with
 * a fake and the storage backend can change without touching sync logic.
 *
 * R2 speaks the S3 API. `aws4fetch` signs requests with SigV4 over plain
 * `fetch` in a few kilobytes, which is the right weight for a command that
 * runs a few times a year — the official AWS SDK would drag in megabytes of
 * dependency tree for a handful of kinds of HTTP call.
 */

/**
 * `Cache-Control` for every original, stored on the object (R2's
 * `httpMetadata.cacheControl`) so R2 serves it on every response.
 *
 * Immutable and year-long. Safe only because keys are content-hashed: a
 * changed image gets a new key, so there is never a stale object to
 * invalidate.
 */
export const ORIGINAL_CACHE_CONTROL = "public, max-age=31536000, immutable";

export interface UploadItem {
  readonly key: string;
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface Uploader {
  /** Keys already present, so unchanged objects can be skipped. */
  has(key: string): Promise<boolean>;
  put(item: UploadItem): Promise<void>;
}

/** The source formats `images:sync` accepts — see `imageFilesIn`. */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

export function contentTypeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export interface R2Config {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

/**
 * Reads R2 credentials from the environment.
 *
 * Returns undefined rather than throwing, so `images:sync --dry-run` works
 * without credentials — useful for checking what *would* change.
 */
export function r2ConfigFromEnv(env: NodeJS.ProcessEnv): R2Config | undefined {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return undefined;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

/**
 * An object's HTTP metadata, as far as `images:sync --refresh-metadata` needs
 * it.
 */
export interface ObjectMetadata {
  readonly contentType: string | undefined;
  readonly cacheControl: string | undefined;
  /**
   * Every other header a metadata REPLACE would silently drop —
   * `content-disposition`, `content-encoding`, `content-language`, `expires`
   * and any `x-amz-meta-*` — lower-cased, carried across unchanged.
   */
  readonly preserved: Readonly<Record<string, string>>;
}

/** Reads and rewrites object metadata in place, without moving any bytes. */
export interface MetadataStore {
  /** Undefined when the key is not in the bucket. */
  head(key: string): Promise<ObjectMetadata | undefined>;
  /** Replaces the object's metadata wholesale; the body is untouched. */
  replaceMetadata(key: string, metadata: ObjectMetadata): Promise<void>;
}

/** A signed fetch — `AwsClient.fetch` in production, a fake in tests. */
export type SignedFetch = (url: string, init: RequestInit) => Promise<Response>;

const PRESERVED_HEADERS = new Set([
  "content-disposition",
  "content-encoding",
  "content-language",
  "expires",
]);

function metadataFrom(headers: Headers): ObjectMetadata {
  const preserved: Record<string, string> = {};
  headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (PRESERVED_HEADERS.has(lower) || lower.startsWith("x-amz-meta-")) preserved[lower] = value;
  });
  return {
    contentType: headers.get("content-type") ?? undefined,
    cacheControl: headers.get("cache-control") ?? undefined,
    preserved,
  };
}

/**
 * The real uploader.
 *
 * Objects are content-addressed, so an existing key always holds the right
 * bytes and re-uploading is pure waste — hence `has` before `put`.
 *
 * `signedFetch` is for tests; left out, requests are signed with `aws4fetch`.
 */
export async function createR2Uploader(
  config: R2Config,
  signedFetch?: SignedFetch,
): Promise<Uploader & MetadataStore> {
  let send = signedFetch;
  if (send === undefined) {
    const { AwsClient } = await import("aws4fetch");
    const client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: "auto",
    });
    send = (url, init) => client.fetch(url, init);
  }
  const fetchSigned = send;

  // Keys need no escaping: ids are `[a-z0-9-]` and the rest is fixed.
  const path = (key: string): string => `${config.bucket}/${key}`;
  const url = (key: string): string =>
    `https://${config.accountId}.r2.cloudflarestorage.com/${path(key)}`;

  return {
    async has(key) {
      const res = await fetchSigned(url(key), { method: "HEAD" });
      return res.ok;
    },
    async put(item) {
      const res = await fetchSigned(url(item.key), {
        method: "PUT",
        body: new Uint8Array(item.bytes),
        headers: {
          "content-type": item.contentType,
          "cache-control": ORIGINAL_CACHE_CONTROL,
        },
      });
      if (!res.ok) {
        throw new Error(`upload failed for ${item.key}: ${res.status} ${res.statusText}`);
      }
    },
    async head(key) {
      const res = await fetchSigned(url(key), { method: "HEAD" });
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`HEAD failed for ${key}: ${res.status} ${res.statusText}`);
      return metadataFrom(res.headers);
    },
    /**
     * S3 has no "set metadata" call: the way to change it without re-uploading
     * is to copy the object onto itself with the REPLACE directive. The copy
     * happens inside R2; no bytes cross the network. REPLACE keeps only what
     * is sent, which is why the caller passes the full `ObjectMetadata`.
     */
    async replaceMetadata(key, metadata) {
      const headers: Record<string, string> = {
        ...metadata.preserved,
        "x-amz-copy-source": `/${path(key)}`,
        "x-amz-metadata-directive": "REPLACE",
      };
      if (metadata.contentType !== undefined) headers["content-type"] = metadata.contentType;
      if (metadata.cacheControl !== undefined) headers["cache-control"] = metadata.cacheControl;

      const res = await fetchSigned(url(key), { method: "PUT", headers });
      // S3 can report a failed copy as a 200 with an <Error> body.
      const body = await res.text();
      if (!res.ok || body.includes("<Error>")) {
        throw new Error(
          `metadata update failed for ${key}: ${res.status} ${res.statusText} ${body}`.trim(),
        );
      }
    },
  };
}

/** Records what would be uploaded without touching the network. */
export function createDryRunUploader(): Uploader & { readonly planned: UploadItem[] } {
  const planned: UploadItem[] = [];
  return {
    planned,
    async has() {
      return false;
    },
    async put(item) {
      planned.push(item);
    },
  };
}
