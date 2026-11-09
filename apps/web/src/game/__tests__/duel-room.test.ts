/**
 * 1v1's room as the page knows it (duel/room.ts), its words (duel/view.ts),
 * what it remembers (duel/settings.ts) and how a seat is had (duel/api.ts):
 * all pure, so the scoreboard, the track, the share text and the invite link
 * are held here rather than in markup.
 */

import { describe, expect, it } from "vitest";
import { REJOIN_MS } from "@bt/core";
import type { RoomResult, RoomServerMessage } from "@bt/core";
import { en } from "../../i18n/en";
import { DUEL_PATH } from "../../lib/paths";
import { ApiFailure } from "../api";
import type { Fetch } from "../api";
import {
  ROOM_SOCKET_ENDPOINT,
  createRoomApi,
  inviteLink,
  roomCodeOf,
  roomFromQuery,
  seatProblem,
  socketUrl,
  withRoom,
} from "../duel/api";
import {
  beforeReveal,
  canRematch,
  canStart,
  duelOutcome,
  duelQuestions,
  duelScore,
  duelSeries,
  me,
  opponent,
  opponentSeat,
  reduceRoom,
  withPick,
} from "../duel/room";
import type { DuelView } from "../duel/room";
import { DUEL_KEYS, readDuelSetup, saveDuelSetting } from "../duel/settings";
import {
  closedText,
  duelShareText,
  isNameProblem,
  limitLabel,
  limitLine,
  limitName,
  linkText,
  linkTone,
  opponentText,
  refusedText,
  resultNote,
  resultText,
  revealAnnouncement,
  revealPicks,
  seatProblemText,
  seriesText,
  stripLabel,
  trackText,
} from "../duel/view";
import { poolOptions } from "../stream/settings";
import type { Theme } from "../variant";
import { fakeStorage, lobby, players, question, reveal, welcome } from "./duel-helpers";

/** The room after each message in turn, the first received at `at`. */
function after(messages: readonly RoomServerMessage[], at = 1000): DuelView {
  let view: DuelView | null = null;
  messages.forEach((message, i) => {
    view = reduceRoom(view, message, at + i);
  });
  if (view === null) throw new Error("never welcomed");
  return view;
}

const RESULT: RoomResult = {
  winner: 0,
  reason: "finished",
  scores: [2, 1],
  results: [
    [true, true, false],
    [false, true, false],
  ],
  questions: 3,
};
const END = { result: RESULT, series: { wins: [1, 0], draws: 0 } };

const BARCELONA: Theme = {
  id: "club-barcelona",
  type: "club",
  name: "Barcelona",
  slug: "barcelona",
  players: 35,
};
const POOLS = poolOptions([BARCELONA]);

