/**
 * A multiplayer room, as a pure state machine (ARCHITECTURE.md §8, "1v1
 * rooms"):
 *
 *   lobby → playing → full time → [rematch → playing …] → closed
 *
 * The room's Durable Object is a thin wrapper round `step`: it turns a
 * request, a socket message or an alarm into a `RoomInput`, keeps the state
 * this returns, sends what `out` says and sets its alarm to `wakeAt`. Nothing
 * here reads a clock, a socket or the deck: the time comes in on every input,
 * and the questions come through `RoomDeps.facts`, which says only which way
 * a question goes. So the whole room is tested in Node, and a room never
 * depends on a client being there: the question's deadline, the wait for a
 * player who dropped mid-match and the idle expiry all pass through `tick`.
 *
 * Built for 2 to 10 players with the rules of the mode injected
 * (`RoomRules`): how many play, what follows each reveal, who wins on a
 * forfeit. 1v1 (`DUEL_RULES`) is the only mode there is; Last Man Standing
 * will be another set of rules over the same machine.
 *
 * **Every input is checked against the room as it stands.** One that doesn't
 * fit (an answer after the reveal, a second answer, a start from the guest or
 * before everyone is ready, a rematch mid-match) is refused with a code and
 * changes nothing.
 *
 * Being away is only a status in the lobby and at full time: a player who
 * drops there keeps their seat until they leave or the room expires. Only in
 * a match does it run a clock (`REJOIN_MS`), after which they forfeit.
 *
 * A room stays open while anyone is connected to it: a host waiting in the
 * lobby keeps it. The idle expiry (`ROOM_IDLE_MS`) runs only while nobody
 * is, from the moment the last player went or the last thing one did. Being
 * connected is not enough for ever, though: outside a match, a room nobody
 * has done anything in for `ROOM_QUIET_MS` closes whoever is still there (a
 * tab left open is not a player).
 */

import type { Guess, TimedGuess } from "./api.js";
import { DUEL_PLAYERS, SUDDEN_DEATH_MAX, duelDeadline } from "./duel.js";
import { cleanNickname } from "./nickname.js";
import type {
  MatchEndReason,
  RoomClosedReason,
  RoomErrorCode,
  RoomJoinRefusal,
  RoomMode,
  RoomPlayerView,
  RoomResult,
  RoomSeries,
  RoomSettings,
} from "./room-protocol.js";

/** How long a player who drops mid-match has to come back before they forfeit. */
export const REJOIN_MS = 30_000;

/** A room with nobody connected closes once nobody has been in it, or done anything, for this long. */
export const ROOM_IDLE_MS = 15 * 60_000;

/**
 * Outside a match, a room closes once no player has done anything in it for
 * this long (made it, joined, readied, started, answered, asked for a
 * rematch), even with someone still connected.
 */
export const ROOM_QUIET_MS = 2 * 60 * 60_000;

// ------------------------------------------------------------------ rules

/** What the machine may know about a question: which way it goes, and whether the wheel spins. */
export interface QuestionFacts {
  readonly answer: Guess;
  readonly statChanged: boolean;
}

/** A match just after a reveal, as the rules judge it. */
export interface MatchProgress {
  /** The match's questions before any sudden death. */
  readonly questions: number;
  /** The question just revealed, from 1. */
  readonly index: number;
  /** By seat, this question counted. */
  readonly scores: readonly number[];
  /** Whether the pool can deal another question. */
  readonly more: boolean;
}

export type Settlement =
  | { readonly next: true }
  | {
      readonly next: false;
      readonly winner: number | null;
      readonly reason: Exclude<MatchEndReason, "forfeit">;
    };

/** A mode's rules: everything about a room that differs between modes. */
export interface RoomRules {
  readonly mode: RoomMode;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** After each reveal: another question, or the match's result. */
  settle(progress: MatchProgress): Settlement;
  /** Who wins when `seat` forfeits, or null. */
  forfeit(seat: number, scores: readonly number[]): number | null;
  /** The server's deadline on question `index`, issued at `issuedAt`. */
  deadline(settings: RoomSettings, issuedAt: number, index: number, statChanged: boolean): number;
}

