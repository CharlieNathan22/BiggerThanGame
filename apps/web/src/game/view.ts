/**
 * Text and small derived values the components render. Pure, so the wording
 * and the edge cases are under test rather than buried in markup.
 */

import { WIN_ROUNDS, isFinalRound } from "@bt/core";
import type { Mode, PlayerCard, StatKey, Tier } from "@bt/core";
import { formatDate, statLabel, t } from "../i18n";
import type { GameState, Hitch, RoundRecord } from "./machine";

/**
 * A score as the mode shows it: out of the win target where the mode has one
 * (`7/20` in Friendly), else the plain number.
 */
export function scoreFigure(score: number, mode: Mode): string {
  const target = WIN_ROUNDS[mode];
  return target === null ? String(score) : t("score.of", { score, target });
}

/**
 * "Question 7 of 20": the round on screen, in a mode with a win target, and
 * "Final question — question 20 of 20" on its last. Empty otherwise.
 */
export function progressText(state: GameState, mode: Mode): string {
  const target = WIN_ROUNDS[mode];
  const round = state.round?.index ?? 1;
  if (target === null) return "";
  return isFinalRound(round, mode)
    ? t("progress.final", { round, target })
    : t("progress.question", { round, target });
}

/**
 * The final question is on screen: the last round of the mode's win target,
 * dealt and not yet over. The plaque and the track mark it.
 */
export function isFinalQuestion(state: GameState, mode: Mode): boolean {
  if (state.round === null || state.phase === "idle" || state.phase === "over") return false;
  return isFinalRound(state.round.index, mode);
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
export function trackSteps(state: GameState, mode: Mode): TrackStep[] {
  const target = WIN_ROUNDS[mode];
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
export function announcement(state: GameState, mode: Mode): string {
  const { round, reveal } = state;
  if (round === null) return "";
  const target = WIN_ROUNDS[mode];
  // Once, as the title card comes up: "Question 1 of 20" (after "Beat 7/20"
  // for a replayed challenge).
  if (state.phase === "title") {
    const lead = plaqueLead(state, mode) ?? "";
    const card = titleCard(state, mode) ?? "";
    return card === lead ? `${lead}.` : `${card}. ${lead}.`;
  }
  if (state.phase === "awaiting") {
    // Say so when the stat has just changed: the plaque is the question.
    const key = round.stat.statChanged ? "live.statChanged" : "live.question";
    const question = t(key, {
      stat: statLabel(round.stat.key),
      anchor: round.anchor.name,
      value: round.anchor.display,
      challenger: round.challenger.name,
    });
    return target === null ? question : `${progressText(state, mode)}. ${question}`;
  }
  // Once, as the game-over panel comes up; the verdict was said a moment ago.
  const best = bestOutcome(state);
  if (best !== null) return best === "new" ? t("live.newHighScore") : t("live.matchedBest");
  if ((state.phase === "verdict" || state.phase === "over") && reveal !== null) {
    const params = { challenger: round.challenger.name, value: reveal.display };
    if (!reveal.correct) return t("live.wrong", params);
    if (state.end === "won") return t("live.won", { ...params, score: state.streak });
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
  if (challenge?.status !== "refused" || phase === "over") return "";
  if (round !== null && round.index !== 1) return "";
  return challenge.reason === "expired" ? t("challenge.expired") : t("challenge.invalid");
}

/**
 * The label on the challenger's half while the verdict shows: "Correct" or
 * "Incorrect", from the verdict colour landing until the next pair is dealt
 * or the game-over panel takes over. Null the rest of the time.
 */
export function verdictLabel(state: GameState): string | null {
  if (state.phase !== "verdict" || state.reveal === null) return null;
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
export function titleCard(state: GameState, mode: Mode): string | null {
  if (state.phase !== "title") return null;
  const { challenge } = state;
  if (challenge?.status === "accepted") {
    const score = scoreFigure(challenge.score, mode);
    return WIN_ROUNDS[mode] === challenge.score
      ? t("challenge.headingPerfect", { score })
      : t("challenge.heading", { score });
  }
  return plaqueLead(state, mode);
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
export function plaqueLead(state: GameState, mode: Mode): string | null {
  const { phase, round } = state;
  if (round === null || round.index !== 1 || state.plaque !== null) return null;
  if (phase === "idle" || phase === "starting" || phase === "over") return null;
  const target = WIN_ROUNDS[mode];
  return target === null
    ? t("plaque.question", { round: 1 })
    : t("plaque.questionOf", { round: 1, target });
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

/** "in a row", "correct, then out" for a streak of one, or "a perfect run" for a win. */
export function overCaption(state: Pick<GameState, "streak" | "end">): string {
  if (state.end === "won") return t("over.caption.won");
  return state.streak === 1 ? t("over.caption.one") : t("over.caption.other");
}