describe("the room's view", () => {
  it("is nothing until the room's welcome", () => {
    expect(reduceRoom(null, { v: 1, t: "locked", seat: 1 }, 0)).toBeNull();
    expect(reduceRoom(null, { v: 1, t: "question", question: question(1) }, 0)).toBeNull();
  });

  it("starts from the welcome: this seat, the lobby, the settings", () => {
    const view = after([welcome(1)]);
    expect(view).toMatchObject({
      you: 1,
      code: "K7QM2X",
      phase: "lobby",
      settings: { pool: "endless", questions: 3, limit: 20 },
      matchNo: 0,
      scores: [0, 0],
      results: [[], []],
      question: null,
      picked: null,
      locked: [],
      result: null,
      rematch: [],
    });
    expect(me(view)?.name).toBe("Sam");
    expect(opponent(view)?.name).toBe("Ada");
    expect(opponentSeat(view)).toBe(0);
  });

  it("follows who is here, and when the room last said", () => {
    const view = after([
      welcome(0, lobby({ players: [players()[0]!] })),
      { v: 1, t: "players", phase: "lobby", players: players([{}, { ready: true }]) },
    ]);
    expect(view.players.map((p) => p.name)).toEqual(["Ada", "Sam"]);
    expect(view.playersAt).toBe(1001);
    // Alone in the lobby, nobody is the opponent yet.
    expect(opponent(after([welcome(0, lobby({ players: [players()[0]!] }))]))).toBeUndefined();
  });

  it("opens a match on its first question, and counts when it closes", () => {
    const view = after([welcome(0), { v: 1, t: "question", question: question(1, 1, 30_000) }]);
    expect(view).toMatchObject({ phase: "playing", matchNo: 1, scores: [0, 0], results: [[], []] });
    expect(view.question?.round.index).toBe(1);
    expect(view.closesAt).toBe(1001 + 30_000);
  });

  it("knows who has locked in, never which way", () => {
    const view = after([
      welcome(0),
      { v: 1, t: "question", question: question(1) },
      { v: 1, t: "locked", seat: 1 },
      { v: 1, t: "locked", seat: 1 },
    ]);
    expect(view.locked).toEqual([1]);
    expect(view.picked).toBeNull();
    // This player's own pick is the page's to remember.
    const mine = withPick(view, "lower");
    expect(mine).toMatchObject({ picked: "lower", locked: [1, 0] });
    expect(withPick(mine, "lower").locked).toEqual([1, 0]);
  });

  it("counts a reveal once, and moves to the next question", () => {
    const view = after([
      welcome(0),
      { v: 1, t: "question", question: question(1) },
      { v: 1, t: "locked", seat: 0 },
      reveal(1, [true, false], [1, 0], { next: question(2, 1, 20_000) }),
    ]);
    expect(view).toMatchObject({
      phase: "playing",
      scores: [1, 0],
      results: [[true], [false]],
      reveal: { index: 1, picks: ["higher", "lower"], correct: [true, false] },
      picked: null,
      locked: [],
    });
    expect(view.question?.round.index).toBe(2);
    expect(view.closesAt).toBe(1003 + 20_000);
    // The same reveal again (a reconnect's snapshot had it): not counted twice.
    const again = reduceRoom(view, reveal(1, [true, false], [1, 0], { next: question(2) }), 5000)!;
    expect(again.results).toEqual([[true], [false]]);
    expect(again.scores).toEqual([1, 0]);
  });

  it("holds the score back while a reveal is still playing", () => {
    const view = after([
      welcome(0),
      { v: 1, t: "question", question: question(1) },
      reveal(1, [true, false], [1, 0], { next: question(2) }),
      reveal(2, [true, true], [2, 1], { next: question(3) }),
    ]);
    expect(duelScore(view)).toEqual({ you: 2, them: 1 });
    const held = beforeReveal(view);
    expect(held.scores).toEqual([1, 0]);
    expect(held.results).toEqual([[true], [false]]);
    // Nothing to hold back before any reveal.
    const fresh = after([welcome(0), { v: 1, t: "question", question: question(1) }]);
    expect(beforeReveal(fresh)).toBe(fresh);
  });

  it("is at full time with the last reveal, with the result and the series", () => {
    const view = after([
      welcome(1),
      { v: 1, t: "question", question: question(1) },
      reveal(3, [true, false], [2, 1], { end: END }, 1),
    ]);
    expect(view).toMatchObject({
      phase: "fulltime",
      question: null,
      closesAt: null,
      result: RESULT,
      series: { wins: [1, 0], draws: 0 },
    });
    expect(duelOutcome(view)).toBe("lost");
    expect(duelOutcome({ ...view, you: 0 })).toBe("won");
    expect(duelOutcome({ ...view, result: { ...RESULT, winner: null } })).toBe("draw");
    expect(duelOutcome(after([welcome(0)]))).toBeNull();
    expect(duelSeries(view)).toEqual({ you: 0, them: 1, draws: 0 });
  });

  it("takes a forfeit's result as the room gives it", () => {
    const view = after([
      welcome(0),
      { v: 1, t: "question", question: question(1) },
      {
        v: 1,
        t: "fulltime",
        result: {
          ...RESULT,
          reason: "forfeit",
          left: 1,
          scores: [1, 0],
          results: [[true], [false]],
        },
        series: { wins: [1, 0], draws: 0 },
        players: players([{}, { connected: false, left: true }]),
      },
    ]);
    expect(view).toMatchObject({ phase: "fulltime", scores: [1, 0], results: [[true], [false]] });
    expect(view.result).toMatchObject({ reason: "forfeit", left: 1 });
    expect(canRematch(view)).toBe(false);
  });

  it("starts a rematch afresh, keeping the series", () => {
    const view = after([
      welcome(0),
      { v: 1, t: "question", question: question(1) },
      reveal(3, [true, false], [2, 1], { end: END }),
      { v: 1, t: "rematch", seats: [1] },
      { v: 1, t: "question", question: question(1, 2) },
    ]);
    expect(view).toMatchObject({
      phase: "playing",
      matchNo: 2,
      scores: [0, 0],
      results: [[], []],
      result: null,
      rematch: [],
      reveal: null,
      series: { wins: [1, 0], draws: 0 },
    });
  });

  it("is unchanged by a goodbye or a refusal: those are the page's to act on", () => {
    const view = after([welcome(0)]);
    expect(reduceRoom(view, { v: 1, t: "closed", reason: "expired" }, 0)).toBe(view);
    expect(reduceRoom(view, { v: 1, t: "error", code: "not_ready" }, 0)).toBe(view);
  });

  it("lays the match out question by question, sudden death after the rest", () => {
    const view = after([welcome(1)]);
    const played = {
      ...view,
      results: [
        [true, false, true, true],
        [false, false, true, false],
      ],
    };
    expect(duelQuestions(played)).toEqual([
      { index: 1, you: false, them: true },
      { index: 2, you: false, them: false },
      { index: 3, you: true, them: true },
      { index: 4, you: false, them: true },
    ]);
  });

  it("lets the host start only with both players connected and ready", () => {
    const both = (a: object, b: object): DuelView =>
      after([welcome(0, lobby({ players: players([a, b]) }))]);
    expect(canStart(both({ ready: true }, { ready: true }))).toBe(true);
    expect(canStart(both({ ready: true }, { ready: false }))).toBe(false);
    expect(canStart(both({ ready: false }, { ready: true }))).toBe(false);
    // Ready, but away: not yet.
    expect(canStart(both({ ready: true }, { ready: true, connected: false }))).toBe(false);
    expect(
      canStart(after([welcome(0, lobby({ players: [players([{ ready: true }])[0]!] }))])),
    ).toBe(false);
  });
});

