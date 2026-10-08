/**
 * Text and small derived values the components render. Pure, so the wording
 * and the edge cases are under test rather than buried in markup.
 */

import { STREAK_TITLES, questionLimit, streakTitle } from "@bt/core";
import type { PlayerCard, StatKey, Tier } from "@bt/core";
import { formatDate, statLabel, t } from "../i18n";
import type { GameState, Hitch, QuestionClock, RoundRecord } from "./machine";
import { asPlay } from "./variant";
import type { PlayLike } from "./variant";

/**
 * A score as the play shows it: out of the win target where it has one
 * (`7/20` in Friendly, `21/34` through a squad), else the plain number.
 */
export function scoreFigure(score: number, play: PlayLike): string {
  const { mode, target } = asPlay(play);
  if (target === null) return String(score);
  // Daily Ranked past a perfect twenty: "20/20 +3".
  if (mode === "ranked" && score > target) {
    return t("daily.titleBonus", { target, bonus: score - target });
  }
  return t("score.of", { score, target });
}

/** Whether `round` is the play's final question: the last of its win target. */
function isLast(round: number, play: PlayLike): boolean {
  return asPlay(play).target === round;
}

/**
 * "Question 7 of 20": the round on screen, in a mode with a win target, and
 * "Final question — question 20 of 20" on its last. Empty otherwise.
 */
export function progressText(state: GameState, play: PlayLike): string {
  const { target } = asPlay(play);
  const round = state.round?.index ?? 1;
  if (target === null) return "";
  return isLast(round, play)
    ? t("progress.final", { round, target })
    : t("progress.question", { round, target });
}

/**
 * The final question is on screen: the last round of the mode's win target,
 * dealt and not yet over. The plaque and the track mark it.
 */
export function isFinalQuestion(state: GameState, play: PlayLike): boolean {
  if (state.round === null || state.phase === "idle" || state.phase === "over") return false;
  return isLast(state.round.index, play);
}

/**
 * One segment of the progress track: an answered round in its tier's colour,
 * the miss, or a round still to come. `current` marks the round on screen.
 */
export interface TrackStep {
  readonly kind: "hit" | "miss" | "todo";
  readonly tier: Tier | null;
  readonly current: boolean;
  /** The final question's segment, the last: marked in gold. */
  readonly final: boolean;
}

/**
 * The progress track, one step per round of the mode's target — none for a
 * mode without one. Built from the round history, so it holds nothing the
 * player hasn't seen.
 */
export function trackSteps(state: GameState, play: PlayLike): TrackStep[] {
  const { target } = asPlay(play);
  if (target === null) return [];
  const byIndex = new Map<number, RoundRecord>(state.history.map((r) => [r.index, r]));
  const onScreen = state.phase === "idle" || state.phase === "over" ? null : state.round?.index;
  return Array.from({ length: target }, (_, i) => {
    const record = byIndex.get(i + 1);
    const current = onScreen === i + 1;
    const final = i + 1 === target;
    if (record === undefined) return { kind: "todo", tier: null, current, final };
    return { kind: record.correct ? "hit" : "miss", tier: record.tier, current, final };
  });
}

/** The monogram: the first character of the name, whole even if it's accented or astral. */
export function initial(name: string): string {
  return Array.from(name.trim())[0] ?? "";
}

/** The small print under a figure: the fee's year, the follower snapshot date. */
export function qualifierText(stat: StatKey, qualifier: string | undefined): string {
  if (qualifier === undefined || qualifier === "") return "";
  if (stat === "fee") return t("qual.fee", { year: qualifier });
  if (stat === "ig") return t("qual.ig", { date: formatDate(qualifier) });
  return qualifier;
}

/**
 * The labels on the reel for one spin: eleven other stats in random order,
 * then the one it lands on. Decorative only — the stat itself came from the
 * server — so the browser's own randomness is fine here.
 */
export function reelStrip(
  target: StatKey,
  keys: readonly StatKey[],
  random: () => number,
  length = 12,
): StatKey[] {
  const others = keys.filter((k) => k !== target);
  const strip: StatKey[] = [];
  for (let i = 0; others.length > 0 && i < length - 1; i++) {
    strip.push(others[i % others.length] as StatKey);
  }
  for (let i = strip.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [strip[i], strip[j]] = [strip[j] as StatKey, strip[i] as StatKey];
  }
  strip.push(target);
  return strip;
}

