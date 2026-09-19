import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_MANIFEST, checkManifest, loadManifest, saveManifest } from "../manifest.js";
import type { Manifest, ManifestEntry } from "../manifest.js";
import { playerSchema } from "../schema.js";

const player = (id: string, withImage: boolean) =>
  playerSchema.parse({
    id,
    name: id,
    country: "T",
    position: "FW",
    dob: "1985-06-15",
    stats: { club_goals: 100, caps: 50, apps: 300 },
    ...(withImage
      ? {
          image: {
            file: `${id}.jpg`,
            author: "A",
            licence: "CC-BY-4.0",
            source: "https://e.com/x",
          },
        }
      : {}),
  });

const entry = (id: string): ManifestEntry => ({
  key: `legends/originals/${id}.0123456789abcdef.jpg`,
  width: 2400,
  height: 3000,
  sourceSha256: "abc",
});

const manifestWith = (ids: string[]): Manifest => ({
  version: 1,
  generatedAt: "2026-09-18T00:00:00.000Z",
  entries: Object.fromEntries(ids.map((id) => [id, entry(id)])),
});

describe("checkManifest", () => {
  it("passes when deck and manifest agree", () => {
    expect(checkManifest([player("a", true)], manifestWith(["a"]))).toEqual([]);
  });

  it("passes when no player has an image", () => {
    expect(checkManifest([player("a", false)], EMPTY_MANIFEST)).toEqual([]);
  });

  it("catches an image block with no manifest entry", () => {
    const problems = checkManifest([player("a", true)], EMPTY_MANIFEST);
    expect(problems[0]?.message).toContain("run images:sync");
  });

  it("catches a manifest entry for a player with no image block", () => {
    const problems = checkManifest([player("a", false)], manifestWith(["a"]));
    expect(problems[0]?.message).toContain("stale");
  });

  it("catches a manifest entry for a player who no longer exists", () => {
    const problems = checkManifest([], manifestWith(["gone"]));
    expect(problems[0]?.playerId).toBe("gone");
  });
});

describe("loadManifest / saveManifest", () => {
  it("round-trips", () => {
    const dir = mkdtempSync(join(tmpdir(), "bt-manifest-"));
    const path = join(dir, "images.json");
    const m = manifestWith(["b", "a"]);
    saveManifest(path, m);
    expect(loadManifest(path).entries).toEqual(m.entries);
    rmSync(dir, { recursive: true, force: true });
  });

  it("sorts entries so diffs stay stable", () => {
    const dir = mkdtempSync(join(tmpdir(), "bt-manifest-"));
    const path = join(dir, "images.json");
    saveManifest(path, manifestWith(["zeta", "alpha", "mid"]));
    const text = readFileSync(path, "utf8");
    expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("mid"));
    expect(text.indexOf("mid")).toBeLessThan(text.indexOf("zeta"));
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty manifest when the file is absent", () => {
    expect(loadManifest("/nowhere/images.json")).toEqual(EMPTY_MANIFEST);
  });

  it("returns an empty manifest rather than throwing on junk", () => {
    const dir = mkdtempSync(join(tmpdir(), "bt-manifest-"));
    const path = join(dir, "images.json");
    writeFileSync(path, "{ not json");
    expect(loadManifest(path)).toEqual(EMPTY_MANIFEST);
    rmSync(dir, { recursive: true, force: true });
  });
});
