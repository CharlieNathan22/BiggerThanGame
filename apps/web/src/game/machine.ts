/**
 * The game island's state machine, as a pure reducer.
 *
 *   idle → starting → title → holding → intro → dealing → [spinning] → awaiting
 *                                                   ↑                            │
 *            over ← verdict ← revealing ←─────────────────────────────┘
 *                       │                   │
 *                       └── [sliding] ──────┘  correct, next round
 *
 * The first deal opens with a title card: `title`, "Question 1 of 20" large
 * in the centre gliding into the plaque (quicker on Play again, `repeat`);
 * `holding`, the plaque shimmering while round one's photos load; then
 * `intro`, the cards sliding in. A tap or a key during the title or the hold
 * skips straight to the cards (`skip`). `sliding` is the carousel to the next
 * pair after a right answer: the challenger's card moves into the anchor's
 * place, the anchor's leaves, and the next challenger comes in. It is the last
 * `slide` ms of the usual `next` gap, and skipped with reduced motion.
 *
 * The server decides everything that matters — the pair, the stat, whether a
 * guess was right. This module only sequences what the player sees, so it holds
 * no game rules beyond "spin on round one and when the stat changes" (DESIGN.md
 * §7). Components render `GameState`; `controller.ts` runs the timers and the
 * network calls that produce events.
 *
 * Friendly has no clock, so `awaiting` waits for the player indefinitely. In a
 * timed mode (Endless, `QUESTION_LIMITS` in @bt/core) the question's clock
 * starts as `awaiting` begins — after the deal, and after the wheel lands on a
 * stat change — and stops the moment the player answers: it never runs while
 * the answer is in flight. When it runs out the controller sends `timeout`,
 * which goes to the server like a guess, so the player still sees the reveal.
 * The server owns the real clock; this one is the player's view of it.
 *
 * A request that fails doesn't end the run on the spot. A 429 is waited out
 * and the same request sent again; a dropped connection is retried visibly for
 * a few seconds and only then banked (DESIGN.md §3, Connectivity). Both show as
 * a `hitch` while the reveal (or the start) waits.
 *
 * In a mode with challenge links (Endless, DESIGN.md §13) a run can start from
 * one. The link is offered with the start; the server says whether it checks
 * out — the run is then framed as "Beat n" — or not. Either way the run is a
 * fresh one. Every run the server ends comes back with a signed link of its
 * own, to challenge a friend with. In Friendly an old link is only noted.
 */

import { questionLimit } from "@bt/core";
import type {
  AnswerResponse,
  ChallengeLink,
  ChallengeStatus,
  Mode,
  PlayerCard,
  Reveal,
  RoundPayload,
  RunEnd,
  StatKey,
  StatPayload,
  Tier,
  TimedGuess,
} from "@bt/core";
import type { Timings } from "./timing";

export type Phase =
  | "idle"
  | "starting"
  | "title"
  | "holding"
  | "intro"
  | "dealing"
  | "spinning"
  | "awaiting"
  | "revealing"
  | "verdict"
  | "sliding"
  | "over";

/**
 * Why a run stopped: the server's reasons, or the connection dropping (a run
 * banked with the streak verified so far).
 */
export type EndReason = RunEnd | "network";

/** The modes the game page plays. */
export type GameMode = Extract<Mode, "friendly" | "endless">;

/**
 * One answered round, for the share grid and share image (M5). Only what the
 * player has already seen — never a value.
 */
export interface RoundRecord {
  readonly index: number;
  readonly stat: StatKey;
  readonly tier: Tier;
  readonly correct: boolean;
}

/** Why a request failed, as far as the run is concerned (api.ts `classifyFailure`). */
export type Failure =
  /** No answer, a timeout or a server error: worth retrying for a while. */
  | { readonly kind: "network" }
  /** Too many requests: wait `retryAfterMs`, then send the same one again. */
  | { readonly kind: "rateLimited"; readonly retryAfterMs: number }
  /** A refusal retrying can't fix. */
  | { readonly kind: "fatal" }
  /** A run start the Turnstile check didn't pass (or couldn't run): try Start again. */
  | { readonly kind: "verification" };

/** A request that has to be sent again before the run can carry on. */
export type Hitch =
  | {
      readonly kind: "reconnecting";
      /** When the first failure in this spell happened. */
      readonly since: number;
      /** Retries sent so far in this spell. */
      readonly retries: number;
    }
  | {
      readonly kind: "slowDown";
      /** When to send again: the failure's time plus `retry-after`. */
      readonly until: number;
    };

