/**
 * Gameplay events → Workers Analytics Engine, and the run start and end lines
 * in Workers Logs (ARCHITECTURE.md §19).
 *
 * The round handler (round.ts) records what happened as a `GameEvent`, after
 * the server has judged it; app.ts adds the country and the deck version and
 * writes it here. Four events: `start` when a run is begun, `answer` for every
 * answered round, `end` when an answer ends the run, and `leave` when the page
 * reports the player going mid-run (leave.ts). A run with a start and no end
 * was abandoned; its leaves say where. A fifth, `submit`, for every attempt to
 * publish a real run to the boards (submit.ts), published or refused.
 *
 * Every data point shares one layout, so a column means the same thing in
 * every event:
 *
 *   index1  the run key: the run id's body, before the "." (never the signature)
 *   blob1   event        "start" | "answer" | "end" | "leave"
 *   blob2   mode         "friendly" | "endless", or for an Endless variant its id
 *                        ("endless-instagram"), so every per-mode query splits it out;
 *                        "squad" for every "Clear the squad" theme (its id in blob10)
 *   blob3   run kind     "fresh" | "challenge" (Endless, a fresh run against a link's
 *                        score) | "replay" (Friendly's retired challenge replays)
 *   blob4   deck version "legends-107-3f9c21e0"
 *   blob5   country      request.cf.country; "XX" when unknown
 *   answer: blob6 stat id, blob7 tier, blob8 band, blob9 final question ("1" | "0");
 *           double1 round, double2 correct (1 | 0), double3 streak after the answer,
 *           double4 relaxation step (0–3), double5 rank distance of the pair (0–1),
 *           double6 server-measured answer time in ms, token issue to guess received
 *           (Endless only; absent, so 0, in Friendly, which has no clock)
 *   end:    blob6 end reason ("wrong" | "won" | "deck-exhausted" | "timeout" |
 *           "disconnected"); double1 final score
 *   leave:  blob6 phase ("intro" | "question" | "reveal" | "other"), blob7 trigger
 *           ("hidden" | "pagehide"), blob8 stat id ("" on the intro); double1 round (0 on
 *           the intro)
 *   submit: blob6 published ("1" | "0"), blob7 shadowed ("1" | "0"), blob8 the day
 *           rank's bucket ("1-10" | "11-100" | "101-1000" | "1000+"; "" if refused),
 *           blob9 why it was refused ("" if published); double1 the run's score
 *   resume: (Daily Ranked) blob6 whether the open question had timed out ("1" | "0");
 *           double1 the game number, double2 the round on screen after it
 *   Daily Ranked ("ranked" in blob2) adds its game number: start double1 the game,
 *           double2 how many runs of the game had already started from the same
 *           connection (a count, from a salted hash kept 48 hours; never the hash);
 *           answer double7 the game; end double2 the game, double3 right answers
 *           out of twenty, double4 bonus rounds; submit (the run posted to its
 *           board, there being no submit step) double2 the game
 *   blob10  theme        "Clear the squad" only, on every event: the theme id
 *                        ("club-barcelona"); absent (so "") for every other mode. The
 *                        events' own blobs above are padded to reach it.
 *   Twitch Mode ("stream" in blob2, whatever its pool) adds, on every event, blob10 the
 *           theme id for a squad pool ("" otherwise) and blob11 the pool
 *           ("endless" | "endless-instagram" | "squad:<theme id>"); start double1 the
 *           questions, double2 the limit in seconds; answer blob12 chat's outcome
 *           ("right" | "wrong" | "split" | "none"; "" when the page sent none),
 *           double3 the streamer's right answers so far, double7 0, double8 that
 *           question's voters; end blob6 "finished" | "deck-exhausted" |
 *           "disconnected", double1 the streamer's score, double2 the questions,
 *           double3 the limit, double4 chat's score, double5 the peak voters on one
 *           question. Counts only: never a message, a name or an id from chat.
 *
 * Privacy (§19): nothing personal — no IP (Daily's repeat-connection figure is
 * a count; the salted hash behind it stays in D1 for 48 hours), no user agent, no
 * cookie, nothing kept in the browser. Country only. No stat value in a data
 * point: the rank distance is a position in the deck, of two figures both
 * already revealed, and never reaches the client. The `run_end` log line does
 * carry the final round's two figures, which the ending response has just
 * revealed — or, for an Endless run closed as `disconnected`, only the anchor's,
 * the figure on screen — and a `run_leave` line the figures the player had been
 * shown: the anchor's from the question on, the challenger's only once revealed.
 *
 * Fire-and-forget: `writeDataPoint` doesn't block, and a missing or throwing
 * binding (local dev, tests, an outage) is swallowed. The response and its
 * timing never depend on it.
 */

