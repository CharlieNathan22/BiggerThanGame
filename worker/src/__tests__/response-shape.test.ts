/**
 * The response-shape test. ARCHITECTURE.md §4, invariant 1.
 *
 * The endpoint must return the anchor's value and never the challenger's, and
 * must never serialise a `Player`. A `Round` from `buildRun` carries both
 * players whole, so one careless `return round` leaks everything while still
 * typechecking. This walks many complete runs and inspects every response
 * three ways: key whitelists, a whitelist of where numbers may appear, and the
 * deck's own leak scanner as a backstop.
 *
 * 1v1's rooms send messages rather than responses, and are held to the same:
 * every message to every seat, across whole matches, with the two things a
 * room hides until a reveal (the challenger's figure, and the players' picks).
 */

import { describe, expect, it } from "vitest";
import { STATS, WIN_ROUNDS, isSquadVariantId, valueOf } from "@bt/core";
import type {
  AnswerResponse,
  GuessResponse,
  NamedVariant,
  Player,
  RoomQuestion,
  RoomServerMessage,
  RoundPayload,
  RunStartResponse,
  StartResponse,
  StreamGuessResponse,
  StreamStartResponse,
} from "@bt/core";
import { scanForLeakedValues } from "@bt/deck";
import {
  FIXTURE_DECK,
  SAMPLE_DECK,
  THEMED_DECK,
  context,
  fakeImages,
  runDay,
  walkRun,
} from "./helpers.js";
import { begin, harness, readToken, walk } from "./endless-helpers.js";
import type { Ending } from "./endless-helpers.js";
import {
  matchDay,
  openRoom,
  playMatch as playRoomMatch,
  roomHarness,
  startMatch as startRoomMatch,
} from "./room-helpers.js";
import type { Sent, Way } from "./room-helpers.js";
import { playMatch, readStreamToken, startMatch, streamHarness } from "./stream-helpers.js";
import type { StreamAnswer } from "./stream-helpers.js";

const CARD_KEYS = ["country", "id", "image", "name", "position"];
const ANCHOR_KEYS = [...CARD_KEYS, "display", "qualifier", "value"];
const STAT_KEYS = ["key", "label", "statChanged", "tier"];
const ROUND_KEYS = ["anchor", "challenger", "index", "stat", "upcoming"];
const REVEAL_KEYS = ["correct", "display", "qualifier", "round", "value"];
const IMAGE_KEYS = ["focus", "height", "key", "width"];