/**
 * The reconnect loop: retry after 0.5 s, 1 s, then every 2 s, and give up —
 * banking the streak — once a failure lands this long after the first.
 * Network policy rather than animation, so these aren't design tokens.
 */
export const RECONNECT = { firstDelay: 500, maxDelay: 2000, giveUpAfter: 5000 } as const;

/** How long to wait before retry number `retries + 1` of a reconnecting spell. */
export function reconnectDelay(retries: number): number {
  return Math.min(RECONNECT.firstDelay * 2 ** retries, RECONNECT.maxDelay);
}

/**
 * A challenge link, through the run it started.
 *
 * - `offered`: from the page's URL, sent with the start. Framed as "Beat n".
 * - `accepted`: the server verified it; this run replays the challenged one.
 * - `refused`: broken, forged or too old; this run is a plain one, with a note.
 * - `retired`: a link on the Friendly page, from before challenges moved to
 *   Endless. Never sent; the start panel says it has expired.
 */
export type Challenge =
  | { readonly status: "offered"; readonly link: ChallengeLink }
  | { readonly status: "accepted"; readonly score: number }
  | { readonly status: "refused"; readonly reason: "invalid" | "expired" }
  | { readonly status: "retired" };

/**
 * The question's clock, in a timed mode: when it started (`performance.now()`)
 * and how long it runs. Null while the question isn't answerable, and always
 * in Friendly.
 */
export interface QuestionClock {
  readonly startedAt: number;
  readonly limitMs: number;
}

/**
 * The clock as it stood when the question was answered: what was left, frozen,
 * from the tap (or 0 on a timeout) until the next question's clock starts.
 */
export interface StoppedClock {
  readonly remainingMs: number;
  readonly limitMs: number;
}

/** When the guess went, and when the answer came back. `performance.now()` ms. */
export interface CountClock {
  readonly tappedAt: number;
  readonly arrivedAt: number | null;
}

export interface GameState {
  readonly phase: Phase;
  readonly mode: GameMode;
  readonly runId: string | null;
  /** The question on screen. */
  readonly round: RoundPayload | null;
  /**
   * The stat on the plaque. While a spin is pending it is still the previous
   * one (null before the first spin), so the plaque never shows the new stat
   * before the wheel lands on it.
   */
  readonly plaque: StatPayload | null;
  /** The answer sent: a pick, or `timeout` when the clock ran out. */
  readonly guess: TimedGuess | null;
  /** The question's clock, while it runs. */
  readonly clock: QuestionClock | null;
  /**
   * The last question's clock, stopped at the answer: the clock at the top
   * shows it, dimmed, through the reveal and the deal until the next question
   * can be answered. Null before a run's first answer, and in Friendly.
   */
  readonly stopped: StoppedClock | null;
  readonly count: CountClock | null;
  /** The challenger's figure, once the server has judged the guess. */
  readonly reveal: Reveal | null;
  /** The next question, held until the verdict has been shown. */
  readonly next: RoundPayload | null;
  /**
   * The last round's reveal, carried by its card into the anchor's place. On
   * a stat change the anchor shows it until the wheel lands on the new stat.
   */
  readonly carried: Reveal | null;
  readonly streak: number;
  /** Best streak, including the run in progress. */
  readonly best: number;
  /** Best streak before this run started, so the game-over panel can say "new best". */
  readonly bestBefore: number;
  readonly history: readonly RoundRecord[];
  readonly end: EndReason | null;
  /** The last start attempt failed; the start panel says so. */
  readonly startFailed: boolean;
  /** ...because the Turnstile check didn't pass: the panel suggests trying again. */
  readonly checkFailed: boolean;
  /** A request waiting to be sent again; null when all is well. */
  readonly hitch: Hitch | null;
  /** The challenge link this run came from, if any. */
  readonly challenge: Challenge | null;
  /**
   * This run was started by Play again, not the first of the page visit: its
   * title card is the quicker one.
   */
  readonly repeat: boolean;
  /**
   * The signed link to challenge a friend with, from the server's end of the
   * run. Null until then, and for a run banked after a dropped connection.
   */
  readonly link: ChallengeLink | null;
}

