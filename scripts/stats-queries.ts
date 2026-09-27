/**
 * The saved Analytics Engine queries behind `pnpm stats` (ARCHITECTURE.md §19),
 * and the table printing. Pure: `stats.ts` does the I/O.
 *
 * Columns follow the layout in worker/src/analytics.ts: blob1 event, blob2
 * mode, blob3 run kind, blob4 deck version, blob5 country; for an answer blob6
 * stat, blob7 tier, blob8 band, blob9 final question, double1 round, double2
 * correct, double3 streak, double4 relaxation step, double5 rank distance; for
 * an end blob6 end reason and double1 final score. Counts are
 * `SUM(_sample_interval)`, never `count()`, so they stay right if Analytics
 * Engine samples.
 *
 * ARCHITECTURE.md prints each query as it runs for 7 days and every deck, and
 * a test holds the two together.
 */

import { DATASET } from "../worker/src/analytics.js";

export interface QueryOptions {
  /** How far back, in days. */
  readonly days: number;
  /** One deck version only (`legends-107-e68a4e1b`), or every deck. */
  readonly deck?: string;
}

export type Row = Record<string, string | number | null>;

export interface SavedQuery {
  readonly title: string;
  /** What the table answers, printed above it. */
  readonly about: string;
  readonly sql: (opts: QueryOptions) => string;
  /** Columns worked out from the rows, where the SQL dialect can't. */
  readonly post?: (rows: Row[]) => Row[];
}

/** Analytics Engine keeps three months. */
export const MAX_DAYS = 92;
export const DEFAULT_DAYS = 7;

const DECK_VERSION = /^[a-z0-9-]{1,64}$/;

/** The time window and deck filter every query ends its WHERE with. */
function timeWindow({ days, deck }: QueryOptions): string {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new Error(`days must be a whole number from 1 to ${MAX_DAYS}`);
  }
  if (deck !== undefined && !DECK_VERSION.test(deck)) {
    throw new Error("deck must be a deck version, like legends-107-e68a4e1b");
  }
  const filter = deck === undefined ? "" : `\n  AND blob4 = '${deck}'`;
  return `timestamp > NOW() - INTERVAL '${days}' DAY${filter}`;
}

const PCT_CORRECT = "round(100 * SUM(_sample_interval * double2) / SUM(_sample_interval), 1)";

