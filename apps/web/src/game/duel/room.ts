/**
 * A 1v1 room as this player's page knows it: built from the room's messages
 * (room-protocol.ts in @bt/core) by a pure reducer, so the lobby, the
 * scoreboard, the track and full time are all drawn from one value, and the
 * reducer is tested without a socket.
 *
 * The room decides everything; this only remembers what it said. It holds
 * nothing hidden: a question is the usual `RoundPayload`, the other player's
 * pick is only ever a seat in `locked`, and both arrive in full with the
 * reveal.
 */

import type {
  RoomPhase,
  RoomPlayerView,
  RoomQuestion,
  RoomResult,
  RoomSeries,
  RoomServerMessage,
  RoomSettings,
  TimedGuess,
} from "@bt/core";

/** The question just revealed: both picks, and who was right. */
export interface RevealView {
  readonly index: number;
  /** By seat: the pick, or null for none in time. */
  readonly picks: readonly ("higher" | "lower" | null)[];
  readonly correct: readonly boolean[];
}

export interface DuelView {
  /** This player's seat: 0 is the host. */
  readonly you: number;
  readonly code: string;
  readonly phase: RoomPhase;
  readonly settings: RoomSettings;
  readonly players: readonly RoomPlayerView[];
  /**
   * When the room last said who is here (`performance.now()`): what a dropped
   * player's time to come back is counted down from.
   */
  readonly playersAt: number;
  readonly series: RoomSeries;
  /** The match in play or just played, from 1; 0 before the first. */
  readonly matchNo: number;
  /** By seat. */
  readonly scores: readonly number[];
  /** By seat, right or wrong per question revealed. */
  readonly results: readonly (readonly boolean[])[];
  /** The question open, in a match. */
  readonly question: RoomQuestion | null;
  /** When it closes, on the page's own clock (`performance.now()`). */
  readonly closesAt: number | null;
  /** This player's own pick on it, once made. */
  readonly picked: TimedGuess | null;
  /** The seats that have locked in on it. */
  readonly locked: readonly number[];
  /** The last question revealed in this match. */
  readonly reveal: RevealView | null;
  /** At full time. */
  readonly result: RoomResult | null;
  /** At full time: the seats that have asked for a rematch. */
  readonly rematch: readonly number[];
}

const NO_SERIES: RoomSeries = { wins: [], draws: 0 };

/**
 * The room after `message`, received at `at` (`performance.now()`). Null
 * until the room's `welcome`, which every connection opens with. `closed` and
 * `error` change nothing here: they are the page's to act on.
 */
export function reduceRoom(
  view: DuelView | null,
  message: RoomServerMessage,
  at: number,
): DuelView | null {
  if (message.t === "welcome") {
    const { room } = message;
    const question = room.question ?? null;
    return {
      you: message.you,
      code: room.code,
      phase: room.phase,
      settings: room.settings,
      players: room.players,
      playersAt: at,
      series: room.series,
      matchNo: room.match?.no ?? 0,
      scores: room.match?.scores ?? room.players.map(() => 0),
      results: room.match?.results ?? room.players.map(() => []),
      question,
      closesAt: question === null ? null : at + question.closesInMs,
      picked: room.picked ?? null,
      locked: room.locked ?? [],
      reveal: null,
      result: room.result ?? null,
      rematch: room.rematch ?? [],
    };
  }
  if (view === null) return null;
  switch (message.t) {
    case "players":
      return { ...view, phase: message.phase, players: message.players, playersAt: at };

    case "question": {
      const { question } = message;
      const fresh = question.match !== view.matchNo || question.round.index === 1;
      const seats = Math.max(view.scores.length, view.players.length, 2);
      return {
        ...view,
        phase: "playing",
        matchNo: question.match,
        scores: fresh ? Array.from({ length: seats }, () => 0) : view.scores,
        results: fresh ? Array.from({ length: seats }, () => []) : view.results,
        question,
        closesAt: at + question.closesInMs,
        picked: null,
        locked: [],
        reveal: null,
        result: null,
        rematch: [],
      };
    }

    case "locked":
      return view.locked.includes(message.seat)
        ? view
        : { ...view, locked: [...view.locked, message.seat] };

    case "reveal": {
      const index = message.reveal.round;
      // A reveal seen twice (a reconnect's snapshot already counted it) adds nothing.
      const counted = (view.results[0]?.length ?? 0) >= index;
      const results = counted
        ? view.results
        : message.correct.map((right, seat) => [...(view.results[seat] ?? []), right]);
      const next = message.next ?? null;
      const base = {
        ...view,
        scores: message.scores,
        results,
        reveal: { index, picks: message.picks, correct: message.correct },
        picked: null,
        locked: [],
      };
      if (message.end !== undefined) {
        return {
          ...base,
          phase: "fulltime",
          question: null,
          closesAt: null,
          result: message.end.result,
          series: message.end.series,
        };
      }
      return { ...base, question: next, closesAt: next === null ? null : at + next.closesInMs };
    }

    case "fulltime":
      return {
        ...view,
        phase: "fulltime",
        players: message.players,
        playersAt: at,
        question: null,
        closesAt: null,
        picked: null,
        locked: [],
        result: message.result,
        scores: message.result.scores,
        results: message.result.results,
        series: message.series,
        rematch: [],
      };

    case "rematch":
      return { ...view, rematch: message.seats };

    case "closed":
    case "error":
      return view;
  }
}