export type GameEvent =
  | { readonly type: "start" }
  | {
      readonly type: "started";
      readonly runId: string;
      readonly round: RoundPayload;
      readonly challenge?: ChallengeStatus;
    }
  | { readonly type: "startFailed"; readonly failure: Failure; readonly at: number }
  /** The title card has glided into the plaque: hold there for the photos. */
  | { readonly type: "titled" }
  /** The hold is over: the cards slide in. */
  | { readonly type: "held" }
  /** A tap or a key during the title or the hold: straight to the cards. */
  | { readonly type: "skip" }
  /** The cards are in: deal round one as usual. */
  | { readonly type: "introDone" }
  /** `at`: when (`performance.now()`); starts the clock when the question is answerable. */
  | { readonly type: "dealt"; readonly at?: number }
  | { readonly type: "spun"; readonly at?: number }
  | { readonly type: "guess"; readonly guess: TimedGuess; readonly at: number }
  /** The question's clock ran out: answered as `timeout`. */
  | { readonly type: "timeout"; readonly at: number }
  | { readonly type: "answered"; readonly response: AnswerResponse; readonly at: number }
  | { readonly type: "answerFailed"; readonly failure: Failure; readonly at: number }
  /** A hitch's wait is over: send the request again. */
  | { readonly type: "retry"; readonly at: number }
  | { readonly type: "settled" }
  /** Start the carousel to the next pair. */
  | { readonly type: "slide" }
  | { readonly type: "advance" };

export function initialState(
  best = 0,
  challenge: Challenge | null = null,
  mode: GameMode = "friendly",
): GameState {
  return {
    phase: "idle",
    mode,
    runId: null,
    round: null,
    plaque: null,
    guess: null,
    clock: null,
    stopped: null,
    count: null,
    reveal: null,
    next: null,
    carried: null,
    streak: 0,
    best,
    bestBefore: best,
    history: [],
    end: null,
    startFailed: false,
    checkFailed: false,
    hitch: null,
    challenge,
    link: null,
    repeat: false,
  };
}

/** The wheel spins on round one and whenever the stat changes (DESIGN.md §7). */
export function shouldSpin(round: RoundPayload): boolean {
  return round.index === 1 || round.stat.statChanged;
}

/**
 * The next state. An event that doesn't apply in the current phase — a second
 * tap, a timer from a finished run — returns the same state object unchanged.
 */