/**
 * 1v1's rules (DESIGN.md §3): two players, every question played, the higher
 * score wins. Level after the last question, extra questions are played until
 * one player is right and the other wrong, `SUDDEN_DEATH_MAX` at most; still
 * level then, or when the pool runs out, it is a draw.
 */
export const DUEL_RULES: RoomRules = {
  mode: "duel",
  minPlayers: DUEL_PLAYERS,
  maxPlayers: DUEL_PLAYERS,
  settle({ questions, index, scores, more }) {
    const [host = 0, guest = 0] = scores;
    const leader = host === guest ? null : host > guest ? 0 : 1;
    if (index < questions) {
      return more ? { next: true } : { next: false, winner: leader, reason: "exhausted" };
    }
    if (leader !== null) {
      const reason = index > questions ? "sudden-death" : "finished";
      return { next: false, winner: leader, reason };
    }
    if (index - questions >= SUDDEN_DEATH_MAX) return { next: false, winner: null, reason: "draw" };
    return more ? { next: true } : { next: false, winner: null, reason: "exhausted" };
  },
  forfeit: (seat) => (seat === 0 ? 1 : 0),
  deadline: (settings, issuedAt, index, statChanged) =>
    duelDeadline(issuedAt, index, statChanged, settings.limit, settings.pool),
};

// ------------------------------------------------------------------ state

/** A player in a seat. */
export interface RoomSeat {
  /** A random id only the server and this player's token know. */
  readonly id: string;
  readonly name: string;
  readonly ready: boolean;
  readonly connected: boolean;
  /** When they dropped; null while connected. Only a match counts it down. */
  readonly awaySince: number | null;
  /** They left the room or forfeited: the seat stays theirs, and shut. */
  readonly left: boolean;
}

export interface MatchOutcome {
  readonly winner: number | null;
  readonly reason: MatchEndReason;
  /** On a forfeit: who left. */
  readonly left?: number;
  readonly endedAt: number;
}

export interface RoomMatch {
  /** From 1 within the room. */
  readonly no: number;
  /** What the match's seed is derived from: `YYYYMMDD-<uuid>`, minted by the server. */
  readonly id: string;
  readonly startedAt: number;
  /** The question open, from 1; the last one played once the match is over. */
  readonly index: number;
  readonly issuedAt: number;
  readonly deadline: number;
  /** By seat, on the open question. Never sent before its reveal. */
  readonly picks: readonly (TimedGuess | null)[];
  /** By seat, right or wrong per question revealed. */
  readonly results: readonly (readonly boolean[])[];
  readonly scores: readonly number[];
  readonly result: MatchOutcome | null;
}

export type RoomStatePhase = "lobby" | "playing" | "fulltime" | "closed";

/** The whole room. JSON all the way down: the Durable Object stores it as one row. */
export interface RoomState {
  readonly v: 1;
  /** This room's own key, `YYYYMMDD-<uuid>`: what its tokens are bound to. Never the code. */
  readonly key: string;
  readonly code: string;
  readonly settings: RoomSettings;
  readonly phase: RoomStatePhase;
  /** Seat 0 is the host. A free seat is null. */
  readonly seats: readonly (RoomSeat | null)[];
  /** The match in play, or the last one played. */
  readonly match: RoomMatch | null;
  /** Matches won, by seat. */
  readonly wins: readonly number[];
  readonly draws: number;
  /** Matches finished. */
  readonly played: number;
  /** The seats that have asked for a rematch, at full time. */
  readonly rematch: readonly number[];
  readonly createdAt: number;
  /**
   * The last thing a player did, or the last moment one went away: what the
   * idle expiry counts from, once nobody is connected.
   */
  readonly lastActivity: number;
  /**
   * The last thing a player chose to do: make the room, join it, ready,
   * start, answer or ask for a rematch. Not a connection coming or going,
   * and not a clock running out. What `ROOM_QUIET_MS` counts from.
   */
  readonly lastAction: number;
  readonly closed: RoomClosedReason | null;
}