describe("the words", () => {
  const playing = after([
    welcome(0),
    { v: 1, t: "question", question: question(1) },
    reveal(1, [true, false], [1, 0], { next: question(2) }),
  ]);
  const over = after([
    welcome(0),
    { v: 1, t: "question", question: question(1) },
    reveal(3, [true, false], [2, 1], { end: END }),
  ]);

  it("name the three timers", () => {
    expect([10, 20, 30].map((n) => limitName(n as 10))).toEqual(["Fast", "Relaxed", "Slow"]);
    expect(limitLabel(20)).toBe("Relaxed, 20 seconds per question");
    expect(limitLine(10)).toBe("Fast: 10 seconds a question");
  });

  it("say where the match is: the question, the final one, sudden death", () => {
    expect(trackText(7, 20)).toBe("Question 7 of 20");
    expect(trackText(20, 20)).toBe("Final question: question 20 of 20");
    expect(trackText(21, 20)).toBe("Sudden death: question 1");
    expect(trackText(13, 10)).toBe("Sudden death: question 3");
  });

  it("count down this page's own connection only in a match", () => {
    const dropped = { kind: "reconnecting", since: 10_000, attempt: 2 } as const;
    expect(linkText({ kind: "connected" }, true, 0)).toBe("Connected");
    expect(linkText({ kind: "connecting" }, false, 0)).toBe("Connecting…");
    // In a match: the thirty seconds the room gives, counting down.
    expect(linkText(dropped, true, 10_000)).toBe("Reconnecting… 30 seconds to get back");
    // The page's tick can trail the drop: never more than the room gives.
    expect(linkText(dropped, true, 9_600)).toBe("Reconnecting… 30 seconds to get back");
    expect(linkText(dropped, true, 10_000 + REJOIN_MS - 12_400)).toBe(
      "Reconnecting… 13 seconds to get back",
    );
    expect(linkText(dropped, true, 10_000 + REJOIN_MS - 900)).toBe(
      "Reconnecting… 1 second to get back",
    );
    expect(linkText(dropped, true, 10_000 + REJOIN_MS + 5000)).toBe(
      "Reconnecting… 0 seconds to get back",
    );
    // In the lobby and at full time: no limit, so no countdown.
    expect(linkText(dropped, false, 10_000)).toBe("Reconnecting…");
    expect(linkText(dropped, false, 10_000 + 10 * 60_000)).toBe("Reconnecting…");
    expect(linkTone({ kind: "connected" })).toBe("ok");
    expect(linkTone(dropped)).toBe("busy");
    expect(linkTone({ kind: "closed" })).toBe("bad");
  });

  it("say how the other player's connection stands", () => {
    const [, sam] = players();
    expect(opponentText(sam)).toBe("Sam is connected");
    expect(opponentText({ ...sam!, connected: false })).toBe("Sam is away");
    // In a match the room says how long they have, and the page counts it down.
    const away = { ...sam!, connected: false, rejoinInMs: 30_000 };
    expect(opponentText(away, 0)).toBe("Sam has dropped out. 30 seconds to return");
    expect(opponentText(away, -400)).toBe("Sam has dropped out. 30 seconds to return");
    expect(opponentText(away, 29_100)).toBe("Sam has dropped out. 1 second to return");
    expect(opponentText(away, 45_000)).toBe("Sam has dropped out. 0 seconds to return");
    expect(opponentText({ ...sam!, left: true })).toBe("Sam has left");
    expect(opponentText(undefined)).toBe("");
  });

  it("give both picks at the reveal, this player's first", () => {
    expect(revealPicks(playing, playing.reveal!)).toEqual({
      you: "You: higher",
      them: "Sam: lower",
    });
    const noAnswer = { ...playing.reveal!, picks: [null, "higher"] as const };
    expect(revealPicks(playing, noAnswer)).toEqual({ you: "You: no answer", them: "Sam: higher" });
    // The guest reads it the other way round.
    expect(revealPicks({ ...playing, you: 1 }, playing.reveal!)).toEqual({
      you: "You: lower",
      them: "Ada: higher",
    });
  });

  it("announce a reveal in full: the figure, both picks and verdicts, the score", () => {
    const { round } = question(1);
    const figure = { round: 1, value: 80, display: "80", correct: true };
    expect(revealAnnouncement(playing, playing.reveal!, round, figure)).toBe(
      "p2: 80. You said higher: right. Sam said lower: wrong. Score: you 1, Sam 0.",
    );
  });

  it("say who won, and how when it wasn't simply the score", () => {
    expect(resultText(over)).toBe("You win");
    expect(resultText({ ...over, you: 1 })).toBe("Ada wins");
    expect(resultNote(over)).toBe("");
    const decided = (result: Partial<RoomResult>): DuelView => ({
      ...over,
      result: { ...RESULT, ...result },
    });
    expect(resultText(decided({ winner: null, reason: "draw" }))).toBe("It's a draw");
    expect(resultNote(decided({ reason: "sudden-death" }))).toBe("Decided in sudden death.");
    expect(
      resultNote(
        decided({
          winner: null,
          reason: "draw",
          results: [Array.from({ length: 13 }, () => true), Array.from({ length: 13 }, () => true)],
        }),
      ),
    ).toBe("Still level after 10 sudden death questions.");
    expect(resultNote(decided({ reason: "exhausted" }))).toBe(
      "These questions ran out of pairings before the end.",
    );
    expect(resultNote(decided({ reason: "forfeit", left: 1 }))).toBe("Sam left the match.");
    expect(resultNote(decided({ reason: "forfeit", left: 0 }))).toBe("You left the match.");
  });

  it("keep a running series score", () => {
    expect(seriesText({ ...over, series: { wins: [2, 1], draws: 0 } })).toBe(
      "Series: You 2 – 1 Sam",
    );
    expect(seriesText({ ...over, you: 1, series: { wins: [2, 1], draws: 0 } })).toBe(
      "Series: You 1 – 2 Ada",
    );
  });

  it("label the strip question by question", () => {
    expect(
      stripLabel({
        ...over,
        results: [
          [true, false],
          [false, false],
        ],
      }),
    ).toBe("Question 1: you right, Sam wrong. Question 2: you wrong, Sam wrong.");
  });

  it("say why a seat wasn't had, and which field it is about", () => {
    expect(seatProblemText("nameTaken")).toBe("That name is taken in this room. Try another.");
    expect(seatProblemText("full")).toBe("This room is full.");
    expect(seatProblemText("closed")).toBe("This room has closed. Create a new one.");
    for (const problem of ["nameRejected", "verification", "slowDown", "failed"] as const) {
      expect(seatProblemText(problem)).not.toBe("");
    }
    expect(isNameProblem("nameTaken")).toBe(true);
    expect(isNameProblem("nameRejected")).toBe(true);
    expect(isNameProblem("full")).toBe(false);
    expect(isNameProblem(null)).toBe(false);
  });

  it("say why a room has gone, for every reason the room has", () => {
    for (const reason of ["expired", "unknown", "empty"] as const) {
      expect(closedText(reason)).toBe("This room has closed. Create a new one.");
    }
    expect(closedText("host-left")).toMatch(/host left/);
    expect(closedText("left")).toMatch(/away too long/);
    expect(closedText("replaced")).toMatch(/another tab/);
  });

  it("put the room's refusals in words, and say nothing for the rest", () => {
    expect(refusedText("not_ready")).toBe("Both players need to be here and ready.");
    expect(refusedText("opponent_left")).toBe("Your friend has left the room.");
    expect(refusedText("out_of_turn")).toBe("");
    expect(refusedText("bad_message")).toBe("");
    expect(refusedText(null)).toBe("");
  });

  it("use no em dash anywhere, and send every word through en.ts", () => {
    const words = Object.entries(en).filter(
      ([key]) => key.startsWith("duel.") || key.startsWith("live.duel"),
    );
    expect(words.length).toBeGreaterThan(100);
    for (const [key, text] of words) expect(text, key).not.toContain("—");
  });
});

