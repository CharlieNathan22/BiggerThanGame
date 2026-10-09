/**
 * The saved Analytics Engine queries behind `pnpm stats` (ARCHITECTURE.md §19),
 * and the table printing. Pure: `stats.ts` does the I/O.
 *
 * Columns follow the layout in worker/src/analytics.ts: blob1 event, blob2
 * mode, blob3 run kind, blob4 deck version, blob5 country; for an answer blob6
 * stat, blob7 tier, blob8 band, blob9 final question, double1 round, double2
 * correct, double3 streak, double4 relaxation step, double5 rank distance; for
 * an end blob6 end reason and double1 final score; for an Endless answer also
 * double6 the server-measured answer time in ms; for a leave blob6 phase,
 * blob7 trigger, blob8 stat and double1 round; for a Twitch Mode end (blob2
 * `stream`) blob11 the pool, double1 the streamer's score, double2 the
 * questions, double3 the limit, double4 chat's score, double5 the peak voters. Counts are
 * `SUM(_sample_interval)`, never `count()`, so they stay right if Analytics
 * Engine samples.
 *
 * ARCHITECTURE.md prints each query as it runs for 7 days and every deck (the
 * `run` query with `EXAMPLE_RUN_KEY`), and a test holds the two together.
 */

import { DATASET } from "../worker/src/analytics.js";

export interface QueryOptions {
  /** How far back, in days. */
  readonly days: number;
  /** One deck version only (`legends-107-e68a4e1b`), or every deck. */
  readonly deck?: string;
  /** One run, by its run key (`YYYYMMDD-<uuid>`): for the `run` query. */
  readonly run?: string;
}

export type Row = Record<string, string | number | null>;

export interface SavedQuery {
  readonly title: string;
  /** What the table answers, printed above it. */
  readonly about: string;
  readonly sql: (opts: QueryOptions) => string;
  /** Columns worked out from the rows, where the SQL dialect can't. */
  readonly post?: (rows: Row[]) => Row[];
  /** Lines printed under the table, from the rows after `post`. */
  readonly summary?: (rows: readonly Row[]) => string;
  /** Needs a run key (`pnpm stats run <runKey>`), so `all` leaves it out. */
  readonly needsRunKey?: boolean;
}

/** Analytics Engine keeps three months. */
export const MAX_DAYS = 92;
export const DEFAULT_DAYS = 7;

const DECK_VERSION = /^[a-z0-9-]{1,64}$/;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** A run key, as run-id.ts writes it: `YYYYMMDD-<uuid>`, or a replay's `…~<uuid>`. */
const RUN_KEY = new RegExp(`^\\d{8}-${UUID}(?:~${UUID})?$`);

/** The key ARCHITECTURE.md prints the `run` query with. */
export const EXAMPLE_RUN_KEY = "20260928-00000000-0000-4000-8000-000000000000";

/**
 * The run key as it goes into the SQL. A whole run id is accepted too, its
 * signature dropped; anything else is refused, so nothing can be spliced in.
 */