// ----------------------------------------------------------------- inputs

interface Timed {
  /** The server's clock, ms since the epoch. */
  readonly now: number;
}

export type RoomInput =
  | (Timed & {
      readonly type: "join";
      readonly player: { readonly id: string; readonly name: string };
    })
  /** The seat's socket is up, its token checked. */
  | (Timed & { readonly type: "connect"; readonly seat: number })
  /** The seat's socket has gone. */
  | (Timed & { readonly type: "disconnect"; readonly seat: number })
  | (Timed & { readonly type: "ready"; readonly seat: number; readonly ready: boolean })
  /** `match`: the id the match is dealt from, if this starts one. */
  | (Timed & { readonly type: "start"; readonly seat: number; readonly match: string })
  | (Timed & {
      readonly type: "answer";
      readonly seat: number;
      readonly index: number;
      readonly pick: TimedGuess;
    })
  | (Timed & { readonly type: "rematch"; readonly seat: number; readonly match: string })
  | (Timed & { readonly type: "leave"; readonly seat: number })
  /** The alarm: nothing but the time. */
  | (Timed & { readonly type: "tick" });

export interface RoomDeps {
  readonly rules: RoomRules;
  /**
   * Question `index` of the match dealt from `match`, or undefined when the
   * pool can deal no such question. Must answer for a match about to start
   * (a `start` or `rematch` input's) as well as the one in play.
   */
  facts(match: string, index: number): QuestionFacts | undefined;
}

// ---------------------------------------------------------------- outputs

/** A match's start or end, for the analytics and the logs. Never a name. */
export type RoomRecord =
  | {
      readonly kind: "start";
      readonly match: number;
      readonly id: string;
    }
  | {
      readonly kind: "end";
      readonly match: number;
      readonly id: string;
      readonly reason: MatchEndReason;
      readonly winner: number | null;
      readonly scores: readonly number[];
      /** Sudden-death questions played. */
      readonly suddenDeath: number;
    };

/**
 * What a step asks of the wrapper, in order. Abstract: the wrapper renders
 * each for the seats it goes to, from the state the step returned.
 */
export type RoomOutput =
  /** A join was accepted: the new player's seat. */
  | { readonly type: "joined"; readonly seat: number }
  /** The whole room, to the seat that has just connected. */
  | { readonly type: "welcome"; readonly seat: number }
  /** The players changed: to everyone. */
  | { readonly type: "players" }
  /** A match has started: its first question, to everyone. */
  | { readonly type: "question" }
  /** `seat` has answered: to everyone, never which way. */
  | { readonly type: "locked"; readonly seat: number }
  /**
   * Question `index` is revealed, with everyone's picks: to everyone, with the
   * next question or, when `ended`, the result.
   */
  | {
      readonly type: "reveal";
      readonly index: number;
      readonly picks: readonly (TimedGuess | null)[];
      readonly correct: readonly boolean[];
      readonly ended: boolean;
    }
  /** The match ended without a reveal (a forfeit): the result, to everyone. */
  | { readonly type: "fulltime" }
  /** Who has asked for a rematch: to everyone. */
  | { readonly type: "rematch" }
  /** The input was refused. `seat` is null for a join. */
  | {
      readonly type: "refused";
      readonly seat: number | null;
      readonly code: RoomErrorCode | RoomJoinRefusal;
    }
  /** The room is closed for `seat`, or for everyone not already told: say why and hang up. */
  | { readonly type: "closed"; readonly seat: number | "all"; readonly reason: RoomClosedReason }
  | { readonly type: "record"; readonly event: RoomRecord };

export interface RoomStep {
  readonly state: RoomState;
  readonly out: readonly RoomOutput[];
}

