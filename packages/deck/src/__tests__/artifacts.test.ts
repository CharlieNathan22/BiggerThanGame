import { describe, expect, it } from "vitest";
import {
  buildCredits,
  buildFullDeck,
  buildImages,
  buildIndexes,
  scanForLeakedValues,
} from "../artifacts.js";
import type { Manifest } from "../manifest.js";
import { playerSchema, toPlayer } from "../schema.js";
import type { Player } from "@bt/core";

const NOW = new Date("2026-09-18T07:38:18.000Z");

const raws = [
  {
    id: "one",
    name: "One",
    country: "T",
    position: "FW",
    dob: "1985-06-15",
    stats: { club_goals: 400, caps: 100, apps: 600, igoals: 50 },
  },
  {
    id: "two",
    name: "Two",
    country: "T",
    position: "MF",
    dob: "1988-01-01",
    stats: { club_goals: 200, caps: 100, apps: 500, igoals: 25 },
    image: {
      file: "two.jpg",
      author: "A Snapper",
      licence: "CC-BY-4.0",
      source: "https://example.com/two",
    },
  },
  {
    id: "three",
    name: "Three",
    country: "T",
    position: "DF",
    dob: "1990-01-01",
    stats: { club_goals: 20, caps: 40, apps: 450, igoals: 2 },
  },
].map((r) => playerSchema.parse(r));

const players: Player[] = raws.map(toPlayer);

describe("buildFullDeck", () => {
  it("includes every player and their eligibility", () => {
    const full = buildFullDeck(players, NOW);
    expect(full.players).toHaveLength(3);
    expect(full.eligibility.one).toContain("club_goals");
  });
});

describe("buildIndexes", () => {
  it("sorts ascending by value", () => {
    const { sorted } = buildIndexes(players, NOW);
    expect(sorted.club_goals).toEqual(["three", "two", "one"]);
  });

  it("groups tied values", () => {
    const { ties } = buildIndexes(players, NOW);
    expect(ties.caps).toEqual([["one", "two"]]);
  });

  it("reports no ties where values are distinct", () => {
    const { ties } = buildIndexes(players, NOW);
    expect(ties.club_goals).toEqual([]);
  });

  it("omits players with no value for a stat", () => {
    const gk = toPlayer(
      playerSchema.parse({
        id: "keeper",
        name: "Keeper",
        country: "T",
        position: "GK",
        dob: "1980-01-01",
        stats: { caps: 90, apps: 700, ct: 5 },
      }),
    );
    const { sorted } = buildIndexes([...players, gk], NOW);
    expect(sorted.club_goals).not.toContain("keeper");
  });
});

describe("buildCredits", () => {
  it("includes only players with an image", () => {
    const credits = buildCredits(raws);
    expect(credits).toHaveLength(1);
    expect(credits[0]?.playerId).toBe("two");
    expect(credits[0]?.licence).toBe("CC-BY-4.0");
  });

  it("carries the player's name for the credits page", () => {
    expect(buildCredits(raws)[0]?.name).toBe("Two");
  });

  describe("licence links", () => {
    const withLicence = (id: string, licence: string) =>
      playerSchema.parse({
        id,
        name: id,
        country: "T",
        position: "FW",
        dob: "1980-01-01",
        stats: { club_goals: 100, caps: 50, apps: 300 },
        image: {
          file: `${id}.jpg`,
          author: "A Snapper",
          licence,
          source: `https://commons.wikimedia.org/wiki/File:${id}.jpg`,
        },
      });

    it("links an unported licence", () => {
      expect(buildCredits(raws)[0]?.licenceUrl).toBe(
        "https://creativecommons.org/licenses/by/4.0/",
      );
    });

    it("links a jurisdiction port to its own legal text", () => {
      const credits = buildCredits([
        withLicence("br", "CC-BY-3.0-BR"),
        withLicence("es", "CC-BY-SA-2.5-ES"),
      ]);
      expect(credits.map((c) => [c.licence, c.licenceUrl])).toEqual([
        ["CC-BY-3.0-BR", "https://creativecommons.org/licenses/by/3.0/br/"],
        ["CC-BY-SA-2.5-ES", "https://creativecommons.org/licenses/by-sa/2.5/es/"],
      ]);
    });

    it("omits the link for public domain rather than inventing one", () => {
      const [credit] = buildCredits([withLicence("pd", "PD")]);
      expect(credit?.licence).toBe("PD");
      expect(credit).not.toHaveProperty("licenceUrl");
    });
  });
});

