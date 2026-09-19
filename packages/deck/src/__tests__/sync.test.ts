import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIN_IMAGE_EDGE } from "../images.js";
import { loadManifest } from "../manifest.js";
import { createDryRunUploader, contentTypeFor } from "../upload.js";
import type { Uploader, UploadItem } from "../upload.js";
import { displayedSize, hashBytes, originalKeyFor, shortHash, syncImages } from "../sync.js";
import { playerSchema } from "../schema.js";
import { writePng } from "./helpers/png.js";

let dir: string;
let sourceDir: string;
let manifestPath: string;

const player = (id: string, file: string) =>
  playerSchema.parse({
    id,
    name: id,
    country: "T",
    position: "FW",
    dob: "1985-06-15",
    stats: { club_goals: 100, caps: 50, apps: 300 },
    image: { file, author: "A Snapper", licence: "CC-BY-4.0", source: "https://e.com/x" },
  });

const both = () => [player("one", "one.png"), player("two", "two.png")];

/** An uploader that remembers what it holds, like a real bucket. */
function fakeBucket(): Uploader & { readonly objects: Map<string, UploadItem> } {
  const objects = new Map<string, UploadItem>();
  return {
    objects,
    async has(key) {
      return objects.has(key);
    },
    async put(item) {
      objects.set(item.key, item);
    },
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "bt-sync-"));
  sourceDir = join(dir, "originals");
  mkdirSync(sourceDir, { recursive: true });
  manifestPath = join(dir, "images.json");
  writePng(join(sourceDir, "one.png"), 2400, 3000, 0, 1);
  writePng(join(sourceDir, "two.png"), 2000, 2000, 0, 2);
  writePng(join(sourceDir, "tiny.png"), 400, 400);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("keys", () => {
  it("are content-hashed and keep the player id readable", () => {
    const sha = hashBytes(Buffer.from("x"));
    expect(originalKeyFor("zidane-zinedine", sha, ".JPG")).toBe(
      `legends/originals/zidane-zinedine.${shortHash(sha)}.jpg`,
    );
  });

  it("change when the bytes change", () => {
    const a = originalKeyFor("p", hashBytes(Buffer.from("a")), ".jpg");
    const b = originalKeyFor("p", hashBytes(Buffer.from("b")), ".jpg");
    expect(a).not.toBe(b);
  });

  it("use a sixteen-character hash", () => {
    expect(shortHash(hashBytes(Buffer.from("x")))).toHaveLength(16);
  });
});

describe("displayedSize", () => {
  it("reads the intrinsic size", () => {
    expect(displayedSize(readFileSync(join(sourceDir, "one.png")))).toEqual({
      width: 2400,
      height: 3000,
    });
  });
});

describe("contentTypeFor", () => {
  it("maps the source formats", () => {
    expect(contentTypeFor("x.JPG")).toBe("image/jpeg");
    expect(contentTypeFor("x.png")).toBe("image/png");
    expect(contentTypeFor("x.webp")).toBe("image/webp");
  });

  it("falls back rather than guessing", () => {
    expect(contentTypeFor("x.xyz")).toBe("application/octet-stream");
  });
});

describe("syncImages", () => {
  const bucket = fakeBucket();

  it("uploads one original per player and writes a manifest", async () => {
    const result = await syncImages({ raws: both(), sourceDir, manifestPath, uploader: bucket });
    expect(result.problems).toEqual([]);
    expect(result.processed).toBe(2);
    expect(result.uploaded).toBe(2);
    expect([...bucket.objects.keys()].every((k) => k.startsWith("legends/originals/"))).toBe(true);
    expect(Object.keys(result.manifest.entries).sort()).toEqual(["one", "two"]);
  });

  it("writes a manifest that round-trips from disk", () => {
    const one = loadManifest(manifestPath).entries.one;
    expect(one?.key).toMatch(/^legends\/originals\/one\.[0-9a-f]{16}\.png$/);
    expect(one?.width).toBe(2400);
    expect(one?.height).toBe(3000);
    expect(one?.sourceSha256).toBe(hashBytes(readFileSync(join(sourceDir, "one.png"))));
  });

  it("uploads the original bytes untouched, with the right type", () => {
    const one = loadManifest(manifestPath).entries.one!;
    const stored = bucket.objects.get(one.key)!;
    expect(stored.bytes.equals(readFileSync(join(sourceDir, "one.png")))).toBe(true);
    expect(stored.contentType).toBe("image/png");
  });

  it("skips unchanged sources on a second run", async () => {
    const uploader = createDryRunUploader();
    const result = await syncImages({ raws: both(), sourceDir, manifestPath, uploader });
    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(2);
    expect(uploader.planned).toHaveLength(0);
  });

  it("uploads under a new key when the source changes", async () => {
    const before = loadManifest(manifestPath).entries.two!.key;
    writePng(join(sourceDir, "two.png"), 2000, 2000, 0, 3);
    const result = await syncImages({ raws: both(), sourceDir, manifestPath, uploader: bucket });
    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.uploaded).toBe(1);
    expect(loadManifest(manifestPath).entries.two!.key).not.toBe(before);
  });

  it("does not re-upload objects the bucket already holds, even when forced", async () => {
    const result = await syncImages({
      raws: both(),
      sourceDir,
      manifestPath,
      uploader: bucket,
      force: true,
    });
    expect(result.processed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.uploaded).toBe(0);
  });

  it("refuses to upload anything when validation fails", async () => {
    const uploader = createDryRunUploader();
    const result = await syncImages({
      raws: [player("small", "tiny.png")],
      sourceDir,
      manifestPath,
      uploader,
    });
    expect(result.problems.join("\n")).toContain(`${MIN_IMAGE_EDGE}px`);
    expect(uploader.planned).toHaveLength(0);
    expect(result.processed).toBe(0);
  });

  it("drops players whose image block was removed", async () => {
    const result = await syncImages({
      raws: [player("one", "one.png")],
      sourceDir,
      manifestPath,
      uploader: bucket,
    });
    expect(Object.keys(result.manifest.entries)).toEqual(["one"]);
    expect(Object.keys(loadManifest(manifestPath).entries)).toEqual(["one"]);
  });

  it("leaves the manifest alone on a dry run", async () => {
    const path = join(dir, "dry.json");
    const uploader = createDryRunUploader();
    const result = await syncImages({
      raws: both(),
      sourceDir,
      manifestPath: path,
      uploader,
      write: false,
    });
    expect(result.processed).toBe(2);
    expect(uploader.planned).toHaveLength(2);
    expect(existsSync(path)).toBe(false);
  });
});