import {
  DAILY_QUESTIONS,
  STATS,
  bandForRound,
  isFinalRound,
  isSquadVariantId,
  percentiles,
  rankDistance,
  themeIdOf,
  valueOf,
} from "@bt/core";
import type {
  Band,
  BandRules,
  LeavePhase,
  LeaveTrigger,
  Mode,
  NamedVariant,
  Player,
  Relaxation,
  Round,
  RunEnd,
  StatKey,
  StreamLimit,
  StreamPool,
  Tier,
  TimedGuess,
} from "@bt/core";
import type { StoredPlayer, StoredRound } from "./daily-game.js";
import type { LogLine } from "./log.js";
import { figureFor } from "./payload.js";

/** Analytics Engine's limit on an index. */
export const MAX_INDEX_BYTES = 96;

/** The dataset, as named in wrangler.toml. The SQL API's table name. */
export const DATASET = "biggerthan_game_events";

/** Cloudflare's own code for a country it couldn't tell. */
export const UNKNOWN_COUNTRY = "XX";

/**
 * `fresh`: a run of its own. `challenge`: an Endless run started from a
 * challenge link, fresh rounds against the link's score. `replay`: Friendly's
 * old challenge replays, no longer minted, kept so older data still reads.
 */
export type RunKind = "fresh" | "challenge" | "replay";

/** A Twitch Mode match's settings, on every one of its events. */
export interface StreamFacts {
  readonly pool: StreamPool;
  readonly questions: number;
  readonly limit: StreamLimit;
}

/** What chat did on a question, as the streamer's page counted it. */
export type ChatOutcome = "right" | "wrong" | "split" | "none";

/** What every event knows about its run. */
interface RunFacts {
  /** The sequence mode, or `stream` for a Twitch Mode match (with `stream`). */
  readonly mode: Mode | "stream";
  /**
   * An Endless run's variant, when not general Endless (variants.ts in
   * @bt/core). Written as the mode column, and as `variant` on log lines.
   */
  readonly variant?: NamedVariant;
  /** The run key: the run id's body, `YYYYMMDD-<uuid>` or a replay's `…~<uuid>`. */
  readonly run: string;
  readonly runKind: RunKind;
  /** Daily Ranked: the game the run belongs to. */
  readonly gameNo?: number;
  /** Twitch Mode: the match's pool and settings. */
  readonly stream?: StreamFacts;
}

export interface StartEvent extends RunFacts {
  readonly type: "start";
  /**
   * Daily Ranked: how many runs of the game had already started from the same
   * connection. A count only, for `pnpm stats daily`; it never changes a run.
   */
  readonly repeat?: number;
}

/** Daily Ranked: a run carried on after a refresh (`POST /api/run/resume`). */
export interface ResumeEvent extends RunFacts {
  readonly type: "resume";
  /** The round on screen after the resume. */
  readonly round: number;
  /** The open question had run out of time and was recorded as a timeout. */
  readonly expired: boolean;
}

export interface AnswerEvent extends RunFacts {
  readonly type: "answer";
  readonly round: number;
  readonly stat: StatKey;
  readonly correct: boolean;
  /** The run's score after this answer: `round` if right, `round - 1` if not. */
  readonly streak: number;
  readonly relaxation: Relaxation;
  /** How far apart the two figures sit in the deck for this stat, 0 to 1. */
  readonly rankDistance: number;
  /**
   * Endless: ms from the token's issue to the guess reaching the server — the
   * server's own measure, never the client's. Absent in Friendly.
   */
  readonly answerMs?: number;
  /**
   * The round's scheduled band (`bandLabel`), from the run's own rules: an
   * Endless variant's, which for a squad depend on the deck. Absent in
   * Friendly, whose band is the mode's own.
   */
  readonly band?: string;
  /** Twitch Mode: how chat did on this question, and how many voted. Counts only. */
  readonly chat?: ChatOutcome;
  readonly voters?: number;
}

