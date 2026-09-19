import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_ASPECT_RATIO, MIN_IMAGE_EDGE, orphanedImages, validateImages } from "../images.js";
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

  it("catches an image below the retina minimum", () => {
    const problems = validateImages([player("a", "small.png")], dir);
    expect(problems.some((p) => p.message.includes(String(MIN_IMAGE_EDGE)))).toBe(true);
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

describe("orphanedImages", () => {
  it("finds files no player references", () => {
    const orphans = orphanedImages([player("a", "good.png")], ["good.png", "orphan.png"]);
    expect(orphans).toEqual(["orphan.png"]);
  });

  it("finds nothing when every file is used", () => {
    expect(orphanedImages([player("a", "good.png")], ["good.png"])).toEqual([]);
  });
});