// --------------------------------------------------------------- creation

export interface NewRoom {
  readonly now: number;
  readonly key: string;
  readonly code: string;
  readonly settings: RoomSettings;
  readonly host: { readonly id: string; readonly name: string };
}

/** A new room, its host in seat 0 and not yet connected. */
export function createRoom(room: NewRoom, rules: RoomRules): RoomState {
  const seats: (RoomSeat | null)[] = Array.from({ length: rules.maxPlayers }, () => null);
  seats[0] = seat(room.host.id, room.host.name);
  return {
    v: 1,
    key: room.key,
    code: room.code,
    settings: room.settings,
    phase: "lobby",
    seats,
    match: null,
    wins: seats.map(() => 0),
    draws: 0,
    played: 0,
    rematch: [],
    createdAt: room.now,
    lastActivity: room.now,
    lastAction: room.now,
    closed: null,
  };
}

function seat(id: string, name: string): RoomSeat {
  return { id, name, ready: false, connected: false, awaySince: null, left: false };
}

// ------------------------------------------------------------------ views

/** The seat `playerId` holds, or undefined: a player who left holds none. */
export function seatOf(state: RoomState, playerId: string): number | undefined {
  const index = state.seats.findIndex((s) => s !== null && s.id === playerId && !s.left);
  return index === -1 ? undefined : index;
}

/** The players as everyone sees them, as at `now`. */
export function roomPlayers(state: RoomState, now: number): RoomPlayerView[] {
  const views: RoomPlayerView[] = [];
  state.seats.forEach((s, index) => {
    if (s === null) return;
    const counting = state.phase === "playing" && s.awaySince !== null && !s.left;
    views.push({
      seat: index,
      name: s.name,
      ready: s.ready,
      connected: s.connected,
      ...(counting ? { rejoinInMs: Math.max(0, s.awaySince + REJOIN_MS - now) } : {}),
      ...(s.left ? { left: true as const } : {}),
    });
  });
  return views;
}

export function roomSeries(state: RoomState): RoomSeries {
  return { wins: state.wins, draws: state.draws };
}

/** The last match's result, as the players see it. Undefined while it is still in play. */
export function roomResult(state: RoomState): RoomResult | undefined {
  const match = state.match;
  if (match === null || match.result === null) return undefined;
  return {
    winner: match.result.winner,
    reason: match.result.reason,
    scores: match.scores,
    results: match.results,
    questions: state.settings.questions,
    ...(match.result.left !== undefined ? { left: match.result.left } : {}),
  };
}

/** Someone is connected to the room: the idle expiry doesn't run. */
export function anyoneConnected(state: Pick<RoomState, "seats">): boolean {
  return state.seats.some((s) => s !== null && !s.left && s.connected);
}

/**
 * When a room that is not in a match runs out of time: `ROOM_QUIET_MS` after
 * the last thing a player did, whoever is connected; and with nobody
 * connected, `ROOM_IDLE_MS` after the last of them went, if that comes first.
 */
function expiresAt(state: Pick<RoomState, "seats" | "lastActivity" | "lastAction">): number {
  const quiet = state.lastAction + ROOM_QUIET_MS;
  return anyoneConnected(state) ? quiet : Math.min(quiet, state.lastActivity + ROOM_IDLE_MS);
}

/**
 * The room has run out of time as at `now` (never in a match). The one
 * statement of the rule: the machine closes on it, and a caller asking before
 * the alarm has fired reads the same answer.
 */
export function roomExpired(
  state: Pick<RoomState, "phase" | "seats" | "lastActivity" | "lastAction">,
  now: number,
): boolean {
  if (state.phase === "playing" || state.phase === "closed") return false;
  return now >= expiresAt(state);
}

/**
 * When the room next needs waking with a `tick`, or null for a closed room:
 * the open question's deadline or a dropped player's forfeit in a match, and
 * otherwise when it runs out of time.
 */
