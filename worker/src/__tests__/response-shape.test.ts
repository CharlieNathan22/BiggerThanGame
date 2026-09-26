/**
 * The response-shape test. ARCHITECTURE.md §4, invariant 1.
 *
 * The endpoint must return the anchor's value and never the challenger's, and
 * must never serialise a `Player`. A `Round` from `buildRun` carries both
 * players whole, so one careless `return round` leaks everything while still
 * typechecking. This walks many complete runs and inspects every response
 * three ways: key whitelists, a whitelist of where numbers may appear, and the
 * deck's own leak scanner as a backstop.
 */

import { describe, expect, it } from "vitest";
import { STATS, valueOf } from "@bt/core";
import type { AnswerResponse, Player, RoundPayload, StartResponse } from "@bt/core";
import { scanForLeakedValues } from "@bt/deck";
import { runDate } from "../run-id.js";
import { FIXTURE_DECK, SAMPLE_DECK, context, fakeImages, walkRun } from "./helpers.js";

const CARD_KEYS = ["country", "id", "image", "name", "position"];
const ANCHOR_KEYS = [...CARD_KEYS, "display", "qualifier", "value"];
const STAT_KEYS = ["key", "label", "statChanged", "tier"];
const ROUND_KEYS = ["anchor", "challenger", "index", "stat"];
const REVEAL_KEYS = ["correct", "display", "qualifier", "round", "value"];
const IMAGE_KEYS = ["height", "key", "width"];

/** Where a number may legitimately appear. Anything else is a leak. */
const NUMERIC_PATHS = [
  /^(round|next)\.index$/,
  /^(round|next)\.anchor\.value$/,
  /^(round|next)\.(anchor|challenger)\.image\.(width|height)$/,
  /^reveal\.(round|value)$/,
];

/** Fields that carry values the player has been shown, stripped before the scan. */
const SHOWN_FIELDS = new Set([
  "value",
  "display",
  "qualifier",
  "index",
  "round",
  "width",
  "height",
  "key",
  "runId",
]);

function numericLeaves(value: unknown, path = ""): { path: string; value: number }[] {
  if (typeof value === "number") return [{ path, value }];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) =>
    numericLeaves(v, path === "" ? k : `${path}.${k}`),
  );
}

function allKeys(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => [k, ...allKeys(v)]);
}

function expectKeysWithin(obj: object, allowed: readonly string[]): void {
  for (const key of Object.keys(obj)) expect(allowed).toContain(key);
}

function checkRound(round: RoundPayload, deck: readonly Player[], now: Date): void {
  expectKeysWithin(round, ROUND_KEYS);
  expectKeysWithin(round.stat, STAT_KEYS);
  expectKeysWithin(round.anchor, ANCHOR_KEYS);
  expectKeysWithin(round.challenger, CARD_KEYS);
  if (round.anchor.image) expectKeysWithin(round.anchor.image, IMAGE_KEYS);
  if (round.challenger.image) expectKeysWithin(round.challenger.image, IMAGE_KEYS);

  // The anchor's value is the true one, and formatted by the shared formatter.
  const anchor = deck.find((p) => p.id === round.anchor.id)!;
  const truth = valueOf(anchor, round.stat.key, now)!;
  expect(round.anchor.value).toBe(truth);
  expect(round.anchor.display).toBe(STATS[round.stat.key].format(truth));

  // The challenger carries nothing stat-derived at all.
  expect(round.challenger).not.toHaveProperty("value");
  expect(round.challenger).not.toHaveProperty("display");
  expect(round.challenger).not.toHaveProperty("qualifier");
}

function checkResponse(
  response: StartResponse | AnswerResponse,
  deck: readonly Player[],
  now: Date,
): void {
  // No Player, whole or partial, anywhere in the response.
  const keys = allKeys(response);
  const playerKeys = ["stats", "dob", "deceased", "iconic", "era", "leagues"];
  const themedKeys = ["mainClubs", "main_clubs"];
  // Image focus is display data, but it reaches the payload in M4 with the CSS
  // that uses it, not before.
  const focusKeys = ["focus", "imageFocus"];
  for (const forbidden of [...playerKeys, ...themedKeys, ...focusKeys, "band", "relaxation"]) {
    expect(keys).not.toContain(forbidden);
  }

  // Numbers only where the anchor's value, the revealed value and layout live.
  for (const leaf of numericLeaves(response)) {
    expect(
      NUMERIC_PATHS.some((p) => p.test(leaf.path)),
      `number at ${leaf.path}`,
    ).toBe(true);
  }

  // Backstop: with every shown field removed, the scanner finds no deck value.
  const stripped = JSON.stringify(response, (k, v: unknown) => (SHOWN_FIELDS.has(k) ? null : v));
  expect(scanForLeakedValues(stripped, deck, now, "round response")).toEqual([]);

  if ("round" in response) {
    checkRound(response.round, deck, now);
  } else {
    expectKeysWithin(response, ["end", "next", "reveal"]);
    expectKeysWithin(response.reveal, REVEAL_KEYS);
    if ("next" in response) checkRound(response.next, deck, now);
  }
}

describe.each([
  { name: "sample deck", deck: SAMPLE_DECK, runs: 40 },
  { name: "fixture deck", deck: FIXTURE_DECK, runs: 20 },
])("round responses on the $name", ({ deck, runs }) => {
  it(`never carry a hidden value across ${runs} complete runs`, async () => {
    let responses = 0;
    for (let i = 0; i < runs; i++) {
      const { runId, started, answers } = await walkRun(context({ deck }), deck);
      const now = runDate(runId)!;
      for (const response of [started, ...answers]) {
        checkResponse(response, deck, now);
        responses += 1;
      }
    }
    expect(responses).toBeGreaterThan(runs);
  });

  it("keep the image path clean when every player has a photo", async () => {
    const images = fakeImages(deck);
    for (let i = 0; i < 5; i++) {
      const { runId, started, answers } = await walkRun(context({ deck, images }), deck);
      const now = runDate(runId)!;
      expect(started.round.challenger.image).toEqual(images[started.round.challenger.id]);
      for (const response of [started, ...answers]) checkResponse(response, deck, now);
    }
  });
});

describe("the checks themselves", () => {
  // A response-shape test that can't fail proves nothing. Feed it the leak it
  // exists to catch and make sure it does.
  it("fail on a challenger that carries its value", async () => {
    const { runId, started } = await walkRun(context());
    const now = runDate(runId)!;
    const leaky = {
      ...started,
      round: { ...started.round, challenger: { ...started.round.challenger, value: 1 } },
    };
    expect(() => checkResponse(leaky as StartResponse, SAMPLE_DECK, now)).toThrow();
  });

  it("fail on an image focus, until M4 adds it on purpose", async () => {
    const { runId, started } = await walkRun(context());
    const now = runDate(runId)!;
    const image = { key: "legends/originals/x.jpg", width: 800, height: 1000, focus: "50 15" };
    const leaky = {
      ...started,
      round: { ...started.round, challenger: { ...started.round.challenger, image } },
    };
    expect(() => checkResponse(leaky as StartResponse, SAMPLE_DECK, now)).toThrow();
  });

  it("fail on a serialised Player", async () => {
    const { runId, started } = await walkRun(context());
    const now = runDate(runId)!;
    const player = SAMPLE_DECK.find((p) => p.id === started.round.challenger.id)!;
    const leaky = { ...started, round: { ...started.round, challenger: player } };
    expect(() => checkResponse(leaky as unknown as StartResponse, SAMPLE_DECK, now)).toThrow();
  });
});
