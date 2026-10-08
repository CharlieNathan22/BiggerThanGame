/**
 * Daily Ranked on the page (DESIGN.md §3): its API client, what this device
 * remembers of today's run, and the words the panels, the title bar and the
 * share show. Pure but for the requests, so it runs under test.
 *
 * - **The start** carries the player's name, the flag choice, the device id
 *   and Turnstile: pressing Play is the whole commitment. A name refused or
 *   taken, or a device that has played today, is answered before anything is
 *   used, and the start panel says why under the field.
 * - **Tokens stay in memory**, as in Endless. The run id is kept in storage
 *   for the current game only (`bt:daily`), as a hint for resume: the server
 *   finds the run from the device anyway.
 * - **Resume** after a refresh picks up the question on screen with its clock
 *   still running, or the next one if its time ran out.
 */

import { DAILY_QUESTIONS } from "@bt/core";
import type {
  AnswerResponse,
  DailyBoardEntry,
  DailyBoardResponse,
  DailyGuessResponse,
  DailyMineResponse,
  DailyResult,
  DailyResumeResponse,
  DailyStartRequest,
  DailyStartResponse,
  GuessRequest,
  StartResponse,
} from "@bt/core";
import { t } from "../i18n";
import { ApiFailure, GUESS_ENDPOINT, RUN_START_ENDPOINT, jsonPoster } from "./api";
import type { Fetch, GameApi } from "./api";
import type { StorageAccess } from "./best";
import { countdownText } from "./leaderboard";
import type { Answered } from "./machine";
import { count, ordinal } from "./publish";
import type { ShareCard } from "./share";
import type { TrackStep } from "./view";

export const RESUME_ENDPOINT = "/api/run/resume";
export const DAILY_BOARD_ENDPOINT = "/api/board/daily";
export const DAILY_MINE_ENDPOINT = "/api/board/daily/me";

/** Where today's run id is kept: `{ "gameNo": 12, "runId": "…" }`, for the current game only. */
export const DAILY_RUN_KEY = "bt:daily";

/** Who is playing: what the start sends with the run. */
export interface DailyIdentity {
  readonly nickname: string;
  readonly showCountry: boolean;
  readonly deviceId: string;
}

export interface DailyApi extends GameApi {
  /** Today's game and this device in it: none, a run being played, or its result. */
  lookup(): Promise<DailyMineResponse>;
  /** Picks up this device's run after a refresh. */
  resume(runId?: string): Promise<DailyResumeResponse>;
  /** The run's start, once it has started: its game and the name it is played under. */
  started(): DailyStartResponse | null;
}

/**
 * Daily Ranked's API. `identity` is read at each start: the name in the
 * field, the flag choice and the device id.
 */
export function createDailyApi(
  fetchFn: Fetch,
  checkHuman: () => Promise<string>,
  identity: () => DailyIdentity,
  storage: StorageAccess,
  /** Told when a start goes through: the name and flag choice are worth remembering then. */
  onStarted?: (started: DailyStartResponse, who: DailyIdentity) => void,
): DailyApi {
  const send = jsonPoster(fetchFn);
  let token: string | null = null;
  let start: DailyStartResponse | null = null;
  return {
    async start(): Promise<StartResponse> {
      let turnstileToken: string;
      try {
        turnstileToken = await checkHuman();
      } catch {
        throw new ApiFailure(0, "turnstile");
      }
      const who = identity();
      const body: DailyStartRequest = {
        mode: "ranked",
        nickname: who.nickname,
        showCountry: who.showCountry,
        deviceId: who.deviceId,
        turnstileToken,
      };
      const res = await send<DailyStartResponse>(RUN_START_ENDPOINT, body);
      token = res.token;
      start = res;
      rememberRun(storage, res.gameNo, res.runId);
      onStarted?.(res, who);
      return { runId: res.runId, round: res.round };
    },
    async answer(_runId, _round, guess): Promise<AnswerResponse> {
      if (token === null) throw new ApiFailure(0, "network");
      const res = await send<DailyGuessResponse>(GUESS_ENDPOINT, {
        token,
        guess,
      } satisfies GuessRequest);
      if ("next" in res) {
        token = res.token;
        return { reveal: res.reveal, next: res.next };
      }
      token = null;
      const ended: Answered = { reveal: res.reveal, end: res.end, result: res.result };
      return ended;
    },
    lookup: () => send<DailyMineResponse>(DAILY_MINE_ENDPOINT, { deviceId: identity().deviceId }),
    async resume(runId) {
      const res = await send<DailyResumeResponse>(RESUME_ENDPOINT, {
        deviceId: identity().deviceId,
        ...(runId !== undefined ? { runId } : {}),
      });
      if (res.state === "playing") {
        token = res.token;
        rememberRun(storage, res.gameNo, res.runId);
      } else token = null;
      return res;
    },
    started: () => start,
  };
}

// --------------------------------------------------------------- storage

