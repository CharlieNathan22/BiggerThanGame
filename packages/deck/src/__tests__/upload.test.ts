import { describe, expect, it } from "vitest";
import { createR2Uploader, ORIGINAL_CACHE_CONTROL } from "../upload.js";
import { FAKE_CONFIG, fakeR2 } from "./helpers/fake-r2.js";

const KEY = "legends/originals/one.0123456789abcdef.jpg";

describe("ORIGINAL_CACHE_CONTROL", () => {
  it("is public, immutable and a year long", () => {
    expect(ORIGINAL_CACHE_CONTROL).toBe("public, max-age=31536000, immutable");
  });
});

describe("createR2Uploader", () => {
  it("puts originals with their content type and the immutable Cache-Control", async () => {
    const r2 = fakeR2();
    const uploader = await createR2Uploader(FAKE_CONFIG, r2.fetch);
    await uploader.put({ key: KEY, bytes: Buffer.from("jpeg"), contentType: "image/jpeg" });

    expect(r2.requests).toHaveLength(1);
    expect(r2.requests[0]).toMatchObject({ method: "PUT", path: `bucket/${KEY}`, hasBody: true });
    expect(r2.requests[0]!.headers["content-type"]).toBe("image/jpeg");
    expect(r2.requests[0]!.headers["cache-control"]).toBe(ORIGINAL_CACHE_CONTROL);
  });

  it("reads an object's metadata, keeping only what a REPLACE would drop", async () => {
    const r2 = fakeR2();
    r2.objects.set(KEY, {
      body: new Uint8Array([1]),
      headers: {
        "content-type": "image/jpeg",
        "content-language": "en",
        "x-amz-meta-origin": "dashboard",
        "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
      },
    });
    const uploader = await createR2Uploader(FAKE_CONFIG, r2.fetch);

    expect(await uploader.head(KEY)).toEqual({
      contentType: "image/jpeg",
      cacheControl: undefined,
      preserved: { "content-language": "en", "x-amz-meta-origin": "dashboard" },
    });
  });

  it("reports a missing object as undefined, and other failures as errors", async () => {
    const uploader = await createR2Uploader(FAKE_CONFIG, fakeR2().fetch);
    expect(await uploader.head(KEY)).toBeUndefined();

    const failing = await createR2Uploader(
      FAKE_CONFIG,
      async () => new Response(null, { status: 403 }),
    );
    await expect(failing.head(KEY)).rejects.toThrow(/HEAD failed .* 403/);
  });

  it("replaces metadata by copying the object onto itself, sending no body", async () => {
    const r2 = fakeR2();
    const body = new Uint8Array([9, 8, 7]);
    r2.objects.set(KEY, { body, headers: { "content-type": "image/png" } });
    const uploader = await createR2Uploader(FAKE_CONFIG, r2.fetch);

    await uploader.replaceMetadata(KEY, {
      contentType: "image/png",
      cacheControl: ORIGINAL_CACHE_CONTROL,
      preserved: { "x-amz-meta-origin": "dashboard" },
    });

    const [req] = r2.requests;
    expect(req).toMatchObject({ method: "PUT", path: `bucket/${KEY}`, hasBody: false });
    expect(req!.headers["x-amz-copy-source"]).toBe(`/bucket/${KEY}`);
    expect(req!.headers["x-amz-metadata-directive"]).toBe("REPLACE");

    const stored = r2.objects.get(KEY)!;
    expect(stored.body).toBe(body);
    expect(stored.headers).toEqual({
      "content-type": "image/png",
      "cache-control": ORIGINAL_CACHE_CONTROL,
      "x-amz-meta-origin": "dashboard",
    });
  });

  it("treats a copy that answers 200 with an <Error> body as a failure", async () => {
    const uploader = await createR2Uploader(
      FAKE_CONFIG,
      async () => new Response("<Error><Code>InternalError</Code></Error>", { status: 200 }),
    );
    await expect(
      uploader.replaceMetadata(KEY, {
        contentType: "image/jpeg",
        cacheControl: "x",
        preserved: {},
      }),
    ).rejects.toThrow(/metadata update failed .*InternalError/);
  });
});