describe("the share", () => {
  const over = after([
    welcome(0),
    { v: 1, t: "question", question: question(1) },
    reveal(3, [true, false], [14, 12], {
      end: { result: { ...RESULT, scores: [14, 12] }, series: { wins: [1, 0], draws: 0 } },
    }),
  ]);
  const link = `https://biggerthangame.com${DUEL_PATH}`;
  const barcelona = POOLS.find((o) => o.theme?.id === "club-barcelona");

  it("says who beat whom, the score and the pool, then the 1v1 page", () => {
    expect(duelShareText(over, barcelona, link)).toBe(
      `I beat Sam 14–12 on Barcelona legends · Bigger Than 1v1\n${link}`,
    );
    expect(duelShareText({ ...over, you: 1 }, barcelona, link)).toBe(
      `Ada beat me 14–12 on Barcelona legends · Bigger Than 1v1\n${link}`,
    );
    const drawn = { ...over, scores: [10, 10], result: { ...RESULT, winner: null } };
    expect(duelShareText(drawn, undefined, link)).toBe(
      `I drew 10–10 with Sam on Football Legends · Bigger Than 1v1\n${link}`,
    );
    expect(duelShareText(over, POOLS[1], link)).toContain("on Instagram legends");
  });

  it("links the page, never the room: a share is not an invite", () => {
    const text = duelShareText(over, barcelona, link);
    expect(text).not.toContain("room=");
    expect(text).not.toContain(over.code);
    expect(text.split("\n")).toHaveLength(2);
    expect(text.split("\n")[1]).toBe(link);
  });

  it("is spoiler-free: no player of the deck, no stat, no figure", () => {
    // The room's view at full time holds no question at all, so there is nothing to leak;
    // and the text is built from the score, the names and the pool alone.
    expect(over.question).toBeNull();
    const text = duelShareText(over, barcelona, link);
    expect(text).not.toMatch(/p\d|caps|goals|followers|80/i);
    expect(text).not.toContain("—");
  });
});