export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "start":
      if (state.phase !== "idle" && state.phase !== "over") return state;
      // A challenge belongs to the first run from the link. "Play again" is a fresh run.
      return {
        ...initialState(state.best, state.phase === "idle" ? state.challenge : null, state.mode),
        phase: "starting",
        repeat: state.phase === "over" || state.repeat,
      };

    case "started":
      if (state.phase !== "starting") return state;
      // Round one is dealt behind the title card; its cards come on after
      // the hold, and the plaque has no stat until the first spin lands.
      return {
        ...state,
        phase: "title",
        runId: event.runId,
        challenge: settleChallenge(state.challenge, event),
        round: event.round,
      };

    case "titled":
      if (state.phase !== "title") return state;
      return { ...state, phase: "holding" };

    case "held":
      if (state.phase !== "holding") return state;
      return { ...state, phase: "intro" };

    case "skip":
      if (state.phase !== "title" && state.phase !== "holding") return state;
      return { ...state, phase: "intro" };

    case "introDone":
      if (state.phase !== "intro" || state.round === null) return state;
      return deal(state, state.round);

    case "startFailed":
      if (state.phase !== "starting") return state;
      // A 429 before the run exists: wait it out, then start again.
      if (event.failure.kind === "rateLimited") {
        return {
          ...state,
          hitch: { kind: "slowDown", until: event.at + event.failure.retryAfterMs },
        };
      }
      return {
        ...state,
        phase: "idle",
        startFailed: true,
        checkFailed: event.failure.kind === "verification",
        hitch: null,
      };

    case "dealt":
      if (state.phase !== "dealing" || state.round === null) return state;
      return shouldSpin(state.round)
        ? { ...state, phase: "spinning" }
        : { ...state, phase: "awaiting", clock: clockFor(state, event.at), stopped: null };

    case "spun":
      if (state.phase !== "spinning" || state.round === null) return state;
      return {
        ...state,
        phase: "awaiting",
        plaque: state.round.stat,
        clock: clockFor(state, event.at),
        stopped: null,
      };

    case "guess":
    case "timeout":
      if (state.phase !== "awaiting") return state;
      // The clock stops here: never while the answer is in flight.
      return {
        ...state,
        phase: "revealing",
        guess: event.type === "timeout" ? "timeout" : event.guess,
        clock: null,
        stopped: stopClock(state.clock, event),
        count: { tappedAt: event.at, arrivedAt: null },
      };

    case "answered": {
      if (state.phase !== "revealing" || state.reveal !== null || state.count === null) {
        return state;
      }
      const { response } = event;
      // A reveal for some other round means client and server disagree about
      // where the run is. Nothing sensible can follow, so bank the streak.
      if (state.round === null || response.reveal.round !== state.round.index) {
        return over(state, "network");
      }
      return {
        ...state,
        hitch: null,
        count: { ...state.count, arrivedAt: event.at },
        reveal: response.reveal,
        next: "next" in response ? response.next : null,
        end: "end" in response ? response.end : null,
        link: "end" in response ? (response.challenge ?? null) : null,
      };
    }

    case "answerFailed": {
      if (state.phase !== "revealing" || state.reveal !== null) return state;
      const { failure, at } = event;
      if (failure.kind === "fatal") return over(state, "network");
      // Never ends the run: wait out the limit, then send the same answer.
      if (failure.kind === "rateLimited") {
        return { ...state, hitch: { kind: "slowDown", until: at + failure.retryAfterMs } };
      }
      const spell = state.hitch?.kind === "reconnecting" ? state.hitch : null;
      const since = spell?.since ?? at;
      if (at - since >= RECONNECT.giveUpAfter) return over(state, "network");
      return { ...state, hitch: { kind: "reconnecting", since, retries: spell?.retries ?? 0 } };
    }

    case "retry": {
      const { hitch } = state;
      if (hitch === null) return state;
      if (state.phase === "starting") return { ...state, hitch: null };
      if (state.phase !== "revealing" || state.reveal !== null || state.count === null) {
        return state;
      }
      // After a slow-down the number has sat at "?"; the count starts afresh
      // from the retry, so the reveal plays in full rather than snapping.
      if (hitch.kind === "slowDown") {
        return { ...state, hitch: null, count: { tappedAt: event.at, arrivedAt: null } };
      }
      return { ...state, hitch: { ...hitch, retries: hitch.retries + 1 } };
    }

    case "settled": {
      if (state.phase !== "revealing" || state.reveal === null || state.round === null) {
        return state;
      }
      const { correct } = state.reveal;
      const streak = correct ? state.streak + 1 : state.streak;
      const record: RoundRecord = {
        index: state.round.index,
        stat: state.round.stat.key,
        tier: state.round.stat.tier,
        correct,
      };
      return {
        ...state,
        phase: "verdict",
        streak,
        best: Math.max(state.best, streak),
        history: [...state.history, record],
      };
    }

    case "slide":
      if (state.phase !== "verdict" || state.reveal?.correct !== true || state.next === null) {
        return state;
      }
      return { ...state, phase: "sliding" };

    case "advance":
      if (state.phase !== "verdict" && state.phase !== "sliding") return state;
      if (state.reveal?.correct === true && state.next !== null) {
        return deal(
          {
            ...state,
            guess: null,
            count: null,
            carried: state.reveal,
            reveal: null,
            next: null,
            end: null,
          },
          state.next,
        );
      }
      if (state.phase === "sliding") return state;
      return { ...state, phase: "over", end: state.end ?? "deck-exhausted" };
  }
}

/** The clock frozen at an answer: what was left at the tap, or nothing at a timeout. */
function stopClock(
  clock: QuestionClock | null,
  event: { readonly type: "guess" | "timeout"; readonly at: number },
): StoppedClock | null {
  if (clock === null) return null;
  const remainingMs =
    event.type === "timeout" ? 0 : Math.max(0, clock.limitMs - (event.at - clock.startedAt));
  return { remainingMs, limitMs: clock.limitMs };
}

/** The clock for the round on screen, in a timed mode; null in Friendly. */
function clockFor(state: GameState, at: number | undefined): QuestionClock | null {
  if (state.round === null) return null;
  const limitMs = questionLimit(state.mode, state.round.index);
  return limitMs === null ? null : { startedAt: at ?? 0, limitMs };
}

/** What the server made of the offered link. A refusal made before the start stands. */
function settleChallenge(
  offered: Challenge | null,
  event: Extract<GameEvent, { type: "started" }>,
): Challenge | null {
  if (offered?.status !== "offered") return offered;
  const { challenge } = event;
  if (challenge === undefined) return null;
  return challenge.accepted
    ? { status: "accepted", score: challenge.score }
    : { status: "refused", reason: challenge.reason };
}

