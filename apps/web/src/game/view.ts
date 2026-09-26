/**
 * Text and small derived values the components render. Pure, so the wording
 * and the edge cases are under test rather than buried in markup.
 */

import type { Reveal, RoundPayload, StatKey } from "@bt/core";
import { formatDate, statLabel, t } from "../i18n";
import type { GameState } from "./machine";

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
    return t("live.question", {
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

/** "in a row", or "correct, then out" for a streak of one. */
export function overCaption(streak: number): string {
  return streak === 1 ? t("over.caption.one") : t("over.caption.other");
}

/**
 * The interim report-an-error link (M5b replaces it with a form): a mailto
 * whose subject names both players, the stat and both values.
 */
export function reportHref(email: string, round: RoundPayload, reveal: Reveal): string {
  const subject = t("over.reportSubject", {
    anchor: round.anchor.name,
    challenger: round.challenger.name,
    stat: statLabel(round.stat.key),
    anchorValue: round.anchor.display,
    challengerValue: reveal.display,
  });
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}