/**
 * What the screen reader hears. Empty when nothing new has happened. In a mode
 * with a win target each question starts with where the run is ("Question 7
 * of 20"), the text equivalent of the progress track.
 */
export function announcement(state: GameState, play: PlayLike): string {
  const { round, reveal } = state;
  if (round === null) return "";
  const { target, theme } = asPlay(play);
  // Once, as the title card comes up: "Question 1 of 20" (after "Beat 7/20"
  // for a replayed challenge).
  if (state.phase === "title") {
    const lead = plaqueLead(state, play) ?? "";
    const card = titleCard(state, play) ?? "";
    return card === lead ? `${lead}.` : `${card}. ${lead}.`;
  }
  if (state.phase === "awaiting") {
    // Say so when the stat has just changed: the plaque is the question.
    const key = round.stat.statChanged ? "live.statChanged" : "live.question";
    const question = t(key, {
      stat: statLabel(round.stat.key, state.variant),
      anchor: round.anchor.name,
      value: round.anchor.display,
      challenger: round.challenger.name,
    });
    return target === null ? question : `${progressText(state, play)}. ${question}`;
  }
  // Once, as the game-over panel comes up; the verdict was said a moment ago.
  const best = bestOutcome(state);
  if (best !== null) return best === "new" ? t("live.newHighScore") : t("live.matchedBest");
  if ((state.phase === "verdict" || state.phase === "over") && reveal !== null) {
    const params = { challenger: round.challenger.name, value: reveal.display };
    // Daily Ranked: a miss among the twenty goes on to the next question.
    if (state.mode === "ranked") {
      if (state.end !== null) {
        return t("live.dailyDone", { ...params, score: scoreFigure(state.streak, play) });
      }
      if (state.guess === "timeout" && !reveal.correct) return t("live.timeoutOn", params);
      if (!reveal.correct) return t("live.wrongOn", params);
    }
    if (state.end === "timeout") return t("live.timeout", params);
    if (!reveal.correct) return t("live.wrong", params);
    if (state.end === "won") {
      return theme === undefined
        ? t("live.won", { ...params, score: state.streak })
        : t("live.squadCleared", { ...params, squad: theme.name });
    }
    return target === null
      ? t("live.correct", { ...params, streak: state.streak })
      : t("live.correctOf", { ...params, score: state.streak, target });
  }
  return "";
}

/**
 * The note for a challenge link that didn't start a replay: shown on the start
 * panel for a link too broken to send, and over round one when the server
 * refused it. Empty otherwise.
 */
export function challengeNotice(state: GameState): string {
  const { challenge, phase, round } = state;
  if (phase === "over") return "";
  if (round !== null && round.index !== 1) return "";
  // An old Friendly link: said on the start panel only, and never sent.
  if (challenge?.status === "retired") return phase === "idle" ? t("challenge.retired") : "";
  if (challenge?.status !== "refused") return "";
  return challenge.reason === "expired" ? t("challenge.expired") : t("challenge.invalid");
}

/**
 * The label on the challenger's half while the verdict shows: "Correct" or
 * "Incorrect", from the verdict colour landing until the next pair is dealt
 * or the game-over panel takes over. Null the rest of the time.
 */
export function verdictLabel(state: GameState): string | null {
  if (state.phase !== "verdict" || state.reveal === null) return null;
  if (state.end === "timeout") return t("verdict.timeout");
  return state.reveal.correct ? t("verdict.correct") : t("verdict.incorrect");
}

/**
 * A card on the pitch and the place it sits in: 0 the anchor's half, 1 the
 * challenger's, -1 just off the anchor's side (leaving), each a half's length
 * along. The pitch draws each at its place by transform, so a card that moves
 * place slides there.
 */
export type CardPlace = -1 | 0 | 1;

/**
 * What a card is doing:
 * - `anchor`, `challenger`: the round on screen;
 * - `leaving`, `carried`, `incoming`: the slide to the next pair. The anchor
 *   leaves, the challenger is carried into the anchor's place with its figure,
 *   and the next challenger comes in with "?".
 */
export type CardRole = "anchor" | "challenger" | "leaving" | "carried" | "incoming";