describe("what is remembered", () => {
  it("keeps the pool, the length and the timer, and starts on Relaxed", () => {
    const storage = fakeStorage();
    expect(readDuelSetup(storage.access, POOLS)).toEqual({
      pool: "endless",
      length: 10,
      limit: 20,
    });
    saveDuelSetting(storage.access, DUEL_KEYS.pool, "squad:club-barcelona");
    saveDuelSetting(storage.access, DUEL_KEYS.length, 20);
    saveDuelSetting(storage.access, DUEL_KEYS.timer, 30);
    expect([...storage.items.keys()].sort()).toEqual([
      "bt:duel:length",
      "bt:duel:pool",
      "bt:duel:timer",
    ]);
    expect(readDuelSetup(storage.access, POOLS)).toEqual({
      pool: "squad:club-barcelona",
      length: 20,
      limit: 30,
    });
  });

  it("holds what it reads to what is on offer", () => {
    const storage = fakeStorage();
    storage.items.set("bt:duel:pool", "squad:club-nowhere");
    storage.items.set("bt:duel:length", "15");
    // Twitch Mode's minute is not a 1v1 timer.
    storage.items.set("bt:duel:timer", "60");
    expect(readDuelSetup(storage.access, POOLS)).toEqual({
      pool: "endless",
      length: 10,
      limit: 20,
    });
  });

  it("plays the same with storage blocked", () => {
    const blocked = fakeStorage(true);
    expect(readDuelSetup(blocked.access, POOLS)).toEqual({
      pool: "endless",
      length: 10,
      limit: 20,
    });
    expect(saveDuelSetting(blocked.access, DUEL_KEYS.timer, 10)).toBe(false);
  });
});

