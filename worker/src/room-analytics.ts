/**
 * A 1v1 room's events → Workers Analytics Engine, and its lines in Workers
 * Logs (ARCHITECTURE.md §19). Apart from analytics.ts, whose events are a
 * run's: a room has no run key, no rounds answered by one player and no
 * leave beacon. The columns it shares mean what they mean there, so the
 * dataset reads the same way:
 *
 *   index1  the room's key, `YYYYMMDD-<uuid>` (never its code, which is how
 *           a room is joined)
 *   blob1   event        "room" | "start" | "end"
 *   blob2   mode         "duel"
 *   blob3   run kind     "fresh", or "rematch" for a match after the room's first
 *   blob4   deck version
 *   blob5   country      the host's, as the room was made; "XX" when unknown
 *   blob6   end reason   on `end`: "finished" | "sudden-death" | "draw" |
 *                        "exhausted" | "forfeit"; "" otherwise
 *   blob10  theme        a squad pool's theme id; "" otherwise
 *   blob11  pool         "endless" | "endless-instagram" | "squad:<theme id>"
 *   room:   double1 the questions, double2 the limit in seconds
 *   start:  double1 the questions, double2 the limit, double3 the match's
 *           number in the room (1, then a rematch is 2…)
 *   end:    double1 the higher score, double2 the lower, double3 the questions,
 *           double4 the limit, double5 sudden-death questions played, double6
 *           the match's number
 *
 * **No names, ever**: not a player's, and no nickname reaches this module.
 * Scores are the higher and the lower, never whose. No code, no token.
 */

import { isSquadVariantId, themeIdOf } from "@bt/core";
import type { MatchEndReason, RoomSettings } from "@bt/core";
import type { DataPoint, EventContext } from "./analytics.js";
import type { LogLine } from "./log.js";

interface RoomFacts {
  /** The room's key. */
  readonly room: string;
  readonly settings: RoomSettings;
}

export type RoomEvent =
  /** A room was made. */
  | (RoomFacts & { readonly type: "room" })
  /** A match started: the room's first, or a rematch. */
  | (RoomFacts & { readonly type: "start"; readonly match: number })
  | (RoomFacts & {
      readonly type: "end";
      readonly match: number;
      readonly reason: MatchEndReason;
      /** By seat; written as the higher and the lower. */
      readonly scores: readonly number[];
      readonly suddenDeath: number;
    });

/** Where the theme goes, as in analytics.ts: blob10, then the pool. */
const THEME_BLOB = 10;

function themeOf(settings: RoomSettings): string {
  return isSquadVariantId(settings.pool) ? themeIdOf(settings.pool) : "";
}

function runKind(event: RoomEvent): "fresh" | "rematch" {
  return event.type !== "room" && event.match > 1 ? "rematch" : "fresh";
}

/** The higher score, then the lower: who had which is nobody's business here. */
function ordered(scores: readonly number[]): [number, number] {
  const sorted = [...scores].sort((a, b) => b - a);
  return [sorted[0] ?? 0, sorted[1] ?? 0];
}

export function roomDataPoint(event: RoomEvent, ctx: EventContext): DataPoint {
  const { settings } = event;
  const blobs = [
    event.type,
    settings.mode,
    runKind(event),
    ctx.deckVersion,
    ctx.country,
    event.type === "end" ? event.reason : "",
  ];
  while (blobs.length < THEME_BLOB - 1) blobs.push("");
  blobs.push(themeOf(settings), settings.pool);
  const base = [settings.questions, settings.limit];
  let doubles: number[];
  if (event.type === "room") doubles = base;
  else if (event.type === "start") doubles = [...base, event.match];
  else doubles = [...ordered(event.scores), ...base, event.suddenDeath, event.match];
  return { indexes: [event.room], blobs, doubles };
}

/** The `info` line for a room made, a match started and a match ended. */
export function roomLogLine(event: RoomEvent, ctx: EventContext, route: string): LogLine {
  const { settings } = event;
  const theme = themeOf(settings);
  const common = {
    route,
    mode: settings.mode,
    pool: settings.pool,
    ...(theme !== "" ? { theme } : {}),
    questions: settings.questions,
    limit: settings.limit,
    room: event.room,
    deckVersion: ctx.deckVersion,
    country: ctx.country,
  } as const;
  if (event.type === "room") {
    return { level: "info", message: "room_create", event: "room_create", ...common };
  }
  if (event.type === "start") {
    return {
      level: "info",
      message: "match_start",
      event: "match_start",
      ...common,
      match: event.match,
      runKind: runKind(event),
    };
  }
  const [high, low] = ordered(event.scores);
  return {
    level: "info",
    message: "match_end",
    event: "match_end",
    ...common,
    match: event.match,
    runKind: runKind(event),
    reason: event.reason,
    score: high,
    loserScore: low,
    suddenDeath: event.suddenDeath,
  };
}