/** Where a number may legitimately appear. Anything else is a leak. */
const NUMERIC_PATHS = [
  /^(round|next)\.index$/,
  /^(round|next)\.anchor\.value$/,
  /^(round|next)\.(anchor|challenger)\.image\.(width|height)$/,
  // The next round's challenger's photo, so it loads a round early.
  /^(round|next)\.upcoming\.(width|height)$/,
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
  "focus",
  // The challenge link: the player's own score and a signature over it.
  "score",
  "sig",
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
  // The upcoming challenger travels as a photo only: no name, id, value or qualifier.
  if (round.upcoming) {
    expectKeysWithin(round.upcoming, IMAGE_KEYS);
    expect(Object.keys(round.upcoming)).toEqual(expect.arrayContaining(["key", "width", "height"]));
  }

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
  for (const forbidden of [...playerKeys, ...themedKeys, "band", "relaxation"]) {
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
    // Challenge links are off in Friendly: no end carries one.
    expectKeysWithin(response, ["end", "next", "reveal"]);
    expectKeysWithin(response.reveal, REVEAL_KEYS);
    // Friendly never deals past its twentieth round, and never scores past it.
    expect(response.reveal.round).toBeLessThanOrEqual(WIN_ROUNDS.friendly!);
    if ("end" in response) {
      expect(["wrong", "deck-exhausted", "won"]).toContain(response.end);
      expect(response).not.toHaveProperty("challenge");
      // A run is won exactly when its twentieth round is answered correctly.
      const lastRight = response.reveal.correct && response.reveal.round === WIN_ROUNDS.friendly;
      expect(response.end === "won").toBe(lastRight);
      expect(response.end === "wrong").toBe(!response.reveal.correct);
    }
    if ("next" in response) {
      checkRound(response.next, deck, now);
      expect(response.next.index).toBeLessThanOrEqual(WIN_ROUNDS.friendly!);
      // The last round deals no photo for a round that will never come.
      if (response.next.index === WIN_ROUNDS.friendly) {
        expect(response.next).not.toHaveProperty("upcoming");
      }
    }
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
      const now = runDay(runId);
      for (const response of [started, ...answers]) {
        checkResponse(response, deck, now);
        responses += 1;
      }
    }
    expect(responses).toBeGreaterThan(runs);
    // Forty full runs, each scanned against the deck: seconds, not milliseconds.
  }, 30_000);

  it("carry a photo's focus with the photo, and only there", async () => {
    // Every other player gets a crop focus, so runs meet both kinds.
    const focused = deck.map((p, i) => (i % 2 === 0 ? { ...p, imageFocus: `50 ${i % 100}` } : p));
    const images = fakeImages(focused);
    let withFocus = 0;
    for (let i = 0; i < 5; i++) {
      const { runId, started, answers } = await walkRun(
        context({ deck: focused, images }),
        focused,
      );
      const now = runDay(runId);
      for (const response of [started, ...answers]) {
        checkResponse(response, focused, now);
        const round =
          "round" in response ? response.round : "next" in response ? response.next : null;
        for (const card of round ? [round.anchor, round.challenger] : []) {
          const player = focused.find((p) => p.id === card.id)!;
          expect(card.image?.focus).toBe(player.imageFocus);
          if (card.image?.focus !== undefined) withFocus++;
        }
      }
    }
    expect(withFocus).toBeGreaterThan(0);
  });

  it("leave focus out when a player has one but no photo", async () => {
    const focused = deck.map((p) => ({ ...p, imageFocus: "50 10" }));
    const { started } = await walkRun(context({ deck: focused }), focused);
    expect(started.round.challenger).not.toHaveProperty("image");
    expect(JSON.stringify(started)).not.toContain("focus");
  });

  it("carry the next round's challenger's photo as upcoming, and none on the last round", async () => {
    const images = fakeImages(deck);
    for (let i = 0; i < 5; i++) {
      const { runId, started, answers } = await walkRun(context({ deck, images }), deck);
      const now = runDay(runId);
      const rounds = [started.round, ...answers.flatMap((a) => ("next" in a ? [a.next] : []))];
      rounds.forEach((round, n) => {
        const following = rounds[n + 1];
        if (following === undefined) expect(round).not.toHaveProperty("upcoming");
        else expect(round.upcoming).toEqual(following.challenger.image);
      });
      for (const response of [started, ...answers]) checkResponse(response, deck, now);
    }
  });

  it("leave upcoming out when that player has no photo", async () => {
    // Photos for every other player only.
    const images = fakeImages(deck.filter((_, i) => i % 2 === 0));
    const { runId, started, answers } = await walkRun(context({ deck, images }), deck);
    const now = runDay(runId);
    const rounds = [started.round, ...answers.flatMap((a) => ("next" in a ? [a.next] : []))];
    rounds.slice(0, -1).forEach((round, n) => {
      expect(round.upcoming).toEqual(rounds[n + 1]?.challenger.image);
    });
    expect(rounds.some((r) => r.upcoming === undefined)).toBe(true);
    for (const response of [started, ...answers]) checkResponse(response, deck, now);
  });

  it("keep the image path clean when every player has a photo", async () => {
    const images = fakeImages(deck);
    for (let i = 0; i < 5; i++) {
      const { runId, started, answers } = await walkRun(context({ deck, images }), deck);
      const now = runDay(runId);
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
    const now = runDay(runId);
    const leaky = {
      ...started,
      round: { ...started.round, challenger: { ...started.round.challenger, value: 1 } },
    };
    expect(() => checkResponse(leaky as StartResponse, SAMPLE_DECK, now)).toThrow();
  });

  it("fail on a focus outside the image", async () => {
    const { runId, started } = await walkRun(context());
    const now = runDay(runId);
    const leaky = {
      ...started,
      round: { ...started.round, challenger: { ...started.round.challenger, focus: "50 15" } },
    };
    expect(() => checkResponse(leaky as StartResponse, SAMPLE_DECK, now)).toThrow();
  });

  it("fail on an upcoming photo that brings its player's name or value", async () => {
    const { runId, started } = await walkRun(context({ images: fakeImages(SAMPLE_DECK) }));
    const now = runDay(runId);
    const upcoming = started.round.upcoming!;
    for (const extra of [{ name: "Anyone" }, { id: "x" }, { value: 1 }, { qualifier: "2001" }]) {
      const leaky = {
        ...started,
        round: { ...started.round, upcoming: { ...upcoming, ...extra } },
      };
      expect(() => checkResponse(leaky as StartResponse, SAMPLE_DECK, now)).toThrow();
    }
  });

  it("fail on a serialised Player", async () => {
    const { runId, started } = await walkRun(context());
    const now = runDay(runId);
    const player = SAMPLE_DECK.find((p) => p.id === started.round.challenger.id)!;
    const leaky = { ...started, round: { ...started.round, challenger: player } };
    expect(() => checkResponse(leaky as unknown as StartResponse, SAMPLE_DECK, now)).toThrow();
  });
});