export interface EndEvent extends RunFacts {
  readonly type: "end";
  readonly end: RunEnd;
  readonly score: number;
  /** Daily Ranked: right answers out of twenty, and bonus rounds answered right. */
  readonly correct?: number;
  readonly bonus?: number;
  /** Twitch Mode: chat's score, and the most voters on any one question. */
  readonly chatScore?: number;
  readonly peakVoters?: number;
  /** The answered round that ended the run, for its log line. Not in the data point. */
  readonly final?: FinalRound;
  /**
   * A run closed as `disconnected`: the round left unanswered, with only the
   * figure the player had been shown. For its log line; not in the data point.
   */
  readonly shown?: ShownRound;
}

/** One of the final round's two players, both figures revealed by then. */
export type RevealedPlayer = {
  readonly role: "anchor" | "challenger";
  readonly id: string;
  readonly name: string;
  readonly value: number;
  readonly display: string;
  readonly qualifier?: string;
};

/** The round that ended a run: its stat, the guess, and both players with their figures. */
export type FinalRound = {
  readonly stat: StatKey;
  /** The pick, or `timeout` when Endless's clock ran out. */
  readonly guess: TimedGuess;
  readonly players: readonly [RevealedPlayer, RevealedPlayer];
};

/**
 * The page reported the player leaving mid-run (`POST /api/run/leave`). The
 * round is looked up by the server; the page only says which one.
 */
export interface LeaveEvent extends RunFacts {
  readonly type: "leave";
  /** The round on screen; 0 on the title card and the intro. */
  readonly round: number;
  readonly phase: LeavePhase;
  readonly trigger: LeaveTrigger;
  /** The round on screen as the player had seen it. None for round 0. */
  readonly shown?: ShownRound;
}

/**
 * A player in the round on screen when the player left: always who, and the
 * figure only once it had been shown.
 */
export type ShownPlayer = {
  readonly role: "anchor" | "challenger";
  readonly id: string;
  readonly name: string;
  readonly value?: number;
  readonly display?: string;
  readonly qualifier?: string;
};

export type ShownRound = {
  readonly stat: StatKey;
  readonly players: readonly [ShownPlayer, ShownPlayer];
};

/**
 * An attempt to publish a run (`POST /api/run/submit`), once its token has
 * checked out: published, or refused with a reason. Never the nickname.
 */
export interface SubmitEvent extends RunFacts {
  readonly type: "submit";
  readonly score: number;
  readonly published: boolean;
  readonly shadowed: boolean;
  /** Why it was refused: `expired`, `nickname_rejected`, `verification_failed`… */
  readonly refusal?: string;
  /** The new entry, when published. */
  readonly id?: string;
  /** Where it stands, as its owner sees it, when published. */
  readonly ranks?: { readonly day: number; readonly week: number; readonly month: number };
  /** Daily Ranked: its rank in its game, as its owner sees it. */
  readonly rank?: number;
}

export type GameEvent =
  StartEvent | AnswerEvent | EndEvent | LeaveEvent | SubmitEvent | ResumeEvent;

/** A day rank as a coarse bucket, so the dataset holds no exact placing. */
export function rankBucket(rank: number): string {
  if (rank <= 10) return "1-10";
  if (rank <= 100) return "11-100";
  if (rank <= 1000) return "101-1000";
  return "1000+";
}

/** Added by app.ts: facts about the request and the build, not the run. */
export interface EventContext {
  readonly country: string;
  readonly deckVersion: string;
}

/** `writeDataPoint`'s argument, as this module writes it. */
export interface DataPoint {
  readonly indexes: [string];
  readonly blobs: string[];
  readonly doubles: number[];
}

/** The `analytics_engine_datasets` binding, typed structurally for Node tests. */
export interface AnalyticsDataset {
  writeDataPoint(point: DataPoint): void;
}

/** The relaxation ladder's step (engine.ts): 0 dealt as scheduled, 3 the seen queue shortened. */
export const RELAXATION_STEP: Readonly<Record<Relaxation, number>> = {
  none: 0,
  iconic: 1,
  band: 2,
  seen: 3,
};

/**
 * The round's scheduled band for its mode, as a label that sorts by
 * difficulty: `0.45+` when uncapped, else `0.30-0.80`. The band the round was
 * scheduled for, not the one relaxation settled on: `double4` says whether it
 * gave, and `double5` how far apart the pair actually was.
 */
export function bandLabel(round: number, mode: Mode, rules?: BandRules): string {
  return formatBand(bandForRound(round, mode, rules));
}