export function wakeAt(state: RoomState): number | null {
  if (state.phase === "closed") return null;
  if (state.phase !== "playing" || state.match === null) return expiresAt(state);
  let at = state.match.deadline;
  for (const s of state.seats) {
    if (s !== null && !s.left && s.awaySince !== null) at = Math.min(at, s.awaySince + REJOIN_MS);
  }
  return at;
}

// ------------------------------------------------------------------- step

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface Draft extends Mutable<Omit<RoomState, "seats" | "match" | "wins" | "rematch">> {
  seats: (Mutable<RoomSeat> | null)[];
  match: DraftMatch | null;
  wins: number[];
  rematch: number[];
}
interface DraftMatch extends Mutable<Omit<RoomMatch, "picks" | "results" | "scores">> {
  picks: (TimedGuess | null)[];
  results: boolean[][];
  scores: number[];
}

/**
 * The room after `input`, and what to send. `state` is never changed: the
 * same state and input always give the same step.
 */
export function step(state: RoomState, input: RoomInput, deps: RoomDeps): RoomStep {
  // The state is JSON by construction (the wrapper stores it as such), so this is a deep copy.
  const draft = JSON.parse(JSON.stringify(state)) as Draft;
  const out: RoomOutput[] = [];
  if (draft.phase === "closed") {
    if (input.type !== "tick" && input.type !== "disconnect") {
      out.push({ type: "refused", seat: seatIn(input), code: "out_of_turn" });
    }
    return { state, out };
  }

  // Time first: whatever was due by now has happened before this input is read,
  // so an answer that arrives after its deadline finds the question revealed.
  passTime(draft, input.now, deps, out);
  // (Read again: time passing may have closed the room.)
  if ((draft.phase as RoomStatePhase) !== "closed") apply(draft, input, deps, out);
  return { state: draft as RoomState, out };
}

function seatIn(input: RoomInput): number | null {
  return "seat" in input ? input.seat : null;
}

/** Everything the clock alone decides, as at `now`. */
function passTime(draft: Draft, now: number, deps: RoomDeps, out: RoomOutput[]): void {
  if (draft.phase !== "playing") {
    if (roomExpired(draft, now)) close(draft, "expired", out);
    return;
  }
  // A long gap can hold several deadlines: each reveal opens the next question at `now`,
  // so one pass settles it. The bound is only a guard.
  for (let guard = 0; guard < 4 && draft.phase === "playing" && draft.match !== null; guard++) {
    const gone = draft.seats.findIndex(
      (s) => s !== null && !s.left && s.awaySince !== null && now >= s.awaySince + REJOIN_MS,
    );
    if (gone !== -1) {
      forfeit(draft, gone, now, deps, out);
      return;
    }
    if (now < draft.match.deadline) return;
    reveal(draft, now, deps, out);
  }
}

