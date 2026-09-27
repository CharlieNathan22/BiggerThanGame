/**
 * Text and small derived values the components render. Pure, so the wording
 * and the edge cases are under test rather than buried in markup.
 */

import { WIN_ROUNDS, isFinalRound } from "@bt/core";
import type { Mode, StatKey, Tier } from "@bt/core";
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

/** The note under the challenger while a request waits to go again. */
export function hitchText(hitch: Hitch | null): string {
  if (hitch === null) return "";
  return hitch.kind === "slowDown" ? t("hitch.slowDown") : t("hitch.reconnecting");
}

/** "in a row", "correct, then out" for a streak of one, or "a perfect run" for a win. */
export function overCaption(state: Pick<GameState, "streak" | "end">): string {
  if (state.end === "won") return t("over.caption.won");
  return state.streak === 1 ? t("over.caption.one") : t("over.caption.other");
}