describe("buildImages", () => {
  const manifest: Manifest = {
    version: 1,
    generatedAt: NOW.toISOString(),
    entries: {
      two: {
        key: "legends/originals/two.0123456789abcdef.jpg",
        width: 1600,
        height: 2000,
        sourceSha256: "f".repeat(64),
      },
      departed: {
        key: "legends/originals/departed.fedcba9876543210.jpg",
        width: 1600,
        height: 1600,
        sourceSha256: "e".repeat(64),
      },
    },
  };

  it("maps each deck player with a synced photo to its PlayerImage", () => {
    expect(buildImages(players, manifest)).toEqual({
      two: { key: "legends/originals/two.0123456789abcdef.jpg", width: 1600, height: 2000 },
    });
  });

  it("leaves the source hash behind", () => {
    expect(JSON.stringify(buildImages(players, manifest))).not.toContain("sourceSha256");
  });

  it("ignores manifest entries for players not in the deck", () => {
    expect(buildImages(players, manifest)).not.toHaveProperty("departed");
  });
});

describe("scanForLeakedValues", () => {
  it("passes text with no stat values in it", () => {
    const safe = JSON.stringify({ generatedAt: NOW.toISOString(), names: ["One", "Two"] });
    expect(scanForLeakedValues(safe, players, NOW)).toEqual([]);
  });

  it("is not fooled by digits in a timestamp", () => {
    // NOW is 07:38:18 — "38" and "18" appear in the ISO string. A player with
    // those as real values must not trigger a false positive.
    const tricky = toPlayer(
      playerSchema.parse({
        id: "tricky",
        name: "Tricky",
        country: "T",
        position: "FW",
        dob: "1990-01-01",
        stats: { club_goals: 38, caps: 18, apps: 380 },
      }),
    );
    const all = [...players, tricky];
    const text = JSON.stringify({ generatedAt: NOW.toISOString(), players: [] });
    expect(scanForLeakedValues(text, all, NOW)).toEqual([]);
  });

  it("catches a value anywhere in the text, whatever the shape", () => {
    const leaky = JSON.stringify({ debug: { topScorer: 400 } });
    const problems = scanForLeakedValues(leaky, players, NOW);
    expect(problems.some((p) => p.includes("400"))).toBe(true);
  });

  it("catches values in a JavaScript bundle, not just JSON", () => {
    // The Phase 3 case: someone imports deck.full.json into a component.
    const bundle = `const d=[{id:"one",club_goals:400,caps:100}];export default d;`;
    const problems = scanForLeakedValues(bundle, players, NOW, "apps/web/dist");
    expect(problems.some((p) => p.includes("400"))).toBe(true);
    expect(problems[0]).toContain("apps/web/dist");
  });

  it("catches a whole player object serialised out", () => {
    const problems = scanForLeakedValues(JSON.stringify(players), players, NOW);
    expect(problems.length).toBeGreaterThan(0);
  });

  it("does not match a value inside a longer number", () => {
    // 400 must not match inside 1400.
    expect(scanForLeakedValues(JSON.stringify({ note: 1400 }), players, NOW)).toEqual([]);
  });

  it("ignores values below the threshold as too ambiguous", () => {
    const small = toPlayer(
      playerSchema.parse({
        id: "small",
        name: "Small",
        country: "T",
        position: "FW",
        dob: "1990-01-01",
        stats: { club_goals: 2, caps: 3, apps: 400 },
      }),
    );
    // A bare 2 and 3 must not be accused, even though they are real values.
    expect(scanForLeakedValues("[1,2,3]", [small], NOW)).toEqual([]);
  });
});