export const QUERIES = {
  summary: {
    title: "Runs",
    about:
      "Started, finished (a wrong answer, a win or an exhausted deck) and abandoned " +
      "(started, never finished) per mode; win % is of finished runs.",
    sql: (o) => `SELECT
  blob2 AS mode,
  sumIf(_sample_interval, blob1 = 'start') AS started,
  sumIf(_sample_interval, blob1 = 'end') AS finished,
  sumIf(_sample_interval, blob1 = 'start') - sumIf(_sample_interval, blob1 = 'end') AS abandoned,
  sumIf(_sample_interval, blob1 = 'end' AND blob6 = 'won') AS won,
  round(100 * sumIf(_sample_interval, blob1 = 'end' AND blob6 = 'won')
    / sumIf(_sample_interval, blob1 = 'end'), 1) AS win_pct
FROM ${DATASET}
WHERE ${timeWindow(o)}
GROUP BY mode
ORDER BY mode`,
  },
  scores: {
    title: "Final scores",
    about: "The spread of finished runs' scores per mode.",
    sql: (o) => `SELECT
  blob2 AS mode,
  SUM(_sample_interval) AS runs,
  round(SUM(_sample_interval * double1) / SUM(_sample_interval), 1) AS mean,
  min(double1) AS min,
  quantileExactWeighted(0.25)(double1, _sample_interval) AS p25,
  quantileExactWeighted(0.5)(double1, _sample_interval) AS median,
  quantileExactWeighted(0.75)(double1, _sample_interval) AS p75,
  max(double1) AS max
FROM ${DATASET}
WHERE blob1 = 'end'
  AND ${timeWindow(o)}
GROUP BY mode
ORDER BY mode`,
  },
  streaks: {
    title: "Streak histogram",
    about: "How many finished runs ended on each score, per mode.",
    sql: (o) => `SELECT
  blob2 AS mode,
  double1 AS score,
  SUM(_sample_interval) AS runs
FROM ${DATASET}
WHERE blob1 = 'end'
  AND ${timeWindow(o)}
GROUP BY mode, score
ORDER BY mode, score`,
  },
  friendly: {
    title: "Friendly: wins and the final question",
    about:
      "Win % of finished runs; how many started runs reached question 20; " +
      "and how many of those answered it right.",
    sql: (o) => `SELECT
  sumIf(_sample_interval, blob1 = 'start') AS started,
  sumIf(_sample_interval, blob1 = 'end') AS finished,
  sumIf(_sample_interval, blob1 = 'end' AND blob6 = 'won') AS won,
  round(100 * sumIf(_sample_interval, blob1 = 'end' AND blob6 = 'won')
    / sumIf(_sample_interval, blob1 = 'end'), 1) AS win_pct,
  sumIf(_sample_interval, blob1 = 'answer' AND blob9 = '1') AS reached_final,
  round(100 * sumIf(_sample_interval, blob1 = 'answer' AND blob9 = '1')
    / sumIf(_sample_interval, blob1 = 'start'), 1) AS reached_final_pct,
  round(100 * sumIf(_sample_interval, blob1 = 'answer' AND blob9 = '1' AND double2 = 1)
    / sumIf(_sample_interval, blob1 = 'answer' AND blob9 = '1'), 1) AS final_pass_pct
FROM ${DATASET}
WHERE blob2 = 'friendly'
  AND ${timeWindow(o)}`,
  },
  stats: {
    title: "Correct rate per stat",
    about: "Answers and correct % per stat; share % is the stat's share of its mode's answers.",
    sql: (o) => `SELECT
  blob2 AS mode,
  blob6 AS stat,
  blob7 AS tier,
  SUM(_sample_interval) AS answers,
  ${PCT_CORRECT} AS correct_pct
FROM ${DATASET}
WHERE blob1 = 'answer'
  AND ${timeWindow(o)}
GROUP BY mode, stat, tier
ORDER BY mode, answers DESC`,
    post: (rows) => {
      const totals = new Map<string, number>();
      for (const r of rows)
        totals.set(String(r.mode), (totals.get(String(r.mode)) ?? 0) + num(r.answers));
      return rows.map((r) => ({
        ...r,
        share_pct: round1((100 * num(r.answers)) / (totals.get(String(r.mode)) ?? 1)),
      }));
    },
  },
  distance: {
    title: "Correct rate by rank distance",
    about:
      "Answers and correct % by how far apart the pair sat in the deck (0.1-wide buckets): " +
      "real play, to replace the modelled player in simulation.md.",
    sql: (o) => `SELECT
  blob2 AS mode,
  floor(double5, 1) AS distance,
  SUM(_sample_interval) AS answers,
  ${PCT_CORRECT} AS correct_pct
FROM ${DATASET}
WHERE blob1 = 'answer'
  AND ${timeWindow(o)}
GROUP BY mode, distance
ORDER BY mode, distance`,
  },
  bands: {
    title: "Correct rate by band",
    about:
      "Answers and correct % per scheduled band, and how often the engine had to relax it " +
      "(relaxed % of answers dealt with any relaxation step).",
    sql: (o) => `SELECT
  blob2 AS mode,
  blob8 AS band,
  SUM(_sample_interval) AS answers,
  ${PCT_CORRECT} AS correct_pct,
  round(100 * sumIf(_sample_interval, double4 > 0) / SUM(_sample_interval), 1) AS relaxed_pct
FROM ${DATASET}
WHERE blob1 = 'answer'
  AND ${timeWindow(o)}
GROUP BY mode, band
ORDER BY mode, band DESC`,
  },
  dropoff: {
    title: "Drop-off by round",
    about:
      "Per round: answers, correct answers and correct %; left is runs that got the round " +
      "right and never answered the next (abandoned there).",
    sql: (o) => `SELECT
  blob2 AS mode,
  double1 AS round,
  SUM(_sample_interval) AS reached,
  SUM(_sample_interval * double2) AS correct,
  ${PCT_CORRECT} AS correct_pct
FROM ${DATASET}
WHERE blob1 = 'answer'
  AND ${timeWindow(o)}
GROUP BY mode, round
ORDER BY mode, round`,
    post: (rows) =>
      rows.map((r) => {
        const next = rows.find((n) => n.mode === r.mode && num(n.round) === num(r.round) + 1);
        return { ...r, left: next === undefined ? "" : num(r.correct) - num(next.reached) };
      }),
  },
  replays: {
    title: "Challenge replays",
    about: "Runs started from a challenge link, as a share of all runs started.",
    sql: (o) => `SELECT
  blob2 AS mode,
  SUM(_sample_interval) AS started,
  sumIf(_sample_interval, blob3 = 'replay') AS replays,
  round(100 * sumIf(_sample_interval, blob3 = 'replay') / SUM(_sample_interval), 1) AS replay_pct
FROM ${DATASET}
WHERE blob1 = 'start'
  AND ${timeWindow(o)}
GROUP BY mode
ORDER BY mode`,
  },
  latest: {
    title: "Latest 50 starts and ends",
    about: "Newest first. run is the run key, which pairs a start with its end.",
    sql: (o) => `SELECT
  timestamp,
  blob1 AS event,
  blob2 AS mode,
  blob3 AS run_kind,
  blob5 AS country,
  blob6 AS end_reason,
  double1 AS score,
  index1 AS run
FROM ${DATASET}
WHERE (blob1 = 'start' OR blob1 = 'end')
  AND ${timeWindow(o)}
ORDER BY timestamp DESC
LIMIT 50`,
    post: (rows) =>
      rows.map((r) => (r.event === "start" ? { ...r, end_reason: "", score: "" } : r)),
  },
} satisfies Record<string, SavedQuery>;