// ---------------------------------------------------------------- Endless

const ENDLESS_START_KEYS = ["challenge", "country", "round", "runId", "token"];
const ENDLESS_CONTINUE_KEYS = ["next", "reveal", "token"];
const ENDLESS_END_KEYS = ["challenge", "end", "result", "reveal"];
const TOKEN_KEYS = [
  "anchorId",
  "anchorValue",
  "challengerId",
  "deadline",
  "issuedAt",
  "mode",
  "nonce",
  "round",
  "runId",
  "stat",
  "streak",
  "v",
];

/** Numbers in an Endless response, beyond Friendly's: the score in its challenge link. */
const ENDLESS_NUMERIC_PATHS = [...NUMERIC_PATHS, /^challenge\.score$/];

/**
 * A progress token carries exactly its declared fields, and only what is on
 * screen: the anchor's figure, never the challenger's.
 */
function checkToken(token: string, round: RoundPayload, variant?: NamedVariant): void {
  const payload = readToken(token);
  // A variant's token names it; general Endless's has exactly the fields it always had.
  expect(Object.keys(payload).sort()).toEqual(
    variant === undefined ? TOKEN_KEYS : [...TOKEN_KEYS, "variant"].sort(),
  );
  expect(payload.variant).toBe(variant);
  expect(payload.round).toBe(round.index);
  expect(payload.streak).toBe(round.index - 1);
  expect(payload.stat).toBe(round.stat.key);
  expect(payload.anchorId).toBe(round.anchor.id);
  expect(payload.challengerId).toBe(round.challenger.id);
  expect(payload.anchorValue).toBe(round.anchor.value);
  // The only figure a token holds is the anchor's: every other number is the
  // round, the streak, the version or the server's timing.
  const numbers = numericLeaves(payload).map((l) => l.path);
  expect(numbers.sort()).toEqual(["anchorValue", "deadline", "issuedAt", "round", "streak", "v"]);
  expect(Object.keys(payload)).not.toContain("value");
}

function checkEndless(
  response: RunStartResponse | GuessResponse,
  deck: readonly Player[],
  now: Date,
  variant?: NamedVariant,
): void {
  const keys = allKeys(response);
  for (const forbidden of ["stats", "dob", "deceased", "iconic", "era", "leagues", "mainClubs"]) {
    expect(keys).not.toContain(forbidden);
  }
  for (const forbidden of ["band", "relaxation", "seed", "nonce", "deadline", "issuedAt"]) {
    expect(keys).not.toContain(forbidden);
  }
  for (const leaf of numericLeaves(response)) {
    expect(
      ENDLESS_NUMERIC_PATHS.some((p) => p.test(leaf.path)),
      `number at ${leaf.path}`,
    ).toBe(true);
  }
  const stripped = JSON.stringify(response, (k, v: unknown) =>
    SHOWN_FIELDS.has(k) || k === "token" || k === "result" ? null : v,
  );
  expect(scanForLeakedValues(stripped, deck, now, "endless response")).toEqual([]);

  if ("round" in response) {
    expectKeysWithin(response, ENDLESS_START_KEYS);
    checkRound(response.round, deck, now);
    checkToken(response.token, response.round, variant);
    return;
  }
  expectKeysWithin(response.reveal, REVEAL_KEYS);
  if ("next" in response) {
    expect(Object.keys(response).sort()).toEqual(ENDLESS_CONTINUE_KEYS);
    expect(response.reveal.correct).toBe(true);
    checkRound(response.next, deck, now);
    checkToken(response.token, response.next, variant);
  } else {
    expect(Object.keys(response).sort()).toEqual(ENDLESS_END_KEYS);
    // A squad is won by clearing it; every other Endless run runs until it's lost.
    const ends = isSquadVariantId(variant)
      ? ["wrong", "timeout", "won"]
      : ["wrong", "timeout", "deck-exhausted"];
    expect(ends).toContain(response.end);
    expect(Object.keys(response.challenge).sort()).toEqual(["runId", "score", "sig"]);
    expect(response.challenge.score).toBe(
      response.reveal.correct ? response.reveal.round : response.reveal.round - 1,
    );
    expect(typeof response.result).toBe("string");
  }
}

