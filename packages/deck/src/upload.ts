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
 * dependency tree for two kinds of HTTP call.
 */

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
 * The real uploader.
 *
 * Objects are content-addressed, so an existing key always holds the right
 * bytes and re-uploading is pure waste — hence `has` before `put`.
 *
 * Cache headers are immutable and effectively permanent. That is only safe
 * *because* keys are content-hashed: change the image and you get a new key,
 * so there is never a stale object to invalidate.
 */
export async function createR2Uploader(config: R2Config): Promise<Uploader> {
  const { AwsClient } = await import("aws4fetch");

  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });

  const url = (key: string): string =>
    `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`;

  return {
    async has(key) {
      const res = await client.fetch(url(key), { method: "HEAD" });
      return res.ok;
    },
    async put(item) {
      const res = await client.fetch(url(item.key), {
        method: "PUT",
        body: new Uint8Array(item.bytes),
        headers: {
          "content-type": item.contentType,
          // Safe only because keys are content-hashed: a changed image gets a
          // new key, so there is never a stale object to invalidate.
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
      if (!res.ok) {
        throw new Error(`upload failed for ${item.key}: ${res.status} ${res.statusText}`);
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
