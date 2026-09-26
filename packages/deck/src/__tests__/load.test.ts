import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requirePrivateError } from "../build.js";
import {
  DECK,
  MIN_PRIVATE_DECK,
  deckDirFor,
  fallbackNotice,
  imagesDirFor,
  loadDeck,
  loadDeckForSync,
  loadSampleDeck,
  manifestPathFor,
} from "../load.js";
import { runSync } from "../sync-cli.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Read directly, never through loadDeck: which deck loadDeck picks depends on
// how many players the private submodule holds on this machine. The choice
// itself is tested below on temp directories.
describe("the sample deck", () => {
  const deck = loadSampleDeck(packageRoot);

  it("parses every sample file without problems", () => {
    expect(deck.problems).toEqual([]);
    expect(deck.players.length).toBeGreaterThan(0);
  });

  it("loads in a stable order regardless of filesystem ordering", () => {
    const again = loadSampleDeck(packageRoot);
    expect(again.players.map((p) => p.id)).toEqual(deck.players.map((p) => p.id));
  });

  it("produces engine-shaped players", () => {
    const withIg = deck.players.find((p) => p.stats.ig !== undefined);
    expect(withIg?.stats.ig?.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("minimum private deck size", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  const player = (id: string): string =>
    [
      `id: ${id}`,
      `name: Player ${id}`,
      "country: Testland",
      "position: FW",
      "dob: 1980-01-01",
      "stats:",
      "  club_goals: 300",
      "  caps: 90",
      "  apps: 500",
    ].join("\n");

  /**
   * A deck root with a two-player sample and `valid` good private players, in
   * the `<source>/<DECK>/players/` layout. With `valid` and `broken` both zero
   * the private deck folder isn't created at all — the submodule's state before
   * `data/legends/` exists.
   */
  function makeRoot(valid: number, broken = 0): string {
    const root = mkdtempSync(join(tmpdir(), "bt-deck-"));
    roots.push(root);
    const samplePlayers = join(deckDirFor(root, "sample"), "players");
    const dataPlayers = join(deckDirFor(root, "data"), "players");
    mkdirSync(samplePlayers, { recursive: true });
    mkdirSync(join(root, "data"), { recursive: true });
    if (valid + broken > 0) mkdirSync(dataPlayers, { recursive: true });
    for (const id of ["sample-a", "sample-b"]) {
      writeFileSync(join(samplePlayers, `${id}.yaml`), player(id));
    }
    for (let i = 0; i < valid; i++) {
      writeFileSync(join(dataPlayers, `real-${i}.yaml`), player(`real-${i}`));
    }
    for (let i = 0; i < broken; i++) {
      writeFileSync(join(dataPlayers, `broken-${i}.yaml`), "id: broken\nname: 7\n");
    }
    return root;
  }

  describe("deck layout", () => {
    it("scopes every deck path by DECK", () => {
      const root = makeRoot(0);
      expect(DECK).toBe("legends");
      expect(deckDirFor(root, "data")).toBe(join(root, "data", "legends"));
      expect(imagesDirFor(root, "data")).toBe(join(root, "data", "legends", "originals"));
      expect(manifestPathFor(root, "sample")).toBe(join(root, "sample", "legends", "images.json"));
    });

    it("falls back to the sample while data/legends/ doesn't exist yet", () => {
      const root = makeRoot(0);
      expect(loadDeck(root).source).toBe("sample");
      expect(loadDeckForSync(root).source).toBe("sample");
      expect(loadDeck(root).problems).toEqual([]);
    });

    it("ignores players left at the pre-deck location data/players/", () => {
      const root = makeRoot(0);
      const legacy = join(root, "data", "players");
      mkdirSync(legacy, { recursive: true });
      for (let i = 0; i < MIN_PRIVATE_DECK; i++) {
        writeFileSync(join(legacy, `old-${i}.yaml`), player(`old-${i}`));
      }
      expect(loadDeck(root).source).toBe("sample");
      expect(loadDeckForSync(root).source).toBe("sample");
    });
  });

  it("falls back to the sample when the private deck is empty", () => {
    const deck = loadDeck(makeRoot(0));
    expect(deck.source).toBe("sample");
    expect(deck.privateCount).toBe(0);
    expect(fallbackNotice(deck)).toBe(
      `using sample deck — private deck has 0 of ${MIN_PRIVATE_DECK} players needed`,
    );
  });

  it("falls back while the private deck is below the minimum", () => {
    const deck = loadDeck(makeRoot(7));
    expect(deck.source).toBe("sample");
    expect(deck.players.map((p) => p.id)).toEqual(["sample-a", "sample-b"]);
    expect(fallbackNotice(deck)).toBe(
      `using sample deck — private deck has 7 of ${MIN_PRIVATE_DECK} players needed`,
    );
  });

  it("uses the private deck once it reaches the minimum", () => {
    const deck = loadDeck(makeRoot(MIN_PRIVATE_DECK));
    expect(deck.source).toBe("data");
    expect(deck.players).toHaveLength(MIN_PRIVATE_DECK);
    expect(fallbackNotice(deck)).toBeUndefined();
  });

  it("counts only schema-valid players toward the minimum", () => {
    const deck = loadDeck(makeRoot(MIN_PRIVATE_DECK - 1, 2));
    expect(deck.source).toBe("sample");
    expect(deck.privateCount).toBe(MIN_PRIVATE_DECK - 1);
  });

  it("surfaces the private deck's problems without failing on them while unused", () => {
    const deck = loadDeck(makeRoot(3, 1));
    expect(deck.problems).toEqual([]);
    expect(deck.privateProblems.some((p) => p.startsWith("broken-0.yaml"))).toBe(true);
  });

  it("reports the private deck's problems as real problems once it is in use", () => {
    const deck = loadDeck(makeRoot(MIN_PRIVATE_DECK, 1));
    expect(deck.source).toBe("data");
    expect(deck.problems.some((p) => p.startsWith("broken-0.yaml"))).toBe(true);
    expect(deck.privateProblems).toEqual([]);
  });

  describe("for images:sync", () => {
    it("uses the private deck as soon as it has one player, ignoring the minimum", () => {
      const root = makeRoot(1);
      const deck = loadDeckForSync(root);
      expect(deck.source).toBe("data");
      expect(deck.players.map((p) => p.id)).toEqual(["real-0"]);
      // The build, meanwhile, still falls back for the same deck.
      expect(loadDeck(root).source).toBe("sample");
    });

    it("falls back to the sample only when the private deck is empty", () => {
      expect(loadDeckForSync(makeRoot(0)).source).toBe("sample");
    });

    it("stays on a private deck whose files are all broken, reporting them", () => {
      const deck = loadDeckForSync(makeRoot(0, 2));
      expect(deck.source).toBe("data");
      expect(deck.problems.length).toBeGreaterThan(0);
    });

    it("makes runSync write to the private deck's manifest", async () => {
      const root = makeRoot(3);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        expect(await runSync(["--dry-run"], root)).toBe(0);
        const lines = log.mock.calls.map((c) => String(c[0]));
        expect(lines).toContain(`  manifest ${join(root, "data", "legends", "images.json")}`);
        expect(lines).toContain(`  sources  ${join(root, "data", "legends", "originals")}`);
      } finally {
        log.mockRestore();
      }
    });
  });

  it("points the image manifest at whichever deck was chosen", () => {
    const small = makeRoot(3);
    const full = makeRoot(MIN_PRIVATE_DECK);
    expect(manifestPathFor(small, loadDeck(small).source)).toBe(
      join(small, "sample", "legends", "images.json"),
    );
    expect(manifestPathFor(full, loadDeck(full).source)).toBe(
      join(full, "data", "legends", "images.json"),
    );
  });
});

describe("--require-private", () => {
  const sampleDeck = { source: "sample", privateCount: 7 } as const;
  const privateDeck = { source: "data", privateCount: 40 } as const;
  // Only the fields requirePrivateError reads; the rest of LoadedDeck is irrelevant here.
  const as = (d: object) => d as Parameters<typeof requirePrivateError>[0];

  it("refuses to build on the sample", () => {
    expect(requirePrivateError(as(sampleDeck), true)).toBe(
      `--require-private: the private deck has 7 of ${MIN_PRIVATE_DECK} valid players needed, ` +
        "and production never builds on the sample",
    );
  });

  it("allows the private deck", () => {
    expect(requirePrivateError(as(privateDeck), true)).toBeUndefined();
  });

  it("changes nothing when the flag is absent", () => {
    expect(requirePrivateError(as(sampleDeck), false)).toBeUndefined();
  });
});