describe("getting a seat", () => {
  function server(reply: (url: string, body: Record<string, unknown>) => [number, unknown]) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchFn: Fetch = async (url, init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ url, body });
      const [status, answer] = reply(url, body);
      return new Response(JSON.stringify(answer), { status });
    };
    return { fetchFn, calls };
  }
  const seat = { code: "K7QM2X", token: "t", settings: lobby().settings, name: "Ada" };

  it("creates a room with the settings, the name and a fresh human check", async () => {
    let checks = 0;
    const s = server(() => [200, seat]);
    const api = createRoomApi(s.fetchFn, async () => `turnstile-${++checks}`);
    expect(
      await api.create({ pool: "endless-instagram", questions: 20, limit: 10, name: "Ada" }),
    ).toEqual(seat);
    await api.create({ pool: "endless", questions: 10, limit: 30, name: "Ada" });
    expect(s.calls).toEqual([
      {
        url: "/api/room/create",
        body: {
          pool: "endless-instagram",
          questions: 20,
          limit: 10,
          name: "Ada",
          turnstileToken: "turnstile-1",
        },
      },
      {
        url: "/api/room/create",
        body: {
          pool: "endless",
          questions: 10,
          limit: 30,
          name: "Ada",
          turnstileToken: "turnstile-2",
        },
      },
    ]);
  });

  it("joins by code and name, with a check of its own; peeks with the code alone", async () => {
    let checks = 0;
    const s = server((url) => [200, url.endsWith("peek") ? { state: "full" } : seat]);
    const api = createRoomApi(s.fetchFn, async () => `turnstile-${++checks}`);
    await api.join("K7QM2X", "Sam");
    expect(await api.peek("K7QM2X")).toEqual({ state: "full" });
    expect(s.calls).toEqual([
      {
        url: "/api/room/join",
        body: { code: "K7QM2X", name: "Sam", turnstileToken: "turnstile-1" },
      },
      { url: "/api/room/peek", body: { code: "K7QM2X" } },
    ]);
    // Looking costs no check.
    expect(checks).toBe(1);
  });

  it("reads each refusal as what the page can say about it", async () => {
    const cases: [number, unknown, string][] = [
      [409, { error: "conflict", detail: "name_taken" }, "nameTaken"],
      [409, { error: "conflict", detail: "full" }, "full"],
      [409, { error: "conflict", detail: "closed" }, "closed"],
      [422, { error: "nickname_rejected" }, "nameRejected"],
      [400, { error: "bad_request", detail: "nickname_short" }, "nameRejected"],
      [403, { error: "verification_failed" }, "verification"],
      [429, { error: "rate_limited" }, "slowDown"],
      [503, { error: "unavailable" }, "failed"],
      [400, { error: "bad_request", detail: "code must be a room code" }, "failed"],
    ];
    for (const [status, body, problem] of cases) {
      const api = createRoomApi(server(() => [status, body]).fetchFn, async () => "t");
      const err = await api.join("K7QM2X", "Sam").then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ApiFailure);
      expect(seatProblem(err)).toBe(problem);
    }
    expect(seatProblem(new Error("nope"))).toBe("failed");
  });

  it("says the check itself failed when Turnstile couldn't run", async () => {
    const s = server(() => [200, seat]);
    const api = createRoomApi(s.fetchFn, async () => {
      throw new Error("no widget");
    });
    const err = await api.create({ pool: "endless", questions: 10, limit: 20, name: "Ada" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(seatProblem(err)).toBe("verification");
    expect(s.calls).toEqual([]);
  });
});