/** The link the start request should carry, if the run is starting from one. */
export function offeredLink(state: GameState): ChallengeLink | undefined {
  return state.challenge?.status === "offered" ? state.challenge.link : undefined;
}

function deal(state: GameState, round: RoundPayload): GameState {
  return {
    ...state,
    phase: "dealing",
    round,
    // Without a spin the plaque shows the stat straight away; with one it keeps
    // the previous stat until the wheel lands.
    plaque: shouldSpin(round) ? state.plaque : round.stat,
  };
}

function over(state: GameState, end: EndReason): GameState {
  return { ...state, phase: "over", end, next: null, hitch: null, link: null, clock: null };
}

/**
 * How long the controller waits before sending a hitched request again: to the
 * end of a slow-down, or the next step of the reconnect loop. Null when
 * nothing is waiting.
 */
export function retryDelay(state: GameState, now: number): number | null {
  const { hitch } = state;
  if (hitch === null) return null;
  if (hitch.kind === "slowDown") return Math.max(0, hitch.until - now);
  return reconnectDelay(hitch.retries);
}

/**
 * The one card a new round payload brings that isn't on screen yet: the
 * challenger. The anchor is the challenger just revealed, whose photo has
 * already loaded. Round one brings both.
 */
export function newCards(round: RoundPayload): readonly PlayerCard[] {
  return round.index === 1 ? [round.anchor, round.challenger] : [round.challenger];
}

// ---------------------------------------------------------------- timings

/** How long the players are on screen before the wheel, or before the value if there's no spin. */
export function dealDelay(round: RoundPayload, timings: Timings): number {
  return shouldSpin(round) ? timings.beat : timings.hold;
}

/**
 * How long the wheel runs. The same with reduced motion: the plaque shows the
 * new stat at once and holds still for the spin's time, so a question becomes
 * answerable at the same moment for everyone — the moment the server's clock
 * and the thinking-time tiebreak assume (core `answerAllowance`). Only the
 * motion changes, never the timing.
 */
export function spinDelay(timings: Timings): number {
  return timings.spin + timings.land;
}

/**
 * When the challenger's count-up runs, once the answer has arrived.
 *
 * It starts from zero the moment the response lands and ends at whichever is
 * later: the nominal count (`count` after the tap), or `settle` after arrival.
 * An on-time response therefore looks exactly like the plain count-up, and a
 * late one still counts for at least `settle` — the number never snaps. Until
 * the response lands, the number holds at zero. ARCHITECTURE.md §9.
 */
export function settleWindow(
  count: CountClock,
  timings: Timings,
  reducedMotion: boolean,
): { readonly start: number; readonly end: number } | null {
  if (count.arrivedAt === null) return null;
  const start = count.arrivedAt;
  if (reducedMotion) return { start, end: start };
  return { start, end: Math.max(count.tappedAt + timings.count, start + timings.settle) };
}

/**
 * When the verdict colour shows: the same distance after the count settles as
 * the nominal timings put it (`verdict - count`). The same with reduced
 * motion, where the value shows on arrival instead of counting up: the
 * verdict still waits for when the count would have settled, so the next
 * question comes at the same moment for everyone.
 */
export function verdictAt(count: CountClock, timings: Timings): number {
  const window = settleWindow(count, timings, false);
  if (window === null) throw new Error("verdictAt: the answer hasn't arrived");
  return window.end + Math.max(0, timings.verdict - timings.count);
}

/** From the verdict colour to the next deal, or to the game-over panel. */
export function advanceDelay(state: GameState, timings: Timings): number {
  return state.reveal?.correct === true && state.next !== null ? timings.next : timings.over;
}

/**
 * Whether this verdict hands over to the next pair with the carousel slide:
 * a right answer with a next round, and motion allowed. A wrong answer or a
 * win goes to the game-over panel instead.
 */
export function slides(state: GameState, reducedMotion: boolean): boolean {
  return !reducedMotion && state.reveal?.correct === true && state.next !== null;
}

/**
 * From the verdict colour to the start of the slide: the slide is the last
 * `slide` ms of the usual `next` gap, so a round takes no longer.
 */
export function slideDelay(timings: Timings): number {
  return Math.max(0, timings.next - timings.slide);
}
