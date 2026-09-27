/**
 * A fake of the slice of R2's S3 API that `createR2Uploader` uses: HEAD, PUT
 * with a body, and PUT as a copy (`x-amz-copy-source`) with the COPY or
 * REPLACE metadata directive. Enough to run the real request-building code
 * end to end without a network.
 */

import type { R2Config, SignedFetch } from "../../upload.js";

export const FAKE_CONFIG: R2Config = {
  accountId: "acct",
  accessKeyId: "id",
  secretAccessKey: "secret",
  bucket: "bucket",
};

export interface StoredObject {
  readonly body: Uint8Array;
  /** Lower-cased, as R2 would return them. */
  readonly headers: Readonly<Record<string, string>>;
}

export interface Request {
  readonly method: string;
  /** `<bucket>/<key>` */
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly hasBody: boolean;
}

export interface FakeR2 {
  /** Keyed by object key, without the bucket. */
  readonly objects: Map<string, StoredObject>;
  readonly requests: Request[];
  readonly fetch: SignedFetch;
}

const HOST = `https://${FAKE_CONFIG.accountId}.r2.cloudflarestorage.com/`;
const PREFIX = `${FAKE_CONFIG.bucket}/`;

function lowerCased(init: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    out[name.toLowerCase()] = value;
  });
  return out;
}

export function fakeR2(): FakeR2 {
  const objects = new Map<string, StoredObject>();
  const requests: Request[] = [];

  const fetch: SignedFetch = async (url, init) => {
    if (!url.startsWith(HOST + PREFIX)) throw new Error(`unexpected url ${url}`);
    const path = url.slice(HOST.length);
    const key = path.slice(PREFIX.length);
    const method = init.method ?? "GET";
    const headers = lowerCased(init);
    requests.push({ method, path, headers, hasBody: init.body != null });

    if (method === "HEAD") {
      const obj = objects.get(key);
      return obj === undefined
        ? new Response(null, { status: 404 })
        : new Response(null, { status: 200, headers: { ...obj.headers, etag: '"e"' } });
    }

    if (method === "PUT" && headers["x-amz-copy-source"] !== undefined) {
      const source = objects.get(headers["x-amz-copy-source"].replace(/^\/[^/]+\//, ""));
      if (source === undefined) {
        return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
      }
      let kept: Record<string, string> = { ...source.headers };
      if (headers["x-amz-metadata-directive"] === "REPLACE") {
        kept = Object.fromEntries(
          Object.entries(headers).filter(
            ([n]) => !n.startsWith("x-amz-copy") && n !== "x-amz-metadata-directive",
          ),
        );
      }
      objects.set(key, { body: source.body, headers: kept });
      return new Response("<CopyObjectResult/>", { status: 200 });
    }

    if (method === "PUT") {
      const body = new Uint8Array(init.body as Uint8Array);
      objects.set(key, { body, headers });
      return new Response(null, { status: 200 });
    }

    throw new Error(`unexpected ${method}`);
  };

  return { objects, requests, fetch };
}
