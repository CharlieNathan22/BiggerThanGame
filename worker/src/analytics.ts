/**
 * Gameplay events → Workers Analytics Engine, and the run start and end lines
 * in Workers Logs (ARCHITECTURE.md §19).
 *
 * The round handler (round.ts) records what happened as a `GameEvent`, after
 * the server has judged it; app.ts adds the country and the deck version and
 * writes it here. Three events: `start` when a run is begun, `answer` for every
 * answered round, `end` when an answer ends the run. A run with a start and no
 * end was abandoned.
 *
 * Every data point shares one layout, so a column means the same thing in
 * every event:
 *
 *   index1  the run key: the run id's body, before the "." (never the signature)
 *   blob1   event        "start" | "answer" | "end"
 *   blob2   mode         "friendly"
 *   blob3   run kind     "fresh" | "replay"
 *   blob4   deck version "legends-107-3f9c21e0"
 *   blob5   country      request.cf.country; "XX" when unknown
 *   answer: blob6 stat id, blob7 tier, blob8 band, blob9 final question ("1" | "0");
 *           double1 round, double2 correct (1 | 0), double3 streak after the answer,
 *           double4 relaxation step (0–3), double5 rank distance of the pair (0–1)
 *   end:    blob6 end reason ("wrong" | "won" | "deck-exhausted"); double1 final score
 *
 * Privacy (§19): nothing personal — no IP, not even hashed, no user agent, no
 * cookie, nothing kept in the browser. Country only. No stat value in a data
 * point: the rank distance is a position in the deck, of two figures both
 * already revealed, and never reaches the client. The `run_end` log line does
 * carry the final round's two figures, which the ending response has just
 * revealed.
 *
 * Fire-and-forget: `writeDataPoint` doesn't block, and a missing or throwing
 * binding (local dev, tests, an outage) is swallowed. The response and its
 * timing never depend on it.
 */

import { STATS, bandForRound, isFinalRound, percentiles, rankDistance, valueOf } from "@bt/core";
import type { Band, Guess, Mode, Player, Relaxation, Round, RunEnd, StatKey, Tier } from "@bt/core";
import type { LogLine } from "./log.js";
import { figureFor } from "./payload.js";

/** Analytics Engine's limit on an index. */
export const MAX_INDEX_BYTES = 96;

/** The dataset, as named in wrangler.toml. The SQL API's table name. */
export const DATASET = "biggerthan_game_events";

/** Cloudflare's own code for a country it couldn't tell. */
export const UNKNOWN_COUNTRY = "XX";

export type RunKind = "fresh" | "replay";

/** What every event knows about its run. */
interface RunFacts {
  readonly mode: Mode;
  /** The run key: the run id's body, `YYYYMMDD-<uuid>` or a replay's `…~<uuid>`. */
  readonly run: string;
  readonly runKind: RunKind;
}

export interface StartEvent extends RunFacts {
  readonly type: "start";
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
}

export interface EndEvent extends RunFacts {
  readonly type: "end";
  readonly end: RunEnd;
  readonly score: number;
  /** The answered round that ended the run, for its log line. Not in the data point. */
  readonly final?: FinalRound;
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
  readonly guess: Guess;
  readonly players: readonly [RevealedPlayer, RevealedPlayer];
};

export type GameEvent = StartEvent | AnswerEvent | EndEvent;

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
export function bandLabel(round: number, mode: Mode): string {
  return formatBand(bandForRound(round, mode));
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
export function finalRound(round: Round, now: Date, guess: Guess): FinalRound {
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

/** The event as one Analytics Engine data point, in the layout above. */
export function toDataPoint(event: GameEvent, ctx: EventContext): DataPoint {
  const common = [event.type, event.mode, event.runKind, ctx.deckVersion, ctx.country];
  const indexes: [string] = [event.run];
  switch (event.type) {
    case "start":
      return { indexes, blobs: common, doubles: [] };
    case "answer": {
      const tier: Tier = STATS[event.stat].tier;
      return {
        indexes,
        blobs: [
          ...common,
          event.stat,
          tier,
          bandLabel(event.round, event.mode),
          isFinalRound(event.round, event.mode) ? "1" : "0",
        ],
        doubles: [
          event.round,
          event.correct ? 1 : 0,
          event.streak,
          RELAXATION_STEP[event.relaxation],
          event.rankDistance,
        ],
      };
    }
    case "end":
      return { indexes, blobs: [...common, event.end], doubles: [event.score] };
  }
}

/**
 * The `info` line for a run's start or end, so runs can be watched live in
 * Workers Logs and `wrangler tail`. The end adds the round that ended the run:
 * `endStat`, `guess` and both `players` with their figures. Answers get no
 * line: that's what the dataset is for.
 */
export function toLogLine(event: GameEvent, ctx: EventContext, route: string): LogLine | undefined {
  const common = {
    route,
    mode: event.mode,
    run: event.run,
    runKind: event.runKind,
    deckVersion: ctx.deckVersion,
    country: ctx.country,
  } as const;
  switch (event.type) {
    case "start":
      return { level: "info", message: "run_start", event: "run_start", ...common };
    case "end": {
      const { final } = event;
      return {
        level: "info",
        message: "run_end",
        event: "run_end",
        ...common,
        reason: event.end,
        score: event.score,
        ...(final !== undefined
          ? {
              endStat: { id: final.stat, label: STATS[final.stat].label },
              guess: final.guess,
              players: final.players,
            }
          : {}),
      };
    }
    case "answer":
      return undefined;
  }
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