function apply(draft: Draft, input: RoomInput, deps: RoomDeps, out: RoomOutput[]): void {
  const { now } = input;
  const refuse = (code: RoomErrorCode | RoomJoinRefusal): void => {
    out.push({ type: "refused", seat: seatIn(input), code });
  };
  if (input.type === "tick") return;

  if (input.type === "join") {
    if (draft.phase !== "lobby") return refuse("full");
    const free = draft.seats.findIndex((s) => s === null);
    if (free === -1) return refuse("full");
    const wanted = nameKey(input.player.name);
    if (draft.seats.some((s) => s !== null && nameKey(s.name) === wanted)) {
      return refuse("name_taken");
    }
    draft.seats[free] = seat(input.player.id, input.player.name);
    draft.lastActivity = now;
    draft.lastAction = now;
    out.push({ type: "joined", seat: free }, { type: "players" });
    return;
  }

  const player = draft.seats[input.seat];
  if (player === undefined || player === null || player.left) return refuse("bad_token");

  switch (input.type) {
    case "connect":
      player.connected = true;
      player.awaySince = null;
      draft.lastActivity = now;
      out.push({ type: "welcome", seat: input.seat }, { type: "players" });
      return;

    case "disconnect":
      if (!player.connected) return;
      player.connected = false;
      player.awaySince = now;
      // They were here until now: an empty room's fifteen minutes start from this.
      draft.lastActivity = now;
      out.push({ type: "players" });
      return;

    case "ready":
      if (draft.phase !== "lobby") return refuse("out_of_turn");
      player.ready = input.ready;
      draft.lastActivity = now;
      draft.lastAction = now;
      out.push({ type: "players" });
      return;

    case "start": {
      if (draft.phase !== "lobby") return refuse("out_of_turn");
      if (input.seat !== 0) return refuse("not_host");
      const here = draft.seats.filter((s) => s !== null);
      if (here.length < deps.rules.minPlayers || !here.every((s) => s.connected && s.ready)) {
        return refuse("not_ready");
      }
      if (!begin(draft, input.match, now, deps, out)) return refuse("unavailable");
      return;
    }

    case "answer": {
      const match = draft.match;
      if (draft.phase !== "playing" || match === null) return refuse("out_of_turn");
      if (input.index !== match.index || match.picks[input.seat] !== null) {
        return refuse("out_of_turn");
      }
      match.picks[input.seat] = input.pick;
      draft.lastActivity = now;
      // The page sends `timeout` by itself when its clock runs out: nobody did that.
      if (input.pick !== "timeout") draft.lastAction = now;
      out.push({ type: "locked", seat: input.seat });
      const waiting = draft.seats.some((s, i) => s !== null && !s.left && match.picks[i] === null);
      if (!waiting) reveal(draft, now, deps, out);
      return;
    }

    case "rematch": {
      if (draft.phase !== "fulltime") return refuse("out_of_turn");
      if (draft.seats.some((s) => s === null || s.left)) return refuse("opponent_left");
      draft.lastActivity = now;
      draft.lastAction = now;
      if (!draft.rematch.includes(input.seat)) draft.rematch.push(input.seat);
      if (draft.rematch.length < draft.seats.length) {
        out.push({ type: "rematch" });
        return;
      }
      if (!begin(draft, input.match, now, deps, out)) {
        draft.rematch = draft.rematch.filter((s) => s !== input.seat);
        return refuse("unavailable");
      }
      return;
    }

    case "leave":
      draft.lastActivity = now;
      if (draft.phase === "playing") {
        forfeit(draft, input.seat, now, deps, out);
        return;
      }
      if (draft.phase === "lobby") {
        out.push({ type: "closed", seat: input.seat, reason: "left" });
        // The host's room goes with them; a guest's seat is free again.
        if (input.seat === 0) {
          close(draft, "host-left", out);
          return;
        }
        draft.seats[input.seat] = null;
        out.push({ type: "players" });
        return;
      }
      // Full time: the seat stays theirs, shut, so the result still names them.
      shut(player);
      draft.rematch = [];
      out.push({ type: "closed", seat: input.seat, reason: "left" });
      if (draft.seats.every((s) => s === null || s.left)) close(draft, "empty", out);
      else out.push({ type: "players" }, { type: "rematch" });
      return;
  }
}

/** Two names are the same in a room when they read the same, whatever the case. */
function nameKey(name: string): string {
  return cleanNickname(name).toLowerCase();
}

function shut(player: Mutable<RoomSeat>): void {
  player.left = true;
  player.connected = false;
  player.awaySince = null;
  player.ready = false;
}

