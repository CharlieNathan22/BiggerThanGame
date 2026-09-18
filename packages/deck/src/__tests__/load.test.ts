import { describe, expect, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeck } from "../load.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("loadDeck", () => {
  const deck = loadDeck(packageRoot);

  it("falls back to the sample when the private submodule is empty", () => {
    expect(deck.source).toBe("sample");
  });

  it("parses every sample file without problems", () => {
    expect(deck.problems).toEqual([]);
    expect(deck.players.length).toBeGreaterThan(0);
  });

  it("loads in a stable order regardless of filesystem ordering", () => {
    const again = loadDeck(packageRoot);
    expect(again.players.map((p) => p.id)).toEqual(deck.players.map((p) => p.id));
  });

  it("produces engine-shaped players", () => {
    const withIg = deck.players.find((p) => p.stats.ig !== undefined);
    expect(withIg?.stats.ig?.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