export interface PitchCard {
  /**
   * Stable for the card's whole time on the pitch: a challenger keeps its key
   * when it becomes the next anchor, so its element (and its photo) carries
   * over rather than being built again.
   */
  readonly key: string;
  readonly player: PlayerCard;
  readonly place: CardPlace;
  readonly role: CardRole;
}

/**
 * The cards on the pitch, in drawing order. None before a run is dealt, nor
 * during its title card and hold: the pitch is empty until the cards slide in.
 */
export function pitchCards(state: GameState): PitchCard[] {
  const { round } = state;
  if (round === null || state.phase === "title" || state.phase === "holding") return [];
  const run = state.runId ?? "";
  // A card is named by the round it was dealt as challenger; round one's
  // anchor, dealt on its own, is "a1".
  const anchorKey = round.index === 1 ? `${run}:a1` : `${run}:c${round.index - 1}`;
  const challengerKey = `${run}:c${round.index}`;
  if (state.phase === "sliding" && state.next !== null) {
    return [
      { key: anchorKey, player: round.anchor, place: -1, role: "leaving" },
      { key: challengerKey, player: round.challenger, place: 0, role: "carried" },
      {
        key: `${run}:c${state.next.index}`,
        player: state.next.challenger,
        place: 1,
        role: "incoming",
      },
    ];
  }
  return [
    { key: anchorKey, player: round.anchor, place: 0, role: "anchor" },
    { key: challengerKey, player: round.challenger, place: 1, role: "challenger" },
  ];
}

/** A figure on a card, with the stat that formats its qualifier. */
export interface ShownFigure {
  readonly display: string;
  readonly qualifier: string | undefined;
  readonly stat: StatKey;
}

/**
 * The anchor's figure, or null while it isn't shown. From the wheel landing
 * to the game-over panel it is the anchor's value. Before that, after a slide,
 * the card still shows the figure it was revealed with: the same number when
 * the stat holds, and on a stat change the old stat's figure, which fades out
 * as the wheel starts (`anchorFading`) and gives way to the new one when it
 * lands. Round one's anchor shows nothing until then.
 */
export function anchorFigure(state: GameState): ShownFigure | null {
  const { phase, round } = state;
  if (round === null) return null;
  const own: ShownFigure = {
    display: round.anchor.display,
    qualifier: round.anchor.qualifier,
    stat: round.stat.key,
  };
  if (phase === "awaiting" || phase === "revealing" || phase === "verdict" || phase === "over") {
    return own;
  }
  if (phase === "sliding") return own;
  if ((phase === "dealing" || phase === "spinning") && round.index > 1) {
    if (!round.stat.statChanged) return own;
    const { carried, plaque } = state;
    if (carried === null || plaque === null) return null;
    return { display: carried.display, qualifier: carried.qualifier, stat: plaque.key };
  }
  return null;
}

/**
 * The anchor's old figure is fading out: the stat has changed and the wheel
 * is spinning to the new one, so the old number is never shown beside it.
 */
export function anchorFading(state: GameState): boolean {
  const { round } = state;
  return state.phase === "spinning" && round !== null && round.index > 1 && round.stat.statChanged;
}

/**
 * The title card's words while it plays: "Question 1 of 20" ("Question 1"
 * in a mode without a target), or for a replayed challenge "Beat 7/20" (or
 * "Match 20/20"). Null otherwise. It glides into the plaque, which then reads
 * "Question 1 of 20" (`plaqueLead`).
 */
export function titleCard(state: GameState, play: PlayLike): string | null {
  if (state.phase !== "title") return null;
  const { challenge } = state;
  if (challenge?.status === "accepted") {
    const score = scoreFigure(challenge.score, play);
    return isLast(challenge.score, play)
      ? t("challenge.headingPerfect", { score })
      : t("challenge.heading", { score });
  }
  return plaqueLead(state, play);
}

/**
 * What the plaque is doing at a run's start: arriving as the title card glides
 * into it (`title`), or holding with a shimmer while round one's photos load
 * (`hold`). Null the rest of the time.
 */
export function plaqueStage(state: GameState): "title" | "hold" | null {
  if (state.phase === "title") return "title";
  if (state.phase === "holding") return "hold";
  return null;
}

/** A tap or a key now skips the title card or the hold, straight to the cards. */
export function canSkipTitle(state: GameState): boolean {
  return state.phase === "title" || state.phase === "holding";
}