/**
 * The mode column: the mode, an Endless variant's id, or `squad` for any
 * theme; `stream` for every Twitch Mode match, whatever its pool.
 */
export function modeColumn(event: Pick<RunFacts, "mode" | "variant">): string {
  const { variant } = event;
  if (event.mode === "stream") return "stream";
  if (variant === undefined) return event.mode;
  return isSquadVariantId(variant) ? "squad" : variant;
}

/** A "Clear the squad" run's theme id, or a Twitch Mode match's on a squad; else undefined. */
export function themeOf(event: Pick<RunFacts, "variant" | "stream">): string | undefined {
  const named = event.stream?.pool ?? event.variant;
  return named !== undefined && isSquadVariantId(named) ? themeIdOf(named) : undefined;
}

/** Where the theme goes: blob10, the events' own blobs padded to reach it. */
const THEME_BLOB = 10;

function withTheme(point: DataPoint, event: GameEvent): DataPoint {
  if (event.stream !== undefined) return withStream(point, event, event.stream);
  const theme = themeOf(event);
  if (theme === undefined) return point;
  const blobs = [...point.blobs];
  while (blobs.length < THEME_BLOB - 1) blobs.push("");
  blobs.push(theme);
  return { ...point, blobs };
}

/** Where a match's pool and chat's outcome go: after the theme, padded to reach them. */
function withStream(point: DataPoint, event: GameEvent, stream: StreamFacts): DataPoint {
  const blobs = [...point.blobs];
  while (blobs.length < THEME_BLOB - 1) blobs.push("");
  blobs.push(themeOf(event) ?? "", stream.pool);
  if (event.type === "answer") blobs.push(event.chat ?? "");
  return { ...point, blobs };
}

function formatBand(band: Band): string {
  const floor = band.floor.toFixed(2);
  return band.ceiling === null ? `${floor}+` : `${floor}-${band.ceiling.toFixed(2)}`;
}

/**
 * How far apart the round's two figures sit in the deck, 0 to 1: the engine's
 * own measure (ramp.ts), on the tables it dealt the round from. For after the
 * answer only, when both figures have been shown.
 */
export function pairRankDistance(deck: readonly Player[], round: Round, now: Date): number {
  const table = percentiles(deck, round.stat, now);
  const anchor = valueOf(round.anchor, round.stat, now);
  const challenger = valueOf(round.challenger, round.stat, now);
  if (anchor === undefined || challenger === undefined) return NaN;
  return rankDistance(table, anchor, challenger);
}

/**
 * The answered round, as `run_end` logs it. Only for a round whose answer has
 * been judged: the response that ends the run reveals the challenger's figure.
 */
export function finalRound(round: Round, now: Date, guess: TimedGuess): FinalRound {
  const player = (role: RevealedPlayer["role"], p: Player): RevealedPlayer => ({
    role,
    id: p.id,
    name: p.name,
    ...figureFor(p, round.stat, now),
  });
  return {
    stat: round.stat,
    guess,
    players: [player("anchor", round.anchor), player("challenger", round.challenger)],
  };
}

/**
 * The round on screen when the player left, rebuilt by the server. The
 * anchor's figure is on screen once the question is asked (`question` and
 * `reveal`), not while the cards are dealt or the wheel spins; the
 * challenger's only in `reveal`. Nothing hidden is ever in it.
 */
export function shownRound(round: Round, now: Date, phase: LeavePhase): ShownRound {
  const player = (role: ShownPlayer["role"], p: Player, shown: boolean): ShownPlayer => ({
    role,
    id: p.id,
    name: p.name,
    ...(shown ? figureFor(p, round.stat, now) : {}),
  });
  return {
    stat: round.stat,
    players: [
      player("anchor", round.anchor, phase === "question" || phase === "reveal"),
      player("challenger", round.challenger, phase === "reveal"),
    ],
  };
}

/** The event as one Analytics Engine data point, in the layout above. */
export function toDataPoint(event: GameEvent, ctx: EventContext): DataPoint {
  return withTheme(eventPoint(event, ctx), event);
}