describe("Endless responses", () => {
  const endings: Ending[] = ["wrong", "timeout", "late"];

  it.each([
    { name: "sample deck", deck: SAMPLE_DECK, runs: 30, variant: undefined },
    { name: "fixture deck", deck: FIXTURE_DECK, runs: 15, variant: undefined },
    {
      name: "sample deck in Instagram Endless",
      deck: SAMPLE_DECK,
      runs: 20,
      variant: "endless-instagram" as const,
    },
    {
      name: "themed deck in a squad, cleared or not",
      deck: THEMED_DECK,
      runs: 20,
      variant: "squad:club-testfield" as const,
    },
  ])(
    "never carry a hidden value across $runs complete runs on the $name",
    async ({ deck, runs, variant }) => {
      let responses = 0;
      for (let i = 0; i < runs; i++) {
        const h = harness({ deck, images: fakeImages(deck) });
        const { started, answers } = await walk(h, {
          deck,
          stopAt: 1 + ((i * 7) % 25),
          ending: endings[i % endings.length]!,
          ...(variant !== undefined ? { variant } : {}),
        });
        const now = runDay(started.runId);
        for (const response of [started, ...answers]) {
          checkEndless(response, deck, now, variant);
          responses += 1;
        }
        expect("end" in answers.at(-1)!).toBe(true);
      }
      expect(responses).toBeGreaterThan(runs * 2);
    },
    60_000,
  );

  it("fail on a token that carries the challenger's figure", async () => {
    const h = harness();
    const started = await begin(h);
    const payload = { ...readToken(started.token), challengerValue: 1 };
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.x`;
    expect(() => checkToken(forged, started.round)).toThrow();
  });
});

// ------------------------------------------------------------ Twitch Mode

const STREAM_START_KEYS = ["limit", "questions", "round", "runId", "token"];
const STREAM_END_KEYS = ["end", "reveal", "score"];
const STREAM_TOKEN_KEYS = [
  "anchorId",
  "anchorValue",
  "challengerId",
  "correct",
  "deadline",
  "issuedAt",
  "limit",
  "mode",
  "nonce",
  "pool",
  "questions",
  "round",
  "runId",
  "stat",
  "v",
];

/** Numbers in a match's response, beyond Friendly's: its settings at the start, its score at the end. */
const STREAM_NUMERIC_PATHS = [...NUMERIC_PATHS, /^(questions|limit|score)$/];

const STREAM_SETTINGS = new Set(["questions", "limit", "score"]);

/** A match's token: exactly its fields, and of the figures only the anchor's. */
function checkStreamToken(token: string, round: RoundPayload): void {
  const payload = readStreamToken(token);
  expect(Object.keys(payload).sort()).toEqual(STREAM_TOKEN_KEYS);
  expect(payload.round).toBe(round.index);
  expect(payload.stat).toBe(round.stat.key);
  expect(payload.anchorId).toBe(round.anchor.id);
  expect(payload.challengerId).toBe(round.challenger.id);
  expect(payload.anchorValue).toBe(round.anchor.value);
  const numbers = numericLeaves(payload).map((l) => l.path);
  expect(numbers.sort()).toEqual([
    "anchorValue",
    "correct",
    "deadline",
    "issuedAt",
    "limit",
    "questions",
    "round",
    "v",
  ]);
}

function checkStream(
  response: StreamStartResponse | StreamGuessResponse,
  deck: readonly Player[],
  now: Date,
): void {
  const keys = allKeys(response);
  for (const forbidden of ["stats", "dob", "deceased", "iconic", "era", "leagues", "mainClubs"]) {
    expect(keys).not.toContain(forbidden);
  }
  for (const forbidden of ["band", "relaxation", "seed", "nonce", "deadline", "issuedAt"]) {
    expect(keys).not.toContain(forbidden);
  }
  for (const leaf of numericLeaves(response)) {
    expect(
      STREAM_NUMERIC_PATHS.some((p) => p.test(leaf.path)),
      `number at ${leaf.path}`,
    ).toBe(true);
  }
  const stripped = JSON.stringify(response, (k, v: unknown) =>
    // The match's own settings and the streamer's score: numbers, but never a figure.
    SHOWN_FIELDS.has(k) || k === "token" || STREAM_SETTINGS.has(k) ? null : v,
  );
  expect(scanForLeakedValues(stripped, deck, now, "stream response")).toEqual([]);

  if ("round" in response) {
    expect(Object.keys(response).sort()).toEqual(STREAM_START_KEYS);
    checkRound(response.round, deck, now);
    checkStreamToken(response.token, response.round);
    return;
  }
  expectKeysWithin(response.reveal, REVEAL_KEYS);
  if ("next" in response) {
    expect(Object.keys(response).sort()).toEqual(ENDLESS_CONTINUE_KEYS);
    checkRound(response.next, deck, now);
    checkStreamToken(response.token, response.next);
  } else {
    expect(Object.keys(response).sort()).toEqual(STREAM_END_KEYS);
    expect(["finished", "deck-exhausted"]).toContain(response.end);
  }
}

describe("Twitch Mode responses", () => {
  const ways: StreamAnswer[] = ["right", "wrong", "timeout", "late"];

  it.each([
    { name: "sample deck, All legends", deck: SAMPLE_DECK, pool: "endless" as const },
    { name: "fixture deck, All legends", deck: FIXTURE_DECK, pool: "endless" as const },
    { name: "sample deck, Instagram", deck: SAMPLE_DECK, pool: "endless-instagram" as const },
    { name: "themed deck, a squad", deck: THEMED_DECK, pool: "squad:club-testfield" as const },
  ])(
    "never carry a hidden value across whole matches on the $name",
    async ({ deck, pool }) => {
      let responses = 0;
      for (let i = 0; i < 12; i++) {
        const h = streamHarness({ deck, images: fakeImages(deck) });
        const { started, answers } = await playMatch(h, {
          deck,
          pool,
          questions: i % 2 === 0 ? 10 : 20,
          limit: ([10, 20, 30, 60] as const)[i % 4] ?? 30,
          answer: (round) => ways[(round + i) % ways.length]!,
        });
        const now = runDay(started.runId);
        for (const response of [started, ...answers]) {
          checkStream(response, deck, now);
          responses += 1;
        }
        expect("end" in answers.at(-1)!).toBe(true);
      }
      expect(responses).toBeGreaterThan(12 * 10);
    },
    60_000,
  );

  it("fail on a token that carries the challenger's figure", async () => {
    const h = streamHarness();
    const started = await startMatch(h);
    const payload = { ...readStreamToken(started.token), challengerValue: 1 };
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.x`;
    expect(() => checkStreamToken(forged, started.round)).toThrow();
  });
});