/** The first deal's kick-off is playing: round one's cards sliding in. */
export function isIntro(state: GameState): boolean {
  return state.phase === "intro";
}

/**
 * What the plaque reads before round one's wheel has spun: "Question 1 of 20"
 * in a mode with a win target, else "Question 1". Null once a stat is on it,
 * and when no run is on the pitch. The wheel spins from it into the stat.
 */
export function plaqueLead(state: GameState, play: PlayLike): string | null {
  const { phase, round } = state;
  if (round === null || round.index !== 1 || state.plaque !== null) return null;
  if (phase === "idle" || phase === "starting" || phase === "over") return null;
  const { target } = asPlay(play);
  return target === null
    ? t("plaque.question", { round: 1 })
    : t("plaque.questionOf", { round: 1, target });
}

/**
 * The score badge after a right answer, in a mode with a win target: the new
 * score ("3/20"), and at a streak title's milestone the title too ("5/20 ·
 * Squad player"). `key` changes with each right answer, so each one replays
 * its entrance. It shows from the verdict until the next guess (its own
 * animation fades it out long before), and not on a wrong answer or the
 * winning one, which the panel covers.
 */
export interface ScoreBadge {
  readonly key: number;
  readonly text: string;
  readonly milestone: boolean;
}

export function scoreBadge(state: GameState, play: PlayLike): ScoreBadge | null {
  const { mode, target } = asPlay(play);
  if (state.streak === 0 || state.end === "won") return null;
  const { phase } = state;
  if (
    phase !== "verdict" &&
    phase !== "sliding" &&
    phase !== "dealing" &&
    phase !== "spinning" &&
    phase !== "awaiting"
  ) {
    return null;
  }
  const last = state.history.at(-1);
  if (last === undefined || !last.correct) return null;
  const score = scoreFigure(state.streak, play);
  // Daily Ranked has no streak titles: its score is right answers, not a streak.
  const title =
    mode === "ranked"
      ? undefined
      : STREAK_TITLES[mode].find(
          (t) => t.min === state.streak && (target === null || t.min < target),
        );
  return title === undefined
    ? { key: state.streak, text: score, milestone: false }
    : {
        key: state.streak,
        text: t("badge.milestone", { score, title: t(`title.${title.id}`) }),
        milestone: true,
      };
}

/** The note under the challenger while a request waits to go again. */
export function hitchText(hitch: Hitch | null): string {
  if (hitch === null) return "";
  return hitch.kind === "slowDown" ? t("hitch.slowDown") : t("hitch.reconnecting");
}

/**
 * How a finished run compares with the best this deck and mode had before it
 * (`bestBefore`, from the device, or from earlier runs this visit when storage
 * is blocked). Only when there was a best to beat: a device's first run has
 * none. A win that equals the best (20/20 again) is just "You won".
 */
export type BestOutcome = "new" | "matched";

export function bestOutcome(state: GameState): BestOutcome | null {
  if (state.phase !== "over" || state.bestBefore <= 0) return null;
  if (state.streak > state.bestBefore) return "new";
  if (state.streak === state.bestBefore && state.end !== "won") return "matched";
  return null;
}

/**
 * The run in progress is past the previous best: the title bar's Best counts
 * with the streak and glows gold. Not on a device's first run.
 */
export function onNewBest(state: GameState): boolean {
  return state.phase !== "idle" && state.bestBefore > 0 && state.streak > state.bestBefore;
}

/**
 * The streak title the run holds so far, for the chip under the title bar in a
 * mode without a progress track (Endless): "Starter". Empty below the first,
 * and in a mode with a track.
 */
export function titleChip(state: Pick<GameState, "streak">, play: PlayLike): string {
  const { mode, target } = asPlay(play);
  if (target !== null) return "";
  const title = streakTitle(state.streak, mode);
  return title === undefined ? "" : t(`title.${title.id}`);
}

/**
 * The note on the game-over panel when the run didn't end on a revealed round:
 * a dropped connection, with the streak kept. Empty otherwise.
 */
export function bankedText(state: Pick<GameState, "end" | "streak">, play: PlayLike): string {
  if (state.end !== "network") return "";
  return asPlay(play).target === null
    ? t("over.networkSaved", { streak: state.streak })
    : t("over.network", { streak: state.streak });
}

// ------------------------------------------------------------------ clock

