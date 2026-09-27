/**
 * Text and small derived values the components render. Pure, so the wording
 * and the edge cases are under test rather than buried in markup.
 */

import type { StatKey } from "@bt/core";
import { formatDate, statLabel, t } from "../i18n";
import type { GameState, Hitch } from "./machine";

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

/** What the screen reader hears. Empty when nothing new has happened. */
export function announcement(state: GameState): string {
  const { round, reveal } = state;
  if (round === null) return "";
  if (state.phase === "awaiting") {
    // Say so when the stat has just changed: the plaque is the question.
    const key = round.stat.statChanged ? "live.statChanged" : "live.question";
    return t(key, {
      stat: statLabel(round.stat.key),
      anchor: round.anchor.name,
      value: round.anchor.display,
      challenger: round.challenger.name,
    });
  }
  if ((state.phase === "verdict" || state.phase === "over") && reveal !== null) {
    const params = { challenger: round.challenger.name, value: reveal.display };
    return reveal.correct
      ? t("live.correct", { ...params, streak: state.streak })
      : t("live.wrong", params);
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

/** "in a row", or "correct, then out" for a streak of one. */
export function overCaption(streak: number): string {
  return streak === 1 ? t("over.caption.one") : t("over.caption.other");
}