/**
 * The room as it stood before its last reveal was counted: the score and the
 * track as they should read while that reveal is still playing on screen, so
 * the scoreboard never gives a question away before its figure has shown.
 */
export function beforeReveal(view: DuelView): DuelView {
  const { reveal } = view;
  if (reveal === null) return view;
  return {
    ...view,
    scores: view.scores.map((score, seat) => score - (reveal.correct[seat] === true ? 1 : 0)),
    results: view.results.map((results) =>
      results.length >= reveal.index ? results.slice(0, reveal.index - 1) : results,
    ),
  };
}

/** This player's own pick, as the page locked it in: shown before the room echoes anything. */
export function withPick(view: DuelView, pick: TimedGuess): DuelView {
  return {
    ...view,
    picked: pick,
    locked: view.locked.includes(view.you) ? view.locked : [...view.locked, view.you],
  };
}

/** This player, as the room lists them. */
export function me(view: DuelView): RoomPlayerView | undefined {
  return view.players.find((p) => p.seat === view.you);
}

/** The other player; undefined while the seat is free. */
export function opponent(view: DuelView): RoomPlayerView | undefined {
  return view.players.find((p) => p.seat !== view.you);
}

/** The other player's seat, whether or not anyone holds it. */
export function opponentSeat(view: DuelView): number {
  return view.you === 0 ? 1 : 0;
}

/** Both scores, this player's first. */
export function duelScore(view: Pick<DuelView, "you" | "scores">): {
  readonly you: number;
  readonly them: number;
} {
  const them = view.you === 0 ? 1 : 0;
  return { you: view.scores[view.you] ?? 0, them: view.scores[them] ?? 0 };
}

/** The series so far, this player's wins first. */
export function duelSeries(view: Pick<DuelView, "you" | "series">): {
  readonly you: number;
  readonly them: number;
  readonly draws: number;
} {
  const series = view.series ?? NO_SERIES;
  const them = view.you === 0 ? 1 : 0;
  return {
    you: series.wins[view.you] ?? 0,
    them: series.wins[them] ?? 0,
    draws: series.draws,
  };
}

/** One question, both players: right or wrong. */
export interface DuelQuestion {
  readonly index: number;
  readonly you: boolean;
  readonly them: boolean;
}

/** The match question by question, for the track and the strip, sudden death included. */
export function duelQuestions(view: Pick<DuelView, "you" | "results">): DuelQuestion[] {
  const them = view.you === 0 ? 1 : 0;
  const mine = view.results[view.you] ?? [];
  const theirs = view.results[them] ?? [];
  return mine.map((right, i) => ({ index: i + 1, you: right, them: theirs[i] === true }));
}

/** How a finished match went for this player. */
export type DuelOutcome = "won" | "lost" | "draw";

export function duelOutcome(view: Pick<DuelView, "you" | "result">): DuelOutcome | null {
  const { result } = view;
  if (result === null) return null;
  if (result.winner === null) return "draw";
  return result.winner === view.you ? "won" : "lost";
}

/** Whether everyone in the room is connected and ready: what the host's Start waits for. */
export function canStart(view: DuelView): boolean {
  return (
    view.phase === "lobby" &&
    view.players.length >= 2 &&
    view.players.every((p) => p.connected && p.ready && p.left !== true)
  );
}

/** Whether a rematch can still happen: nobody has left the room. */
export function canRematch(view: DuelView): boolean {
  return (
    view.phase === "fulltime" &&
    view.players.length >= 2 &&
    view.players.every((p) => p.left !== true)
  );
}