/** Keeps today's run id, replacing any other game's. */
export function rememberRun(storage: StorageAccess, gameNo: number, runId: string): void {
  try {
    storage()?.setItem(DAILY_RUN_KEY, JSON.stringify({ gameNo, runId }));
  } catch {
    // Resume finds the run from the device anyway.
  }
}

/** The run id kept for game `gameNo`, or undefined: none, another game's, or unreadable. */
export function rememberedRun(storage: StorageAccess, gameNo: number): string | undefined {
  try {
    const raw = storage()?.getItem(DAILY_RUN_KEY);
    if (typeof raw !== "string") return undefined;
    const kept = JSON.parse(raw) as { gameNo?: unknown; runId?: unknown };
    return kept.gameNo === gameNo && typeof kept.runId === "string" ? kept.runId : undefined;
  } catch {
    return undefined;
  }
}

// ----------------------------------------------------------------- words

/** "Game 12". */
export function gameLabel(gameNo: number): string {
  return t("daily.game", { game: gameNo });
}

/** "Next game in 5 hours 12 minutes", or before launch "Game 1 starts in 3 days 4 hours". */
export function nextGameText(gameNo: number, nextGameAt: number, now: number): string {
  return gameNo < 1
    ? t("daily.firstGame", { time: countdownText(nextGameAt, now) })
    : t("daily.nextGame", { time: countdownText(nextGameAt, now) });
}

/** The score as it reads: "14/20", or past a perfect twenty the plain total, "25". */
export function dailyScoreText(correct: number, bonus: number): string {
  return correct === DAILY_QUESTIONS && bonus > 0
    ? String(correct + bonus)
    : t("score.of", { score: correct, target: DAILY_QUESTIONS });
}

/** Under a perfect run's score: "20/20 +5 bonus"; empty for any other run. */
export function bonusLine(correct: number, bonus: number): string {
  return correct === DAILY_QUESTIONS && bonus > 0
    ? t("daily.bonusLine", { bonus, target: DAILY_QUESTIONS })
    : "";
}

/** A run's right answers among the twenty, and its bonus rounds, from right/wrong marks. */
export function tally(results: readonly boolean[]): { correct: number; bonus: number } {
  return {
    correct: results.slice(0, DAILY_QUESTIONS).filter(Boolean).length,
    bonus: results.slice(DAILY_QUESTIONS).filter(Boolean).length,
  };
}

/** The track for a finished run, on the panel that shows it after a reload: right or wrong. */
export function resultTrack(results: readonly boolean[]): TrackStep[] {
  return Array.from({ length: DAILY_QUESTIONS }, (_, i) => ({
    kind: results[i] === true ? "hit" : "miss",
    tier: results[i] === true ? "basic" : null,
    current: false,
    final: i + 1 === DAILY_QUESTIONS,
  }));
}

/**
 * The title bar's score mid-run, in parts: the right answers, shown out of
 * twenty as Friendly's are ("14 / 20"), and the bonus ("+3"), shown smaller,
 * null until a bonus round has been answered.
 */
export function titleTally(results: readonly boolean[]): {
  readonly correct: number;
  readonly bonus: number | null;
} {
  const { correct, bonus } = tally(results);
  return { correct, bonus: results.length > DAILY_QUESTIONS ? bonus : null };
}

/** The chip in the bonus rounds: "+3 bonus". Empty before them. */
export function bonusChip(results: readonly boolean[]): string {
  if (results.length < DAILY_QUESTIONS || tally(results).correct < DAILY_QUESTIONS) return "";
  return t("daily.bonusChip", { bonus: tally(results).bonus });
}

/** "312th of 2,400"; empty before the run is on the board. */
export function rankLine(result: Pick<DailyResult, "rank" | "total">): string {
  if (result.rank === null || result.total === null) return "";
  return t("daily.rank", { rank: ordinal(result.rank), total: count(result.total) });
}

/** A score on the board: "14", or "25" with the perfect run's star, spoken in full. */
export function boardScore(entry: Pick<DailyBoardEntry, "score" | "perfect" | "bonus">): {
  readonly text: string;
  readonly star: boolean;
  readonly spoken: string;
} {
  return {
    text: String(entry.score),
    star: entry.perfect,
    spoken: entry.perfect
      ? t("daily.perfectSpoken", { score: entry.score, bonus: entry.bonus })
      : String(entry.score),
  };
}

// ------------------------------------------------------- the Legends card

/**
 * What the Legends page's Daily card shows in its button's place:
 *
 * - `pending` while the server is asked (a dimmed placeholder of Play's size);
 * - `play` with nothing played today, or when the answer can't be had;
 * - `resume` for a run still going ("Carry on");
 * - `done` once today's game is finished: the result, and a muted "come
 *   back tomorrow" in the button's place.
 */
export type CardAction =
  | { readonly kind: "pending" }
  | { readonly kind: "play" }
  | { readonly kind: "resume" }
  | { readonly kind: "done"; readonly result: DailyResult };