/** From five seconds out the clock warns: orange, with a soft glow. */
export const WARN_MS = 5000;

/** From three seconds out it is urgent: red, a little larger, a shake on each second. */
export const URGENT_MS = 3000;

/** How pressing the time left is: calm, warning (5 s and below), urgent (3 s and below). */
export type ClockLevel = "calm" | "warning" | "urgent";

export interface ClockState {
  /** Whole seconds left, rounded up: "3" until the last instant of the third, 0 at the end. */
  readonly seconds: number;
  readonly level: ClockLevel;
}

/** The clock's number and level for what's left, in ms. */
export function clockState(remainingMs: number): ClockState {
  const left = Math.max(0, remainingMs);
  return {
    seconds: Math.ceil(left / 1000),
    level: left <= URGENT_MS ? "urgent" : left <= WARN_MS ? "warning" : "calm",
  };
}

/** The countdown as the plaque's line draws it. */
export interface ClockView extends ClockState {
  /** What's left, ms, never below zero. */
  readonly remainingMs: number;
  /**
   * How full the line is, 0 to 1. With reduced motion it shrinks in whole-second
   * steps rather than smoothly.
   */
  readonly fraction: number;
}

/**
 * What's left of a running clock at `now` (`performance.now()`): never below
 * zero, and never above the limit (a frame drawn with a `now` from before the
 * clock started reads as the full limit).
 */
export function remainingMs(clock: QuestionClock, now: number): number {
  return Math.min(clock.limitMs, Math.max(0, clock.limitMs - (now - clock.startedAt)));
}

/** The clock at `now` (`performance.now()`). */
export function clockView(clock: QuestionClock, now: number, reducedMotion = false): ClockView {
  const left = remainingMs(clock, now);
  const state = clockState(left);
  const smooth = left / clock.limitMs;
  const stepped = Math.min(1, (state.seconds * 1000) / clock.limitMs);
  return { ...state, remainingMs: left, fraction: reducedMotion ? stepped : smooth };
}

/** The big clock at the top of the pitch (Endless). */
export interface TopClock extends ClockState {
  /** Counting down now. */
  readonly running: boolean;
  /** Stopped at the player's answer (or at 0 on a timeout), dimmed, until the next question. */
  readonly frozen: boolean;
}

/**
 * The big clock for the game as it stands at `now`. Running while a question
 * can be answered; frozen on the second the player answered at, through the
 * reveal and the next deal, until the next question becomes answerable; at
 * the full limit, waiting, while round one is dealt. Null in a mode without a
 * clock, and before the cards are in or once the run is over.
 */
export function topClock(state: GameState, now: number): TopClock | null {
  const { phase, round } = state;
  if (round === null || questionLimit(state.mode, round.index) === null) return null;
  if (phase === "idle" || phase === "starting" || phase === "title" || phase === "holding") {
    return null;
  }
  if (phase === "over") return null;
  if (state.clock !== null) {
    return { ...clockState(remainingMs(state.clock, now)), running: true, frozen: false };
  }
  if (state.stopped !== null) {
    return { ...clockState(state.stopped.remainingMs), running: false, frozen: true };
  }
  const limit = questionLimit(state.mode, round.index) ?? 0;
  return { ...clockState(limit), running: false, frozen: false };
}

/**
 * What the clock's live region says: "5 seconds left" from five seconds out,
 * "3 seconds left" from three, nothing otherwise. The words change only twice
 * a question, so screen readers hear two announcements, never a count.
 */
export function clockAnnouncement(
  clock: Pick<TopClock, "level" | "running" | "seconds"> | null,
): string {
  if (clock === null || !clock.running || clock.seconds === 0) return "";
  if (clock.level === "urgent") return t("clock.warning", { seconds: URGENT_MS / 1000 });
  if (clock.level === "warning") return t("clock.warning", { seconds: WARN_MS / 1000 });
  return "";
}

/**
 * "in a row", "correct, then out" for a streak of one, or "a perfect run" for a
 * win; "through the squad" for a squad not cleared.
 */
export function overCaption(state: Pick<GameState, "streak" | "end">, play?: PlayLike): string {
  if (state.end === "won") return t("over.caption.won");
  if (play !== undefined && asPlay(play).theme !== undefined) return t("over.caption.squad");
  return state.streak === 1 ? t("over.caption.one") : t("over.caption.other");
}