describe("the room's addresses", () => {
  it("builds the invite link from the 1v1 page and the code", () => {
    expect(inviteLink("https://biggerthangame.com", "K7QM2X")).toBe(
      "https://biggerthangame.com/football-higher-or-lower/legends/multiplayer/1v1?room=K7QM2X",
    );
  });

  it("reads the code back out of it, as typed or pasted", () => {
    expect(roomFromQuery("?room=K7QM2X")).toBe("K7QM2X");
    expect(roomFromQuery("?pool=barcelona&room=k7qm2x")).toBe("K7QM2X");
    expect(roomFromQuery("?room=K7Q-M2X")).toBe("K7QM2X");
    for (const search of [
      "",
      "?room=",
      "?room=K7QM2",
      "?room=K7QM2O",
      "?pool=all",
      "?room=K7QM2XX",
    ]) {
      expect(roomFromQuery(search)).toBeNull();
    }
    expect(roomCodeOf(" k7q m2x ")).toBe("K7QM2X");
    expect(roomCodeOf("hello!")).toBeNull();
  });

  it("puts the room in the page's address and takes it out, keeping the rest", () => {
    expect(withRoom("", "K7QM2X")).toBe("?room=K7QM2X");
    expect(withRoom("?pool=barcelona", "K7QM2X")).toBe("?pool=barcelona&room=K7QM2X");
    expect(withRoom("?room=K7QM2X", null)).toBe("");
    expect(withRoom("?pool=barcelona&room=K7QM2X", null)).toBe("?pool=barcelona");
    expect(withRoom("?room=OLDOLD", "K7QM2X")).toBe("?room=K7QM2X");
  });

  it("opens the socket on the page's own host, secure when the page is", () => {
    expect(socketUrl({ protocol: "https:", host: "biggerthangame.com" }, "K7QM2X")).toBe(
      `wss://biggerthangame.com${ROOM_SOCKET_ENDPOINT}?code=K7QM2X`,
    );
    expect(socketUrl({ protocol: "http:", host: "localhost:4321" }, "K7QM2X")).toBe(
      "ws://localhost:4321/api/room/ws?code=K7QM2X",
    );
  });
});