function eventPoint(event: GameEvent, ctx: EventContext): DataPoint {
  const common = [event.type, modeColumn(event), event.runKind, ctx.deckVersion, ctx.country];
  const indexes: [string] = [event.run];
  const game = event.gameNo;
  if (event.stream !== undefined) return streamPoint(event, event.stream, common, indexes);
  if (event.mode === "stream") throw new Error("a stream event without its match's settings");
  const mode = event.mode;
  switch (event.type) {
    case "start":
      return {
        indexes,
        blobs: common,
        doubles: game !== undefined ? [game, event.repeat ?? 0] : [],
      };
    case "resume":
      return {
        indexes,
        blobs: [...common, event.expired ? "1" : "0"],
        doubles: [game ?? 0, event.round],
      };
    case "answer": {
      const tier: Tier = STATS[event.stat].tier;
      return {
        indexes,
        blobs: [
          ...common,
          event.stat,
          tier,
          event.band ?? bandLabel(event.round, mode),
          isFinalQuestion(event.round, mode) ? "1" : "0",
        ],
        doubles: [
          event.round,
          event.correct ? 1 : 0,
          event.streak,
          RELAXATION_STEP[event.relaxation],
          event.rankDistance,
          ...(event.answerMs !== undefined ? [event.answerMs] : []),
          ...(game !== undefined ? [game] : []),
        ],
      };
    }
    case "end":
      return {
        indexes,
        blobs: [...common, event.end],
        doubles:
          game !== undefined
            ? [event.score, game, event.correct ?? 0, event.bonus ?? 0]
            : [event.score],
      };
    case "leave":
      return {
        indexes,
        blobs: [...common, event.phase, event.trigger, event.shown?.stat ?? ""],
        doubles: [event.round],
      };
    case "submit":
      return {
        indexes,
        blobs: [
          ...common,
          event.published ? "1" : "0",
          event.shadowed ? "1" : "0",
          event.ranks !== undefined
            ? rankBucket(event.ranks.day)
            : event.rank !== undefined
              ? rankBucket(event.rank)
              : "",
          event.refusal ?? "",
        ],
        doubles: game !== undefined ? [event.score, game] : [event.score],
      };
  }
}

/** A Twitch Mode match's data point, before its pool and chat's outcome are added. */
function streamPoint(
  event: GameEvent,
  stream: StreamFacts,
  common: string[],
  indexes: [string],
): DataPoint {
  switch (event.type) {
    case "start":
      return { indexes, blobs: common, doubles: [stream.questions, stream.limit] };
    case "answer":
      return {
        indexes,
        blobs: [
          ...common,
          event.stat,
          STATS[event.stat].tier,
          event.band ?? "",
          event.round === stream.questions ? "1" : "0",
        ],
        doubles: [
          event.round,
          event.correct ? 1 : 0,
          event.streak,
          RELAXATION_STEP[event.relaxation],
          event.rankDistance,
          event.answerMs ?? 0,
          0,
          event.voters ?? 0,
        ],
      };
    case "end":
      return {
        indexes,
        blobs: [...common, event.end],
        doubles: [
          event.score,
          stream.questions,
          stream.limit,
          event.chatScore ?? 0,
          event.peakVoters ?? 0,
        ],
      };
    case "submit":
      // Always refused: a match has no boards.
      return {
        indexes,
        blobs: [...common, "0", "0", "", event.refusal ?? ""],
        doubles: [event.score],
      };
    default:
      // A match sends no leave and has no resume.
      return { indexes, blobs: common, doubles: [] };
  }
}

/**
 * The `info` line for a run's start, end or leave, so runs can be watched live
 * in Workers Logs and `wrangler tail`. The end adds the round that ended the
 * run: `endStat`, `guess` and both `players` with their figures. A leave adds
 * the round on screen, `stat` and `players`, with only the figures shown by
 * then (`shownRound`). Answers get no line: that's what the dataset is for.
 */
