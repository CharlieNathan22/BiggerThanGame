import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DISPLAY_WIDTHS } from "@bt/core";
import {
  MAX_ASPECT_RATIO,
  MIN_IMAGE_EDGE,
  RECOMMENDED_IMAGE_EDGE,
  formatImageWarnings,
  imageSizeWarnings,
  orphanedImages,
  validateImages,
} from "../images.js";
import { playerSchema } from "../schema.js";
import { writePng } from "./helpers/png.js";

const player = (id: string, file?: string) =>
  playerSchema.parse({
    id,
    name: id,
    country: "T",
    position: "FW",
    dob: "1985-06-15",
    stats: { club_goals: 100, caps: 50, apps: 300 },
    ...(file !== undefined
      ? {
          image: {
            file,
            author: "A Snapper",
            licence: "CC-BY-4.0",
            source: "https://commons.wikimedia.org/wiki/File:X",
          },
        }
      : {}),
  });

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "bt-images-"));
  writePng(join(dir, "good.png"), 1800, 1800);
  writePng(join(dir, "small.png"), 400, 400);
  writePng(join(dir, "wide.png"), 6000, 1800);
  writeFileSync(join(dir, "broken.png"), "not an image");
  writePng(join(dir, "orphan.png"), 1800, 1800);
  // Both thresholds are on the shortest edge; the long edge is deliberately
  // larger, and the landscape files prove width can't carry a short height.
  writePng(join(dir, "at-min.png"), MIN_IMAGE_EDGE, 1500);
  writePng(join(dir, "below-min.png"), MIN_IMAGE_EDGE - 1, 1500);
  writePng(join(dir, "landscape-below-min.png"), 2000, MIN_IMAGE_EDGE - 1);
  writePng(join(dir, "landscape-soft.png"), 1500, 900);
  writePng(join(dir, "under-recommended.png"), RECOMMENDED_IMAGE_EDGE - 1, 1500);
  writePng(join(dir, "at-recommended.png"), RECOMMENDED_IMAGE_EDGE, 1500);
  writePng(join(dir, "commons-2003.png"), 1400, 1750);
  writePng(join(dir, "commons-1998.png"), 1100, 1375);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("validateImages", () => {
  it("passes a good image", () => {
    expect(validateImages([player("a", "good.png")], dir)).toEqual([]);
  });

  it("passes players with no image at all", () => {
    expect(validateImages([player("a")], dir)).toEqual([]);
  });

  it("catches a missing file", () => {
    const problems = validateImages([player("a", "nope.png")], dir);
    expect(problems[0]?.message).toContain("does not exist");
  });

  it("catches an image below the minimum edge", () => {
    const problems = validateImages([player("a", "small.png")], dir);
    expect(problems.some((p) => p.message.includes(`${MIN_IMAGE_EDGE}px`))).toBe(true);
  });

  it("sets the minimum at 800px and the recommendation at 1200px", () => {
    expect(MIN_IMAGE_EDGE).toBe(800);
    expect(RECOMMENDED_IMAGE_EDGE).toBe(1200);
  });

  it("never sets the minimum below the smallest display width, so the 800w rendition is never upscaled", () => {
    expect(MIN_IMAGE_EDGE).toBeGreaterThanOrEqual(Math.min(...DISPLAY_WIDTHS));
  });

  it("recommends more than it requires", () => {
    expect(RECOMMENDED_IMAGE_EDGE).toBeGreaterThan(MIN_IMAGE_EDGE);
  });

  it("accepts an image exactly at the minimum", () => {
    expect(validateImages([player("a", "at-min.png")], dir)).toEqual([]);
  });

  it("rejects an image one pixel under the minimum", () => {
    const problems = validateImages([player("a", "below-min.png")], dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain(`${MIN_IMAGE_EDGE - 1}×1500`);
  });

  it("measures the shortest edge, so a wide landscape can't pass on its width", () => {
    const problems = validateImages([player("a", "landscape-below-min.png")], dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain(`2000×${MIN_IMAGE_EDGE - 1}`);
  });

  it("accepts images between the minimum and the recommendation — warnings aren't problems", () => {
    for (const file of ["commons-1998.png", "under-recommended.png", "landscape-soft.png"]) {
      expect(validateImages([player("a", file)], dir), file).toEqual([]);
    }
  });

  it("catches an extreme aspect ratio", () => {
    const problems = validateImages([player("a", "wide.png")], dir);
    expect(problems.some((p) => p.message.includes(`${MAX_ASPECT_RATIO}:1`))).toBe(true);
  });

  it("catches an unreadable file", () => {
    const problems = validateImages([player("a", "broken.png")], dir);
    expect(problems.some((p) => p.message.includes("not a readable image"))).toBe(true);
  });

  it("catches two players sharing one image", () => {
    const problems = validateImages([player("a", "good.png"), player("b", "good.png")], dir);
    expect(problems.some((p) => p.message.includes("already used by a"))).toBe(true);
  });

  it("collects several problems for one image", () => {
    // small.png is both under the minimum and fine on aspect — only one problem.
    // wide.png is over the aspect limit but large enough — also one.
    expect(validateImages([player("a", "small.png"), player("b", "wide.png")], dir)).toHaveLength(
      2,
    );
  });
});

describe("imageSizeWarnings", () => {
  const warnedFiles = (...files: string[]) =>
    imageSizeWarnings(
      files.map((f, i) => player(`p${i}`, f)),
      dir,
    ).map((w) => w.file);

  it("warns on images from the minimum up to just under the recommendation", () => {
    expect(warnedFiles("at-min.png", "commons-1998.png", "under-recommended.png")).toEqual([
      "at-min.png",
      "commons-1998.png",
      "under-recommended.png",
    ]);
  });

  it("measures the shortest edge, so a wide landscape is warned on its height", () => {
    expect(warnedFiles("landscape-soft.png")).toEqual(["landscape-soft.png"]);
  });

  it("does not warn at or above the recommendation", () => {
    expect(warnedFiles("at-recommended.png", "commons-2003.png", "good.png")).toEqual([]);
  });

  it("leaves failures to validateImages rather than downgrading them to warnings", () => {
    expect(warnedFiles("below-min.png", "small.png", "nope.png", "broken.png")).toEqual([]);
  });

  it("ignores players without an image", () => {
    expect(imageSizeWarnings([player("a")], dir)).toEqual([]);
  });

  it("reports who, which file and its size", () => {
    expect(imageSizeWarnings([player("pirlo", "commons-1998.png")], dir)).toEqual([
      { playerId: "pirlo", file: "commons-1998.png", width: 1100, height: 1375 },
    ]);
  });
});

describe("formatImageWarnings", () => {
  it("says nothing when there is nothing to upgrade", () => {
    expect(formatImageWarnings([])).toEqual([]);
  });

  it("lists every image with the upgrade advice", () => {
    const lines = formatImageWarnings([
      { playerId: "pirlo", file: "pirlo.jpg", width: 1100, height: 1375 },
      { playerId: "cafu", file: "cafu.jpg", width: 1500, height: 900 },
    ]);
    expect(lines[0]).toBe(
      `2 image(s) under ${RECOMMENDED_IMAGE_EDGE}px on the shortest edge — ` +
        "usable, upgrade if a larger free image exists:",
    );
    expect(lines.slice(1)).toEqual([
      "  pirlo: pirlo.jpg (1100×1375)",
      "  cafu: cafu.jpg (1500×900)",
    ]);
  });
});

describe("orphanedImages", () => {
  it("finds files no player references", () => {
    const orphans = orphanedImages([player("a", "good.png")], ["good.png", "orphan.png"]);
    expect(orphans).toEqual(["orphan.png"]);
  });

  it("finds nothing when every file is used", () => {
    expect(orphanedImages([player("a", "good.png")], ["good.png"])).toEqual([]);
  });
});
