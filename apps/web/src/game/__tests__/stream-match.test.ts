/**
 * Twitch Mode on the page: the match scored for both sides (stream/match.ts),
 * the spoiler-free share, what's remembered (stream/settings.ts), the words
 * (stream/view.ts), and the machine's lock-in, End voting and voting window.
 */

import { describe, expect, it } from "vitest";
import type { Reveal } from "@bt/core";
import { initialState, reduce } from "../machine";
import type { GameEvent, GameState } from "../machine";
import {
  answerOf,
  chatOutcome,
  chatPickText,
  matchScore,
  poolShareName,
  questionResult,
  streamShareCard,
  streamShareText,
  stripLabel,
  winnerOf,
  winnerText,
} from "../stream/match";
import type { QuestionResult } from "../stream/match";
import {
  STREAM_KEYS,
  poolFromQuery,
  poolOptions,
  readSetup,
  saveSetting,
} from "../stream/settings";
import {
  endVotingShown,
  hintText,
  limitLabel,
  statusText,
  votesText,
  votingOpen,
} from "../stream/view";
import { topClock } from "../view";
import { round } from "./fixtures";

const THEMES = [
  { id: "club-barcelona", type: "club", name: "Barcelona", slug: "barcelona", players: 35 },
  { id: "club-arsenal", type: "club", name: "Arsenal", slug: "arsenal", players: 11 },
  {
    id: "club-man-city",
    type: "club",
    name: "Manchester City",
    slug: "manchester-city",
    players: 10,
  },
  { id: "era-2000s", type: "era", name: "2000s", slug: "2000s", players: 51 },
] as const;
const OPTIONS = poolOptions(THEMES);
const LINK = "https://biggerthangame.com/football-higher-or-lower/legends/multiplayer/twitch";

const reveal = (value: number, correct: boolean, index = 1): Reveal => ({
  round: index,
  value,
  display: String(value),
  correct,
});
const counts = (higher: number, lower: number) => ({ higher, lower, voters: higher + lower });

describe("scoring a question", () => {
  it("takes the answer from what the reveal shows", () => {
    expect(answerOf(round(1, { anchorValue: 50 }), reveal(80, true))).toBe("higher");
    expect(answerOf(round(1, { anchorValue: 50 }), reveal(20, true))).toBe("lower");
  });

  it("scores chat's majority, a split and no votes as misses", () => {
    expect(chatOutcome("higher", "higher")).toBe("right");
    expect(chatOutcome("lower", "higher")).toBe("wrong");
    expect(chatOutcome("split", "higher")).toBe("split");
    expect(chatOutcome("none", "lower")).toBe("none");
    const r = round(3, { anchorValue: 50 });
    expect(questionResult(r, reveal(80, true, 3), "higher", counts(7, 3))).toEqual({
      index: 3,
      streamer: "right",
      chat: "right",
      counts: counts(7, 3),
    });
    expect(questionResult(r, reveal(80, false, 3), "lower", counts(5, 5)).chat).toBe("split");
    expect(questionResult(r, reveal(80, false, 3), "timeout", counts(0, 0))).toMatchObject({
      streamer: "none",
      chat: "none",
    });
  });

  it("counts both sides and names the winner, or a draw", () => {
    const results: QuestionResult[] = [
      { index: 1, streamer: "right", chat: "right", counts: counts(1, 0) },
      { index: 2, streamer: "wrong", chat: "right", counts: counts(1, 0) },
      { index: 3, streamer: "none", chat: "split", counts: counts(1, 1) },
      { index: 4, streamer: "right", chat: "none", counts: counts(0, 0) },
    ];
    expect(matchScore(results)).toEqual({ chat: 2, streamer: 2 });
    expect(winnerOf({ chat: 2, streamer: 2 })).toBe("draw");
    expect(winnerOf({ chat: 3, streamer: 2 })).toBe("chat");
    expect(winnerText({ chat: 1, streamer: 2 }, "shroud")).toBe("shroud wins");
    expect(winnerText({ chat: 2, streamer: 1 }, "shroud")).toBe("Chat wins");
    expect(winnerText({ chat: 2, streamer: 2 }, "shroud")).toBe("It's a draw");
    expect(stripLabel(results.slice(0, 1), "shroud")).toBe("Question 1: chat right, shroud right.");
  });

  it("says what chat did at the reveal", () => {
    expect(chatPickText(counts(6, 4))).toBe("Chat said higher");
    expect(chatPickText(counts(1, 4))).toBe("Chat said lower");
    expect(chatPickText(counts(4, 4))).toBe("Chat split 50/50");
    expect(chatPickText(counts(0, 0))).toBe("No votes");
  });
});

