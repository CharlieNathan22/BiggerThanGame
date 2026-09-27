import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deckDirFor } from "../load.js";
import type { Manifest } from "../manifest.js";
import { refreshMetadata } from "../refresh.js";
import { runSync } from "../sync-cli.js";
import { createR2Uploader, ORIGINAL_CACHE_CONTROL } from "../upload.js";
import type { MetadataStore, ObjectMetadata } from "../upload.js";
import { FAKE_CONFIG, fakeR2 } from "./helpers/fake-r2.js";
import type { FakeR2 } from "./helpers/fake-r2.js";

const key = (id: string, ext = ".jpg") => `legends/originals/${id}.0123456789abcdef${ext}`;

const manifestOf = (...ids: string[]): Manifest => ({
  version: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  entries: Object.fromEntries(
    ids.map((id) => [
      id,
      { key: key(id), width: 1200, height: 1500, sourceSha256: "0".repeat(64) },
    ]),
  ),
});

/**
 * A bucket as it might be before the refresh: `legacy` uploaded without
 * Cache-Control and carrying custom metadata, `current` already right, `short`
 * with a different Cache-Control. `absent` is in the manifest but not here.
 */
function seeded(): FakeR2 {
  const r2 = fakeR2();
  r2.objects.set(key("legacy"), {
    body: new Uint8Array([1, 2, 3]),
    headers: { "content-type": "image/jpeg", "x-amz-meta-origin": "dashboard" },
  });
  r2.objects.set(key("current"), {
    body: new Uint8Array([4]),
    headers: { "content-type": "image/png", "cache-control": ORIGINAL_CACHE_CONTROL },
  });
  r2.objects.set(key("short"), {
    body: new Uint8Array([5]),
    headers: { "content-type": "image/webp", "cache-control": "max-age=60" },
  });
  return r2;
}

const puts = (r2: FakeR2) => r2.requests.filter((r) => r.method === "PUT");

describe("refreshMetadata", () => {
  it("reports what would change on a dry run and writes nothing", async () => {
    const r2 = seeded();
    const before = new Map(r2.objects);
    const result = await refreshMetadata({
      manifest: manifestOf("legacy", "current", "short", "absent"),
      store: await createR2Uploader(FAKE_CONFIG, r2.fetch),
    });

    expect(result).toEqual({
      checked: 4,
      current: 1,
      stale: 2,
      missing: [`absent: ${key("absent")}`],
      problems: [],
    });
    expect(puts(r2)).toEqual([]);
    expect(r2.objects).toEqual(before);
  });

  it("sets Cache-Control on apply, keeping the content type and custom metadata", async () => {
    const r2 = seeded();
    const result = await refreshMetadata({
      manifest: manifestOf("legacy", "current", "short"),
      store: await createR2Uploader(FAKE_CONFIG, r2.fetch),
      apply: true,
    });

    expect(result).toMatchObject({ checked: 3, current: 1, stale: 2, missing: [], problems: [] });
    expect(r2.objects.get(key("legacy"))!.headers).toEqual({
      "content-type": "image/jpeg",
      "cache-control": ORIGINAL_CACHE_CONTROL,
      "x-amz-meta-origin": "dashboard",
    });
    expect(r2.objects.get(key("short"))!.headers).toEqual({
      "content-type": "image/webp",
      "cache-control": ORIGINAL_CACHE_CONTROL,
    });
  });

  it("re-uploads nothing: only stale objects are touched, and only by copy", async () => {
    const r2 = seeded();
    const legacyBody = r2.objects.get(key("legacy"))!.body;
    await refreshMetadata({
      manifest: manifestOf("legacy", "current", "short"),
      store: await createR2Uploader(FAKE_CONFIG, r2.fetch),
      apply: true,
    });

    expect(puts(r2).map((r) => r.path)).toEqual([
      `bucket/${key("legacy")}`,
      `bucket/${key("short")}`,
    ]);
    expect(puts(r2).every((r) => !r.hasBody && r.headers["x-amz-copy-source"] !== undefined)).toBe(
      true,
    );
    expect(r2.objects.get(key("legacy"))!.body).toBe(legacyBody);
  });

  it("is a no-op the second time", async () => {
    const r2 = seeded();
    const store = await createR2Uploader(FAKE_CONFIG, r2.fetch);
    const manifest = manifestOf("legacy", "current", "short");
    await refreshMetadata({ manifest, store, apply: true });
    r2.requests.length = 0;

    const again = await refreshMetadata({ manifest, store, apply: true });
    expect(again).toMatchObject({ current: 3, stale: 0 });
    expect(puts(r2)).toEqual([]);
  });

  it("leaves an object with no content type alone rather than guess one", async () => {
    const r2 = fakeR2();
    r2.objects.set(key("typeless"), { body: new Uint8Array([1]), headers: {} });
    const result = await refreshMetadata({
      manifest: manifestOf("typeless"),
      store: await createR2Uploader(FAKE_CONFIG, r2.fetch),
      apply: true,
    });

    expect(result.stale).toBe(0);
    expect(result.problems.join("\n")).toContain("typeless");
    expect(puts(r2)).toEqual([]);
  });

  it("reports a rewrite that does not read back correctly", async () => {
    const stuck: ObjectMetadata = {
      contentType: "image/jpeg",
      cacheControl: undefined,
      preserved: {},
    };
    const store: MetadataStore = {
      async head() {
        return stuck;
      },
      async replaceMetadata() {},
    };
    const result = await refreshMetadata({ manifest: manifestOf("legacy"), store, apply: true });
    expect(result.problems.join("\n")).toMatch(/legacy: .* reads back as .*cache-control \(none\)/);
  });
});

describe("images:sync --refresh-metadata flags", () => {
  let root: string;
  let error: MockInstance<typeof console.error>;
  let log: MockInstance<typeof console.log>;

  // Every case here must stop before credentials are read: runSync loads the
  // repo's real .env, and a test must never reach the bucket.
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "bt-refresh-cli-"));
    const players = join(deckDirFor(root, "data"), "players");
    mkdirSync(players, { recursive: true });
    writeFileSync(
      join(players, "one.yaml"),
      [
        "id: one",
        "name: One",
        "country: Testland",
        "position: FW",
        "dob: 1980-01-01",
        "stats:",
        "  club_goals: 300",
        "  caps: 90",
        "  apps: 500",
      ].join("\n"),
    );
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterAll(() => {
    error.mockRestore();
    log.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });

  const errors = () => error.mock.calls.map((c) => String(c[0])).join("\n");

  it("rejects --apply on a normal sync", async () => {
    expect(await runSync(["--apply"], root)).toBe(1);
    expect(errors()).toContain("--apply only goes with --refresh-metadata");
  });

  it("rejects --force and a contradictory --dry-run", async () => {
    expect(await runSync(["--refresh-metadata", "--force"], root)).toBe(1);
    expect(await runSync(["--refresh-metadata", "--apply", "--dry-run"], root)).toBe(1);
  });

  it("fails when the deck has no manifest, rather than reporting nothing to do", async () => {
    expect(await runSync(["--refresh-metadata"], root)).toBe(1);
    expect(errors()).toContain("no manifest at");
  });
});