// ------------------------------------------------------------ 1v1 rooms

/** Every message a room sends, by type: exactly these keys (some optional). */
const ROOM_MESSAGE_KEYS: Readonly<Record<RoomServerMessage["t"], readonly string[]>> = {
  welcome: ["room", "t", "v", "you"],
  players: ["phase", "players", "t", "v"],
  question: ["question", "t", "v"],
  locked: ["seat", "t", "v"],
  reveal: ["correct", "end", "next", "picks", "reveal", "scores", "t", "v"],
  fulltime: ["players", "result", "series", "t", "v"],
  rematch: ["seats", "t", "v"],
  closed: ["reason", "t", "v"],
  error: ["code", "t", "v"],
};
const ROOM_QUESTION_KEYS = ["closesInMs", "limitMs", "match", "round", "suddenDeath"];
const ROOM_PLAYER_KEYS = ["connected", "left", "name", "ready", "rejoinInMs", "seat"];
const ROOM_RESULT_KEYS = ["left", "questions", "reason", "results", "scores", "winner"];
const ROOM_SNAPSHOT_KEYS = [
  "code",
  "locked",
  "match",
  "phase",
  "picked",
  "players",
  "question",
  "rematch",
  "result",
  "series",
  "settings",
];

/** A question, wherever a message carries one. */
const Q = String.raw`(question|next|room\.question)`;
const RESULT = String.raw`(result|end\.result|room\.result)`;
const SERIES = String.raw`(series|end\.series|room\.series)`;