/**
 * Whether the card asks the server before it can say: only from Game 1, and
 * only for a device with an id (one that has started or published a run).
 * Any other device, storage blocked included, is shown Play at once.
 */
export function cardNeedsLookup(gameNo: number, deviceId: string | null): boolean {
  return gameNo >= 1 && deviceId !== null;
}

/**
 * The card's action for game `gameNo` from this device's lookup: `undefined`
 * while it is out, `null` when it failed (Play, so nothing is ever stuck).
 */
export function cardAction(gameNo: number, mine: DailyMineResponse | null | undefined): CardAction {
  if (mine === undefined) return { kind: "pending" };
  if (mine === null || mine.gameNo !== gameNo) return { kind: "play" };
  if (mine.state === "finished") return { kind: "done", result: mine.result };
  return mine.state === "playing" ? { kind: "resume" } : { kind: "play" };
}

/** A finished run on the card: "13/20 · 19th of 30", or the score alone before it is ranked. */
export function cardResultText(
  result: Pick<DailyResult, "correct" | "bonus" | "rank" | "total">,
): string {
  const score = dailyScoreText(result.correct, result.bonus);
  const rank = rankLine(result);
  return rank === "" ? score : t("mode.ranked.result", { score, rank });
}

// ----------------------------------------------------------------- share

/** One square per question: 🟩 right, 🟥 wrong (a timeout is wrong). */
export const RIGHT_SQUARE = "🟩";
export const WRONG_SQUARE = "🟥";

/**
 * The share text, spoiler-free: no player and no figure.
 *
 *   Bigger Than #12 — 15/20 🔥
 *   🟩🟩🟥🟩🟩🟩🟩🟥🟩🟩
 *   🟩🟩🟩🟥🟩🟩🟩🟩🟥🟩
 *   ⭐ +5 bonus                (a perfect run only)
 *   https://biggerthangame.com/football-higher-or-lower/legends/daily
 */
export function dailyShareText(
  result: Pick<DailyResult, "gameNo" | "results">,
  link: string,
): string {
  const { correct, bonus } = tally(result.results);
  const squares = Array.from({ length: DAILY_QUESTIONS }, (_, i) =>
    result.results[i] === true ? RIGHT_SQUARE : WRONG_SQUARE,
  );
  const lines = [
    t("daily.shareHeading", { game: result.gameNo, score: correct, target: DAILY_QUESTIONS }),
    squares.slice(0, 10).join(""),
    squares.slice(10, 20).join(""),
  ];
  if (correct === DAILY_QUESTIONS && bonus > 0) lines.push(t("daily.shareBonus", { bonus }));
  lines.push(link);
  return lines.join("\n");
}

/**
 * The share image's content for a Daily run, as spoiler-free as the text: the
 * game, the score, the twenty squares right or wrong, the bonus — no player
 * and no figure. A perfect run gets the trophy.
 */
export function dailyShareCard(
  result: Pick<DailyResult, "gameNo" | "results">,
  siteLabel: string,
): ShareCard {
  const { correct, bonus } = tally(result.results);
  const perfect = correct === DAILY_QUESTIONS;
  return {
    score: dailyScoreText(correct, bonus),
    won: perfect,
    caption:
      perfect && bonus > 0
        ? bonusLine(correct, bonus)
        : t("daily.caption", { target: DAILY_QUESTIONS }),
    title: t("daily.shareImageHeading", { game: result.gameNo }),
    cells: Array.from({ length: DAILY_QUESTIONS }, (_, i) =>
      result.results[i] === true
        ? { kind: "hit" as const, tier: "basic" as const }
        : { kind: "miss" as const },
    ),
    ended: null,
    note: "",
    players: null,
    challenge: "",
    site: siteLabel,
  };
}

/** The grid's words for a screen reader: "Your game: 15 of 20 right." */
export function dailyGridLabel(results: readonly boolean[]): string {
  const { correct, bonus } = tally(results);
  return correct === DAILY_QUESTIONS && bonus > 0
    ? t("daily.gridBonus", { target: DAILY_QUESTIONS, bonus })
    : t("daily.gridLabel", { right: correct, target: DAILY_QUESTIONS });
}

// ----------------------------------------------------------------- board

/** Today's board, or null when it couldn't be had. */
export async function fetchDailyBoard(
  fetchFn: Fetch,
  timeoutMs = 10_000,
): Promise<DailyBoardResponse | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetchFn(DAILY_BOARD_ENDPOINT, { method: "GET", signal: abort.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as DailyBoardResponse;
    return body.mode === "ranked" && Array.isArray(body.entries) ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** This device and today's game, or null when it couldn't be had. */
export async function fetchDailyMine(
  fetchFn: Fetch,
  deviceId: string,
  timeoutMs = 10_000,
): Promise<DailyMineResponse | null> {
  try {
    return await jsonPoster(fetchFn, timeoutMs)<DailyMineResponse>(DAILY_MINE_ENDPOINT, {
      deviceId,
    });
  } catch {
    return null;
  }
}