describe("the share", () => {
  const results: QuestionResult[] = Array.from({ length: 10 }, (_, i) => ({
    index: i + 1,
    streamer: i < 7 ? "right" : "wrong",
    chat: i < 4 ? "right" : "wrong",
    counts: counts(3, 2),
  }));

  it("reads the score, the channel and the pool, and the page, and nothing else", () => {
    const barca = OPTIONS.find((o) => o.theme?.id === "club-barcelona");
    const text = streamShareText(matchScore(results), "shroud", barca, LINK);
    expect(text).toBe(`Chat 4 – 7 shroud on Barcelona legends · Bigger Than Twitch Mode\n${LINK}`);
    expect(text).not.toContain("—");
    expect(poolShareName(OPTIONS[0])).toBe("Football Legends");
    expect(poolShareName(OPTIONS[1])).toBe("Instagram legends");
  });

  it("draws the score, the winner and both strips, with no players", () => {
    const card = streamShareCard(results, "shroud", OPTIONS[0], "biggerthangame.com");
    expect(card).toMatchObject({
      score: "4 – 7",
      title: "shroud wins",
      players: null,
      ended: null,
      cells: [],
      won: false,
    });
    expect(card.rows?.map((r) => r.label)).toEqual(["Chat", "shroud"]);
    expect(card.rows?.[1]?.cells.filter((c) => c.kind === "hit")).toHaveLength(7);
    expect(JSON.stringify(card)).not.toMatch(/p\d/);
  });
});

describe("what's remembered", () => {
  function memory() {
    const items = new Map<string, string>();
    return {
      items,
      storage: () => ({
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
      }),
    };
  }

  it("offers every pool that can make a full 10-question match, a short squad with its cap", () => {
    expect(OPTIONS.map((o) => o.pool)).toEqual([
      "endless",
      "endless-instagram",
      "squad:club-barcelona",
      "squad:club-arsenal",
      "squad:era-2000s",
    ]);
    expect(OPTIONS.find((o) => o.pool === "squad:club-arsenal")?.cap).toBe(10);
    expect(OPTIONS.find((o) => o.pool === "squad:club-barcelona")?.cap).toBeNull();
    // Ten players make only nine questions: not offered, and never preselected.
    expect(OPTIONS.some((o) => o.pool === "squad:club-man-city")).toBe(false);
    expect(poolFromQuery("?pool=manchester-city", OPTIONS)).toBeNull();
  });

  it("keeps the channel, pool, length and timer under bt:stream:*", () => {
    const m = memory();
    expect(readSetup(m.storage, OPTIONS)).toEqual({
      channel: "",
      pool: "endless",
      length: 10,
      limit: 30,
    });
    saveSetting(m.storage, STREAM_KEYS.channel, "shroud");
    saveSetting(m.storage, STREAM_KEYS.pool, "squad:era-2000s");
    saveSetting(m.storage, STREAM_KEYS.length, 20);
    saveSetting(m.storage, STREAM_KEYS.timer, 60);
    expect([...m.items.keys()].every((k) => k.startsWith("bt:stream:"))).toBe(true);
    expect(readSetup(m.storage, OPTIONS)).toEqual({
      channel: "shroud",
      pool: "squad:era-2000s",
      length: 20,
      limit: 60,
    });
  });

  it("falls back on anything it can't use, and does nothing with storage blocked", () => {
    const m = memory();
    m.items.set(STREAM_KEYS.pool, "squad:club-gone");
    m.items.set(STREAM_KEYS.length, "15");
    m.items.set(STREAM_KEYS.timer, "45");
    expect(readSetup(m.storage, OPTIONS)).toMatchObject({ pool: "endless", length: 10, limit: 30 });
    const blocked = () => {
      throw new Error("blocked");
    };
    expect(readSetup(blocked, OPTIONS)).toMatchObject({ channel: "", pool: "endless" });
    expect(saveSetting(blocked, STREAM_KEYS.channel, "x")).toBe(false);
    expect(saveSetting(() => null, STREAM_KEYS.channel, "x")).toBe(false);
  });

  it("preselects ?pool= by a theme's slug, all or instagram", () => {
    expect(poolFromQuery("?pool=barcelona", OPTIONS)).toBe("squad:club-barcelona");
    expect(poolFromQuery("?pool=2000s", OPTIONS)).toBe("squad:era-2000s");
    expect(poolFromQuery("?pool=all", OPTIONS)).toBe("endless");
    expect(poolFromQuery("?pool=Instagram", OPTIONS)).toBe("endless-instagram");
    expect(poolFromQuery("?pool=nowhere", OPTIONS)).toBeNull();
    expect(poolFromQuery("", OPTIONS)).toBeNull();
  });
});