export type QueryName = keyof typeof QUERIES;

export const QUERY_NAMES = Object.keys(QUERIES) as QueryName[];

/** What plain `pnpm stats` shows: the start/end summary. */
export const DEFAULT_QUERIES: readonly QueryName[] = ["summary", "scores"];

export function isQueryName(name: string): name is QueryName {
  return (QUERY_NAMES as string[]).includes(name);
}

function num(value: string | number | null | undefined): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Rows as a plain-text table, columns in the order given. Numbers right-aligned;
 * a number the API sends as a string (64-bit integers are) counts as one.
 */
export function formatTable(columns: readonly string[], rows: readonly Row[]): string {
  if (rows.length === 0) return "  (no rows)";
  const cells = rows.map((r) => columns.map((c) => show(r[c])));
  const widths = columns.map((c, i) => Math.max(c.length, ...cells.map((row) => row[i]!.length)));
  const numeric = columns.map((_, i) => cells.every((row) => row[i] === "" || isNumeric(row[i]!)));
  const line = (values: readonly string[]): string =>
    "  " +
    values
      .map((v, i) => (numeric[i] ? v.padStart(widths[i]!) : v.padEnd(widths[i]!)))
      .join("  ")
      .trimEnd();
  return [line(columns), line(widths.map((w) => "-".repeat(w))), ...cells.map(line)].join("\n");
}

function show(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(round4(value)) : "";
  return isNumeric(value) ? String(round4(Number(value))) : value;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function isNumeric(s: string): boolean {
  return s.trim() !== "" && Number.isFinite(Number(s));
}