/** Where a number may appear in a room's message. Anything else is a leak. */
const ROOM_NUMERIC_PATHS = [
  /^v$/,
  /^you$/,
  /^seat$/,
  /^seats\.\d+$/,
  new RegExp(`^${Q}\\.(match|limitMs|closesInMs)$`),
  new RegExp(`^${Q}\\.round\\.index$`),
  new RegExp(`^${Q}\\.round\\.anchor\\.value$`),
  new RegExp(`^${Q}\\.round\\.(anchor|challenger)\\.image\\.(width|height)$`),
  new RegExp(`^${Q}\\.round\\.upcoming\\.(width|height)$`),
  // Only a reveal carries the challenger's figure.
  /^reveal\.(round|value)$/,
  /^scores\.\d+$/,
  new RegExp(`^${RESULT}\\.(winner|questions|left|scores\\.\\d+)$`),
  new RegExp(`^${SERIES}\\.(draws|wins\\.\\d+)$`),
  /^(players|room\.players)\.\d+\.(seat|rejoinInMs)$/,
  /^room\.match\.(no|scores\.\d+)$/,
  /^room\.settings\.(questions|limit)$/,
  /^room\.(locked|rematch)\.\d+$/,
];

/** A room's own numbers: counts, seats and clocks, never a figure. Stripped before the scan. */
const ROOM_PLAIN = new Set([
  "v",
  "you",
  "seat",
  "seats",
  "match",
  "limitMs",
  "closesInMs",
  "scores",
  "winner",
  "questions",
  "left",
  "draws",
  "wins",
  "rejoinInMs",
  "no",
  "limit",
  "locked",
  "rematch",
]);

function checkRoomQuestion(question: RoomQuestion, deck: readonly Player[], now: Date): void {
  expect(Object.keys(question).sort()).toEqual(ROOM_QUESTION_KEYS);
  checkRound(question.round, deck, now);
}

/** One message as one seat got it. `secrets`: strings no message may contain. */
function checkRoomMessage(
  sent: Sent,
  deck: readonly Player[],
  now: Date,
  secrets: readonly string[],
): void {
  const { message, seat } = sent;
  expectKeysWithin(message, ROOM_MESSAGE_KEYS[message.t]);
  expect(message.v).toBe(1);

  const keys = allKeys(message);
  for (const forbidden of ["stats", "dob", "deceased", "iconic", "era", "leagues", "mainClubs"]) {
    expect(keys).not.toContain(forbidden);
  }
  for (const forbidden of [
    "band",
    "relaxation",
    "seed",
    "nonce",
    "deadline",
    "issuedAt",
    "answer",
    "token",
    "awaySince",
    "lastActivity",
  ]) {
    expect(keys).not.toContain(forbidden);
  }
  // Nothing a seed or a seat could be had from: the room's key, a match's id, a token, a player's id.
  const text = JSON.stringify(message);
  for (const secret of secrets) expect(text).not.toContain(secret);

  for (const leaf of numericLeaves(message)) {
    expect(
      ROOM_NUMERIC_PATHS.some((p) => p.test(leaf.path)),
      `number at ${leaf.path} in ${message.t}`,
    ).toBe(true);
  }
  const stripped = JSON.stringify(message, (k, v: unknown) =>
    SHOWN_FIELDS.has(k) || ROOM_PLAIN.has(k) ? null : v,
  );
  expect(scanForLeakedValues(stripped, deck, now, `room ${message.t}`)).toEqual([]);

  // Only a reveal says which way anyone went, or what the challenger had.
  if (message.t !== "reveal") {
    for (const hidden of ["picks", "correct", "reveal"]) expect(keys).not.toContain(hidden);
    const figures = keys.filter((k) => k === "value" || k === "display" || k === "qualifier");
    // A question's anchor shows its figure: one of each at most, and only inside a question.
    expect(figures.filter((k) => k === "value").length).toBeLessThanOrEqual(1);
    if (message.t !== "question" && message.t !== "welcome") expect(figures).toEqual([]);
  }

  switch (message.t) {
    case "question":
      checkRoomQuestion(message.question, deck, now);
      break;
    case "locked":
      expect(Object.keys(message).sort()).toEqual(["seat", "t", "v"]);
      break;
    case "reveal":
      expectKeysWithin(message.reveal, REVEAL_KEYS);
      // The reader's own verdict, as in every other mode's reveal.
      expect(message.reveal.correct).toBe(message.correct[seat]);
      for (const pick of message.picks) expect(["higher", "lower", null]).toContain(pick);
      if (message.next !== undefined) checkRoomQuestion(message.next, deck, now);
      if (message.end !== undefined) {
        expect(Object.keys(message.end).sort()).toEqual(["result", "series"]);
        expectKeysWithin(message.end.result, ROOM_RESULT_KEYS);
      }
      expect(message.next === undefined).toBe(message.end !== undefined);
      break;
    case "fulltime":
      expectKeysWithin(message.result, ROOM_RESULT_KEYS);
      for (const player of message.players) expectKeysWithin(player, ROOM_PLAYER_KEYS);
      break;
    case "players":
      for (const player of message.players) expectKeysWithin(player, ROOM_PLAYER_KEYS);
      break;
    case "welcome": {
      const { room } = message;
      expectKeysWithin(room, ROOM_SNAPSHOT_KEYS);
      for (const player of room.players) expectKeysWithin(player, ROOM_PLAYER_KEYS);
      if (room.question !== undefined) checkRoomQuestion(room.question, deck, now);
      if (room.result !== undefined) expectKeysWithin(room.result, ROOM_RESULT_KEYS);
      // A player's own pick comes back to them; only the seats of who else has locked in.
      if (room.picked !== undefined) expect(room.locked).toContain(seat);
      else expect(room.locked ?? []).not.toContain(seat);
      break;
    }
    default:
      break;
  }
}