export function toLogLine(event: GameEvent, ctx: EventContext, route: string): LogLine | undefined {
  const { stream } = event;
  const common = {
    route,
    // A squad's line says `squad` and its theme; any other variant's, its mode and
    // variant; a Twitch Mode match's, `stream` and its pool (and theme, on a squad).
    mode: stream !== undefined ? "stream" : themeOf(event) !== undefined ? "squad" : event.mode,
    ...(stream !== undefined
      ? { pool: stream.pool, questions: stream.questions, limit: stream.limit }
      : {}),
    ...(event.variant !== undefined && themeOf(event) === undefined
      ? { variant: event.variant }
      : {}),
    ...(themeOf(event) !== undefined ? { theme: themeOf(event) } : {}),
    run: event.run,
    runKind: event.runKind,
    ...(event.gameNo !== undefined ? { gameNo: event.gameNo } : {}),
    deckVersion: ctx.deckVersion,
    country: ctx.country,
  } as const;
  switch (event.type) {
    case "start":
      return {
        level: "info",
        message: "run_start",
        event: "run_start",
        ...common,
        ...(event.repeat !== undefined ? { repeatFromConnection: event.repeat } : {}),
      };
    case "resume":
      return {
        level: "info",
        message: "run_resume",
        event: "run_resume",
        ...common,
        round: event.round,
        expired: event.expired ? "yes" : "no",
      };
    case "end": {
      const { final, shown } = event;
      return {
        level: "info",
        message: "run_end",
        event: "run_end",
        ...common,
        reason: event.end,
        score: event.score,
        ...(event.correct !== undefined ? { correct: event.correct } : {}),
        ...(event.bonus !== undefined ? { bonus: event.bonus } : {}),
        ...(event.chatScore !== undefined ? { chatScore: event.chatScore } : {}),
        ...(event.peakVoters !== undefined ? { peakVoters: event.peakVoters } : {}),
        ...(final !== undefined
          ? {
              endStat: { id: final.stat, label: STATS[final.stat].label },
              guess: final.guess,
              players: final.players,
            }
          : {}),
        ...(final === undefined && shown !== undefined
          ? {
              endStat: { id: shown.stat, label: STATS[shown.stat].label },
              players: shown.players,
            }
          : {}),
      };
    }
    case "leave": {
      const { shown } = event;
      return {
        level: "info",
        message: "run_leave",
        event: "run_leave",
        ...common,
        round: event.round,
        phase: event.phase,
        trigger: event.trigger,
        ...(shown !== undefined
          ? { stat: { id: shown.stat, label: STATS[shown.stat].label }, players: shown.players }
          : {}),
      };
    }
    case "submit":
      // Refusals already have their warn line from the endpoint.
      if (!event.published) return undefined;
      return {
        level: "info",
        message: "run_submit",
        event: "run_submit",
        ...common,
        score: event.score,
        shadowed: event.shadowed ? "yes" : "no",
        ...(event.id !== undefined ? { id: event.id } : {}),
        ...(event.ranks !== undefined ? { ranks: event.ranks } : {}),
        ...(event.rank !== undefined ? { rank: event.rank } : {}),
      };
    case "answer":
      return undefined;
  }
}

/** Whether a round is its mode's final question: Friendly's 20th, and Daily Ranked's. */
function isFinalQuestion(round: number, mode: Mode): boolean {
  return mode === "ranked" ? round === DAILY_QUESTIONS : isFinalRound(round, mode);
}

/** A stored Daily round that has been answered, as `run_end` logs it: both figures revealed. */
export function finalStored(round: StoredRound, guess: TimedGuess): FinalRound {
  const player = (role: RevealedPlayer["role"], p: StoredPlayer): RevealedPlayer => ({
    role,
    id: p.id,
    name: p.name,
    value: p.value,
    display: p.display,
    ...(p.qualifier !== undefined ? { qualifier: p.qualifier } : {}),
  });
  return {
    stat: round.stat,
    guess,
    players: [player("anchor", round.anchor), player("challenger", round.challenger)],
  };
}

/** A stored Daily round as the player had seen it at `phase` (as `shownRound`). */
export function shownStored(round: StoredRound, phase: LeavePhase): ShownRound {
  const player = (role: ShownPlayer["role"], p: StoredPlayer, shown: boolean): ShownPlayer => ({
    role,
    id: p.id,
    name: p.name,
    ...(shown
      ? {
          value: p.value,
          display: p.display,
          ...(p.qualifier !== undefined ? { qualifier: p.qualifier } : {}),
        }
      : {}),
  });
  return {
    stat: round.stat,
    players: [
      player("anchor", round.anchor, phase === "question" || phase === "reveal"),
      player("challenger", round.challenger, phase === "reveal"),
    ],
  };
}

/**
 * The request's country, from Cloudflare's `request.cf`. Read structurally:
 * the Node test types have no `cf`, and a request outside Cloudflare has none.
 */
export function countryOf(request: Request): string {
  const cf = (request as { cf?: { country?: unknown } }).cf;
  const country = cf?.country;
  return typeof country === "string" && /^[A-Z0-9]{2}$/.test(country) ? country : UNKNOWN_COUNTRY;
}