describe("the words", () => {
  it("count votes with the site's formatter and plurals", () => {
    expect(votesText(0)).toBe("0 votes this question");
    expect(votesText(1)).toBe("1 vote this question");
    expect(votesText(1204)).toBe("1,204 votes this question");
  });

  it("name the commands from their one config", () => {
    expect(hintText()).toBe("Type !h or !higher · !l or !lower in chat");
  });

  it("say where chat stands", () => {
    expect(statusText({ kind: "connected", channel: "shroud" })).toBe("Connected to #shroud");
    expect(statusText({ kind: "failed", channel: "x_y", reason: "not_found" })).toContain(
      "Couldn't find #x_y",
    );
    expect(statusText({ kind: "reconnecting", channel: "a", attempt: 1, retryAt: 0 })).toContain(
      "Reconnecting",
    );
  });

  it("label the timers", () => {
    expect([10, 20, 30, 60].map((n) => limitLabel(n as 10 | 20 | 30 | 60))).toEqual([
      "10 s",
      "20 s",
      "30 s",
      "1 min",
    ]);
  });
});

// ------------------------------------------------------------ the machine

const SETTINGS = { pool: "endless" as const, questions: 10, limit: 30 as const };

function match(limit: 10 | 20 | 30 | 60 = 30): GameState {
  const events: GameEvent[] = [
    { type: "start" },
    { type: "started", runId: "r", round: round(1), stream: { ...SETTINGS, limit } },
    { type: "titled" },
    { type: "held" },
    { type: "introDone" },
    { type: "dealt", at: 1000 },
    { type: "spun", at: 1000 },
  ];
  return events.reduce(reduce, initialState(0, null, "stream"));
}

describe("the machine in Twitch Mode", () => {
  it("runs every question on the chosen limit, question one included", () => {
    for (const limit of [10, 20, 30, 60] as const) {
      const s = match(limit);
      expect(s.phase).toBe("awaiting");
      expect(s.clock).toEqual({ startedAt: 1000, limitMs: limit * 1000 });
      expect(topClock(s, 1000)?.seconds).toBe(limit);
      expect(votingOpen(s)).toBe(true);
    }
  });

  it("locks the streamer's pick in, once, without answering", () => {
    let s = match();
    s = reduce(s, { type: "guess", guess: "higher", at: 2000 });
    expect(s).toMatchObject({ phase: "awaiting", locked: "higher", guess: null });
    // A second press changes nothing.
    expect(reduce(s, { type: "guess", guess: "lower", at: 2500 })).toBe(s);
    // The window closes: the locked pick goes.
    s = reduce(s, { type: "timeout", at: 31_000 });
    expect(s).toMatchObject({ phase: "revealing", guess: "higher" });
    expect(votingOpen(s)).toBe(false);
  });

  it("sends a timeout when the window closes with no pick", () => {
    const s = reduce(match(), { type: "timeout", at: 31_000 });
    expect(s).toMatchObject({ phase: "revealing", guess: "timeout", locked: null });
  });

  it("offers End voting from 8 seconds, never on the 10-second limit", () => {
    const s = match(30);
    expect(endVotingShown(s, 1000 + 7_999)).toBe(false);
    expect(endVotingShown(s, 1000 + 8_000)).toBe(true);
    expect(reduce(s, { type: "close", at: 1000 + 7_999 })).toBe(s);
    const closed = reduce(reduce(s, { type: "guess", guess: "lower", at: 3000 }), {
      type: "close",
      at: 1000 + 8_000,
    });
    expect(closed).toMatchObject({ phase: "revealing", guess: "lower" });
    expect(closed.stopped?.remainingMs).toBe(22_000);

    const short = match(10);
    expect(endVotingShown(short, 1000 + 9_000)).toBe(false);
    expect(reduce(short, { type: "close", at: 1000 + 9_000 })).toBe(short);
  });

  it("goes on after a wrong answer, clearing the lock for the next question", () => {
    let s = reduce(match(), { type: "guess", guess: "higher", at: 2000 });
    s = reduce(s, { type: "timeout", at: 31_000 });
    s = reduce(s, {
      type: "answered",
      response: { reveal: reveal(20, false), next: round(2) },
      at: 31_100,
    });
    s = reduce(s, { type: "settled" });
    s = reduce(s, { type: "advance" });
    expect(s).toMatchObject({ phase: "dealing", locked: null, streak: 0 });
    expect(s.round?.index).toBe(2);
    expect(s.history).toEqual([{ index: 1, stat: "caps", tier: "basic", correct: false }]);
  });

  it("ends the match on the server's end", () => {
    let s = reduce(match(), { type: "timeout", at: 31_000 });
    s = reduce(s, {
      type: "answered",
      response: { reveal: reveal(80, false), end: "finished" },
      at: 31_100,
    });
    s = reduce(s, { type: "settled" });
    s = reduce(s, { type: "advance" });
    expect(s).toMatchObject({ phase: "over", end: "finished" });
  });

  it("takes no part in a pick outside Twitch Mode", () => {
    const endless = initialState(0, null, "endless");
    expect(endless.locked).toBeNull();
    expect(endless.stream).toBeNull();
  });
});