describe("1v1 room messages", () => {
  const ways: Way[] = ["right", "wrong", "timeout", "none"];

  it.each([
    { name: "sample deck, All legends", deck: SAMPLE_DECK, pool: "endless" as const },
    { name: "fixture deck, All legends", deck: FIXTURE_DECK, pool: "endless" as const },
    { name: "sample deck, Instagram", deck: SAMPLE_DECK, pool: "endless-instagram" as const },
    { name: "themed deck, a squad", deck: THEMED_DECK, pool: "squad:club-testfield" as const },
  ])(
    "never carry a hidden value or a pick before the reveal, across whole matches on the $name",
    async ({ deck, pool }) => {
      let messages = 0;
      let questions = 0;
      for (let i = 0; i < 8; i++) {
        const h = roomHarness({ deck, images: fakeImages(deck) });
        const room = await openRoom(h, {
          pool,
          questions: i % 2 === 0 ? 10 : 20,
          limit: ([10, 20, 30] as const)[i % 3] ?? 20,
        });
        const { table } = room;
        const first = await startRoomMatch(room);
        const now = matchDay(h);
        await playRoomMatch(h, room, first, {
          deck,
          way: (seat, index) => ways[(index + i + seat * (1 + (i % 3))) % ways.length]!,
        });
        // A player comes back mid-question, both having answered or not: more snapshots.
        if (table.host.state?.phase === "fulltime" && i % 2 === 0) {
          await table.say(0, { v: 1, t: "rematch" });
          await table.say(1, { v: 1, t: "rematch" });
          const again = table.last(0, "question")?.question;
          if (again !== undefined) {
            await table.say(0, { v: 1, t: "answer", q: 1, pick: "higher" });
            await table.drop(1);
            await table.hello(room.tokens[1]);
            await table.drop(0);
            await table.hello(room.tokens[0]);
            await table.say(1, { v: 1, t: "answer", q: 1, pick: "lower" });
            await table.say(1, { v: 1, t: "leave" });
          }
        }

        const state = table.host.state;
        const secrets = [
          ...room.tokens,
          ...(state === undefined
            ? []
            : [state.key, ...(state.match === null ? [] : [state.match.id])]),
          ...(state?.seats.flatMap((s) => (s === null ? [] : [s.id])) ?? []),
        ];
        for (const sent of table.sent) {
          checkRoomMessage(sent, deck, now, secrets);
          messages += 1;
          if (sent.message.t === "question") questions += 1;
          if (sent.message.t === "reveal" && sent.message.next !== undefined) questions += 1;
        }

        // Between a question and its reveal, nothing sent to either seat holds its
        // challenger's figure. Seat by seat, since each gets every message of its own.
        for (const seat of [0, 1]) {
          let open: RoomQuestion | undefined;
          for (const message of table.inbox(seat)) {
            if (message.t === "question") open = message.question;
            else if (message.t === "welcome") open = message.room.question ?? open;
            if (open === undefined) continue;
            const { round } = open;
            const challenger = deck.find((p) => p.id === round.challenger.id)!;
            const hidden = valueOf(challenger, round.stat.key, now)!;
            if (message.t === "reveal") {
              // The reveal is where it arrives, and it is the true figure.
              expect(message.reveal.value).toBe(hidden);
              expect(message.reveal.round).toBe(round.index);
              open = message.next;
              continue;
            }
            const figures = numericLeaves(message).filter((l) => /(^|\.)value$/.test(l.path));
            for (const figure of figures) expect(figure.path).toMatch(/round\.anchor\.value$/);
            // Never a tie, so the one figure on show can't be the hidden one.
            expect(round.anchor.value).not.toBe(hidden);
          }
        }
      }
      expect(messages).toBeGreaterThan(8 * 40);
      expect(questions).toBeGreaterThan(8 * 10);
    },
    90_000,
  );

  it("fail on a question whose challenger carries its figure", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const first = await startRoomMatch(room);
    const sent = room.table.sent.find((s) => s.message.t === "question")!;
    const leaky = structuredClone(sent) as unknown as {
      seat: number;
      code: string;
      message: { question: { round: { challenger: Record<string, unknown> } } };
    };
    leaky.message.question.round.challenger["value"] = 1;
    expect(() =>
      checkRoomMessage(leaky as unknown as Sent, SAMPLE_DECK, matchDay(h), []),
    ).toThrow();
    expect(() => checkRoomMessage(sent, SAMPLE_DECK, matchDay(h), [])).not.toThrow();
    expect(first.round.challenger).not.toHaveProperty("value");
  });

  it("fail on a `locked` that says which way, and on a snapshot with the other's pick", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    await startRoomMatch(room);
    await room.table.say(0, { v: 1, t: "answer", q: 1, pick: "higher" });
    const locked = room.table.sent.find((s) => s.message.t === "locked")!;
    expect(() => checkRoomMessage(locked, SAMPLE_DECK, matchDay(h), [])).not.toThrow();
    const telling = { ...locked, message: { ...locked.message, pick: "higher" } };
    expect(() =>
      checkRoomMessage(telling as unknown as Sent, SAMPLE_DECK, matchDay(h), []),
    ).toThrow();

    await room.table.drop(1);
    await room.table.hello(room.tokens[1]);
    const welcome = room.table.sent.filter((s) => s.message.t === "welcome").at(-1)!;
    expect(() => checkRoomMessage(welcome, SAMPLE_DECK, matchDay(h), [])).not.toThrow();
    const peeking = structuredClone(welcome) as unknown as {
      message: { room: Record<string, unknown> };
    };
    // The guest handed the host's pick: they haven't locked in themselves.
    peeking.message.room["picked"] = "higher";
    expect(() =>
      checkRoomMessage(peeking as unknown as Sent, SAMPLE_DECK, matchDay(h), []),
    ).toThrow();
    const picks = structuredClone(welcome) as unknown as {
      message: { room: Record<string, unknown> };
    };
    picks.message.room["picks"] = ["higher", null];
    expect(() =>
      checkRoomMessage(picks as unknown as Sent, SAMPLE_DECK, matchDay(h), []),
    ).toThrow();
  });

  it("fail on a message that carries the room's key", async () => {
    const h = roomHarness();
    const room = await openRoom(h);
    const { key } = room.table.host.state!;
    const sent = room.table.sent[0]!;
    expect(() => checkRoomMessage(sent, SAMPLE_DECK, matchDay(h), [key])).not.toThrow();
    const leaky = { ...sent, message: { ...sent.message, t: "closed", reason: key } };
    expect(() =>
      checkRoomMessage(leaky as unknown as Sent, SAMPLE_DECK, matchDay(h), [key]),
    ).toThrow();
  });
});