/** Starts a match dealt from `id`. False, and nothing changed, when its first question can't be dealt. */
function begin(draft: Draft, id: string, now: number, deps: RoomDeps, out: RoomOutput[]): boolean {
  const first = deps.facts(id, 1);
  if (first === undefined) return false;
  const no = draft.played + 1;
  draft.match = {
    no,
    id,
    startedAt: now,
    index: 1,
    issuedAt: now,
    deadline: deps.rules.deadline(draft.settings, now, 1, first.statChanged),
    picks: draft.seats.map(() => null),
    results: draft.seats.map(() => []),
    scores: draft.seats.map(() => 0),
    result: null,
  };
  draft.phase = "playing";
  draft.rematch = [];
  draft.lastActivity = now;
  draft.lastAction = now;
  for (const s of draft.seats) {
    if (s === null) continue;
    s.ready = false;
    // Away since before the match (a rematch): the time to come back runs from its start.
    if (s.awaySince !== null) s.awaySince = now;
  }
  out.push({ type: "question" }, { type: "record", event: { kind: "start", match: no, id } });
  return true;
}

/** Reveals the open question as at `now`: a seat with no pick, or a `timeout`, got it wrong. */
function reveal(draft: Draft, now: number, deps: RoomDeps, out: RoomOutput[]): void {
  const match = draft.match;
  if (match === null) return;
  const { index } = match;
  const facts = deps.facts(match.id, index);
  const picks = [...match.picks];
  const correct = picks.map((pick) => facts !== undefined && pick === facts.answer);
  correct.forEach((right, i) => {
    if (draft.seats[i] === null) return;
    match.results[i]!.push(right);
    if (right) match.scores[i]! += 1;
  });

  const following = deps.facts(match.id, index + 1);
  const settled = deps.rules.settle({
    questions: draft.settings.questions,
    index,
    scores: match.scores,
    more: following !== undefined,
  });
  if (settled.next && following !== undefined) {
    match.index = index + 1;
    match.issuedAt = now;
    match.deadline = deps.rules.deadline(draft.settings, now, index + 1, following.statChanged);
    match.picks = draft.seats.map(() => null);
    out.push({ type: "reveal", index, picks, correct, ended: false });
    return;
  }
  const result: MatchOutcome = settled.next
    ? { winner: null, reason: "exhausted", endedAt: now }
    : { winner: settled.winner, reason: settled.reason, endedAt: now };
  finish(draft, result, now);
  out.push({ type: "reveal", index, picks, correct, ended: true });
  out.push({ type: "record", event: endRecord(draft, result) });
}

/** `seat` forfeits the match in play: they are out of the room, and the rules say who wins. */
function forfeit(
  draft: Draft,
  seatNo: number,
  now: number,
  deps: RoomDeps,
  out: RoomOutput[],
): void {
  const match = draft.match;
  const player = draft.seats[seatNo];
  if (match === null || player === null || player === undefined) return;
  shut(player);
  const result: MatchOutcome = {
    winner: deps.rules.forfeit(seatNo, match.scores),
    reason: "forfeit",
    left: seatNo,
    endedAt: now,
  };
  finish(draft, result, now);
  out.push({ type: "fulltime" });
  out.push({ type: "closed", seat: seatNo, reason: "left" });
  out.push({ type: "record", event: endRecord(draft, result) });
}

function finish(draft: Draft, result: MatchOutcome, now: number): void {
  if (draft.match === null) return;
  draft.match.result = result;
  draft.phase = "fulltime";
  draft.played += 1;
  draft.rematch = [];
  // Full time starts the idle clock afresh, however long the match went unanswered.
  draft.lastActivity = now;
  if (result.winner === null) draft.draws += 1;
  else draft.wins[result.winner] = (draft.wins[result.winner] ?? 0) + 1;
}

function endRecord(draft: Draft, result: MatchOutcome): RoomRecord {
  const match = draft.match!;
  const played = match.results.reduce((most, r) => Math.max(most, r.length), 0);
  return {
    kind: "end",
    match: match.no,
    id: match.id,
    reason: result.reason,
    winner: result.winner,
    scores: [...match.scores],
    suddenDeath: Math.max(0, played - draft.settings.questions),
  };
}

function close(draft: Draft, reason: RoomClosedReason, out: RoomOutput[]): void {
  draft.phase = "closed";
  draft.closed = reason;
  out.push({ type: "closed", seat: "all", reason });
}