export function runKey(value: string | undefined): string {
  const key = value?.split(".")[0] ?? "";
  if (!RUN_KEY.test(key)) {
    throw new Error('run needs a run key, like 20260928-<uuid> (the run id before the ".")');
  }
  return key;
}

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
      "Started, finished (a wrong answer, a win, an exhausted deck, a timeout or a " +
      "disconnect) and abandoned (started, never finished) per mode; win % is of finished runs.",
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
  endings: {
    title: "How runs end",
    about:
      "Finished runs per mode and end reason: wrong, won, deck-exhausted, and in Endless " +
      "timeout (out of time) and disconnected (no answer came; the streak was kept).",
    sql: (o) => `SELECT
  blob2 AS mode,
  blob6 AS reason,
  SUM(_sample_interval) AS runs,
  round(SUM(_sample_interval * double1) / SUM(_sample_interval), 1) AS mean_score
FROM ${DATASET}
WHERE blob1 = 'end'
  AND ${timeWindow(o)}
GROUP BY mode, reason
ORDER BY mode, runs DESC`,
  },
  clock: {
    title: "Endless: answer times",
    about:
      "Server-measured ms from a question's token to its answer, per scheduled band: the " +
      "animations before the question plus the thinking. A cluster of very fast, right " +
      "answers late on is what a bot looks like.",
    sql: (o) => `SELECT
  blob8 AS band,
  SUM(_sample_interval) AS answers,
  quantileExactWeighted(0.1)(double6, _sample_interval) AS p10_ms,
  quantileExactWeighted(0.5)(double6, _sample_interval) AS median_ms,
  quantileExactWeighted(0.9)(double6, _sample_interval) AS p90_ms,
  ${PCT_CORRECT} AS correct_pct
FROM ${DATASET}
WHERE blob1 = 'answer'
  AND blob2 = 'endless'
  AND ${timeWindow(o)}
GROUP BY band
ORDER BY band DESC`,
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
  leaves: {
    title: "Leaves by round and phase",
    about:
      "Runs whose page was hidden (switched away, locked) or closed mid-run, by the round on " +
      "screen (0 is the title card and intro) and what was showing. Each is at most once per " +
      "run, and closing a page is usually both, so the columns don't add up.",
    sql: (o) => `SELECT
  blob2 AS mode,
  double1 AS round,
  blob6 AS phase,
  sumIf(_sample_interval, blob7 = 'hidden') AS hidden,
  sumIf(_sample_interval, blob7 = 'pagehide') AS closed
FROM ${DATASET}
WHERE blob1 = 'leave'
  AND ${timeWindow(o)}
GROUP BY mode, round, phase
ORDER BY mode, round, phase`,
  },
  run: {
    title: "Answers in one run",
    about:
      "Every answer the server judged for one run key, in time order, with the seconds since " +
      "the one before, and in Endless the server-measured answer time. A round listed twice " +
      "was answered again (Friendly is stateless).",
    needsRunKey: true,
    sql: (o) => `SELECT
  timestamp,
  double1 AS round,
  blob6 AS stat,
  double2 AS correct,
  double3 AS streak,
  double6 AS answer_ms
FROM ${DATASET}
WHERE blob1 = 'answer'
  AND index1 = '${runKey(o.run)}'
  AND ${timeWindow(o)}
ORDER BY timestamp, round
LIMIT 1000`,
    post: (rows) =>
      rows.map((r, i) => {
        const before = i > 0 ? rows[i - 1] : undefined;
        return { ...r, gap_s: before === undefined ? "" : round1(secondsBetween(before, r)) };
      }),
    summary: runSummary,
  },
  replays: {
    title: "Challenge runs",
    about:
      "Runs started from a challenge link, as a share of all runs started: Endless's " +
      "challenge runs, and Friendly's replays from before challenges moved.",
    sql: (o) => `SELECT
  blob2 AS mode,
  SUM(_sample_interval) AS started,
  sumIf(_sample_interval, blob3 = 'challenge' OR blob3 = 'replay') AS challenged,
  round(100 * sumIf(_sample_interval, blob3 = 'challenge' OR blob3 = 'replay')
    / SUM(_sample_interval), 1) AS challenged_pct
FROM ${DATASET}
WHERE blob1 = 'start'
  AND ${timeWindow(o)}
GROUP BY mode
ORDER BY mode`,
  },
  endless: {
    title: "Endless: runs, scores and publishing",
    about:
      "Endless runs started and finished, their score spread, and attempts to publish: " +
      "how many were published and how many of those were shadow-flagged. The summary " +
      "gives the publish rate (published / finished) and the shadow rate (shadowed / published).",
    sql: (o) => `SELECT
  blob1 AS event,
  SUM(_sample_interval) AS events,
  round(SUM(_sample_interval * double1) / SUM(_sample_interval), 1) AS mean_score,
  quantileExactWeighted(0.5)(double1, _sample_interval) AS median_score,
  quantileExactWeighted(0.9)(double1, _sample_interval) AS p90_score,
  max(double1) AS max_score,
  sumIf(_sample_interval, blob1 = 'submit' AND blob6 = '1') AS published,
  sumIf(_sample_interval, blob1 = 'submit' AND blob6 = '1' AND blob7 = '1') AS shadowed
FROM ${DATASET}
WHERE blob2 = 'endless'
  AND (blob1 = 'start' OR blob1 = 'end' OR blob1 = 'submit')
  AND ${timeWindow(o)}
GROUP BY event
ORDER BY event`,
    post: (rows) =>
      rows.map((r) =>
        r.event === "start"
          ? {
              ...r,
              mean_score: "",
              median_score: "",
              p90_score: "",
              max_score: "",
              published: "",
              shadowed: "",
            }
          : r.event === "end"
            ? { ...r, published: "", shadowed: "" }
            : r,
      ),
    summary: (rows) => {
      const row = (event: string) => rows.find((r) => r.event === event);
      const finished = num(row("end")?.events);
      const published = num(row("submit")?.published);
      const shadowed = num(row("submit")?.shadowed);
      const pct = (a: number, b: number) => (b === 0 ? "–" : `${round1((100 * a) / b)}%`);
      return (
        `publish rate ${pct(published, finished)} (${published} of ${finished} finished runs); ` +
        `shadow rate ${pct(shadowed, published)} (${shadowed} of ${published} published)`
      );
    },
  },
  daily: {
    title: "Daily Ranked: per game",
    about:
      "Per game: players (runs started), runs finished, the mean score, perfect twenties, " +
      "runs finished by the idle alarm (abandoned), resumes after a refresh, shadowed posts, " +
      "and starts from a connection that had already started a run of the game (a count " +
      "only; nothing is done with it). `pnpm stats scores streaks` show the score spread " +
      "under mode ranked. The summary gives the rates over every game shown.",
    sql: (o) => `SELECT
  if(blob1 = 'start' OR blob1 = 'resume', double1, double2) AS game,
  sumIf(_sample_interval, blob1 = 'start') AS players,
  sumIf(_sample_interval, blob1 = 'end') AS finished,
  round(sumIf(_sample_interval * double1, blob1 = 'end')
    / sumIf(_sample_interval, blob1 = 'end'), 1) AS mean_score,
  sumIf(_sample_interval, blob1 = 'end' AND double3 = 20) AS perfect,
  sumIf(_sample_interval, blob1 = 'end' AND blob6 = 'abandoned') AS abandoned,
  sumIf(_sample_interval, blob1 = 'resume') AS resumes,
  sumIf(_sample_interval, blob1 = 'submit' AND blob7 = '1') AS shadowed,
  sumIf(_sample_interval, blob1 = 'start' AND double2 > 0) AS repeat_connection
FROM ${DATASET}
WHERE blob2 = 'ranked'
  AND (blob1 = 'start' OR blob1 = 'end' OR blob1 = 'resume' OR blob1 = 'submit')
  AND ${timeWindow(o)}
GROUP BY game
ORDER BY game DESC`,
    summary: (rows) => {
      const total = (key: string) => rows.reduce((sum, r) => sum + num(r[key]), 0);
      const players = total("players");
      const finished = total("finished");
      const pct = (a: number, b: number) => (b === 0 ? "–" : `${round1((100 * a) / b)}%`);
      return (
        `20/20 rate ${pct(total("perfect"), finished)}; ` +
        `resumes ${pct(total("resumes"), players)} of starts; ` +
        `finished by the alarm ${pct(total("abandoned"), finished)}; ` +
        `shadow rate ${pct(total("shadowed"), finished)}; ` +
        `repeat connections ${pct(total("repeat_connection"), players)} of starts`
      );
    },
  },
  stream: {
    title: "Twitch Mode: matches",
    about:
      "Per pool, length and timer: matches finished, the streamer's and chat's mean scores, " +
      "how often the streamer beat chat or drew, the mean peak voters on one question, and " +
      "matches closed by the alarm (the page went away). Counts only: nothing from chat.",
    sql: (o) => `SELECT
  blob11 AS pool,
  double2 AS questions,
  double3 AS limit_s,
  sum(_sample_interval) AS matches,
  round(sum(_sample_interval * double1) / sum(_sample_interval), 1) AS streamer_mean,
  round(sum(_sample_interval * double4) / sum(_sample_interval), 1) AS chat_mean,
  sumIf(_sample_interval, double1 > double4) AS streamer_won,
  sumIf(_sample_interval, double1 = double4) AS draws,
  round(sum(_sample_interval * double5) / sum(_sample_interval), 1) AS mean_peak_voters,
  sumIf(_sample_interval, blob6 = 'disconnected') AS disconnected
FROM ${DATASET}
WHERE blob2 = 'stream'
  AND blob1 = 'end'
  AND ${timeWindow(o)}
GROUP BY pool, questions, limit_s
ORDER BY matches DESC`,
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

/** What `pnpm stats all` runs: every query that doesn't need a run key. */
export const ALL_QUERIES: readonly QueryName[] = QUERY_NAMES.filter(
  (name) => !(QUERIES[name] as SavedQuery).needsRunKey,
);

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
 * A row's time in ms. The SQL API writes `2026-09-28 06:11:33`, in UTC with
 * no zone; an ISO string with a zone reads as it is.
 */
export function timestampMs(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  const text = String(value ?? "")
    .trim()
    .replace(" ", "T");
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`);
}

function secondsBetween(a: Row, b: Row): number {
  return (timestampMs(b.timestamp) - timestampMs(a.timestamp)) / 1000;
}

function duration(seconds: number): string {
  if (seconds < 60) return `${round1(seconds)} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)} min ${whole % 60} s`;
}

/**
 * Under the `run` table: how many answers, which rounds were answered more
 * than once, the fastest gap between two answers, and first answer to last.
 */
export function runSummary(rows: readonly Row[]): string {
  if (rows.length === 0) return "  No answers for that run key in the window.";
  const times = new Map<number, number>();
  for (const r of rows) times.set(num(r.round), (times.get(num(r.round)) ?? 0) + 1);
  const repeats = [...times].filter(([, n]) => n > 1).sort(([a], [b]) => a - b);
  let fastest: { gap: number; from: Row; to: Row } | undefined;
  for (let i = 1; i < rows.length; i++) {
    const gap = secondsBetween(rows[i - 1]!, rows[i]!);
    if (fastest === undefined || gap < fastest.gap) {
      fastest = { gap, from: rows[i - 1]!, to: rows[i]! };
    }
  }
  const total = secondsBetween(rows[0]!, rows.at(-1)!);
  return [
    `  Answers: ${rows.length}`,
    `  Rounds answered more than once: ${
      repeats.length === 0 ? "none" : repeats.map(([round, n]) => `${round} (×${n})`).join(", ")
    }`,
    `  Fastest gap between answers: ${
      fastest === undefined
        ? "n/a (one answer)"
        : `${duration(fastest.gap)} (round ${num(fastest.from.round)} to round ${num(fastest.to.round)})`
    }`,
    `  Total duration, first answer to last: ${duration(total)}`,
  ].join("\n");
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
