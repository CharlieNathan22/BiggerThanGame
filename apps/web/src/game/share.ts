/**
 * What a player shares when a run ends (DESIGN.md §13): the Wordle-style text
 * and the content of the share image.
 *
 * The grid comes from the round history alone — `{ index, stat, tier,
 * correct }` per answered round — so it can't carry a value or an answer. The
 * image adds the final round's two players and their revealed figures, which
 * the player has just seen. Pure, so the wording and edge cases are tested.
 */

import { challengeOutcome, streakTitle } from "@bt/core";
import type { ChallengeLink, ChallengeOutcome, Tier } from "@bt/core";
import { statLabel, t } from "../i18n";
import { challengeUrl } from "./challenge";
import type { EndReason, GameState, RoundRecord } from "./machine";

/** One square per answered round, in its tier's colour. */
export const TIER_SQUARE: Readonly<Record<Tier, string>> = {
  basic: "🟨",
  uncommon: "🟦",
  rare: "🟪",
};

/** The round that ended the run. */
export const MISS_SQUARE = "❌";

/** Squares per line, so a long run doesn't become one unreadable line. */
export const GRID_COLUMNS = 10;

/** A grid square: the round's tier, or the miss that ended the run. */
export type GridCell = { readonly kind: "hit"; readonly tier: Tier } | { readonly kind: "miss" };

export function gridCells(history: readonly RoundRecord[]): GridCell[] {
  return history.map((r) => (r.correct ? { kind: "hit", tier: r.tier } : { kind: "miss" }));
}

/** The grid as text, `GRID_COLUMNS` squares to a line. */
export function shareGrid(history: readonly RoundRecord[]): string {
  const squares = gridCells(history).map((c) =>
    c.kind === "miss" ? MISS_SQUARE : TIER_SQUARE[c.tier],
  );
  const lines: string[] = [];
  for (let i = 0; i < squares.length; i += GRID_COLUMNS) {
    lines.push(squares.slice(i, i + GRID_COLUMNS).join(""));
  }
  return lines.join("\n");
}

/**
 * The grid for a screen reader: how many rounds of each tier, and what ended
 * it. Colour never carries the tier alone (DESIGN.md §6).
 */
export function gridLabel(history: readonly RoundRecord[]): string {
  const counts: Record<Tier, number> = { basic: 0, uncommon: 0, rare: 0 };
  for (const r of history) if (r.correct) counts[r.tier] += 1;
  const miss = history.find((r) => !r.correct);
  const label = t("grid.label", { ...counts, rounds: history.length });
  return miss === undefined ? label : `${label} ${t("grid.miss", { stat: statLabel(miss.stat) })}`;
}

/** What ended the run, as the share says it. */
export function endedText(history: readonly RoundRecord[], end: EndReason | null): string {
  const miss = history.find((r) => !r.correct);
  if (miss !== undefined) return t("share.endedOn", { stat: statLabel(miss.stat) });
  if (end === "deck-exhausted") return t("share.exhausted");
  return "";
}

/** "12 in a row", "1 correct, then out". */
export function scoreText(score: number): string {
  return score === 1 ? t("share.score.one", { score }) : t("share.score.other", { score });
}

/** The streak title's words, or "" below the first. */
export function titleText(score: number): string {
  const title = streakTitle(score);
  return title === undefined ? "" : t(`title.${title.id}`);
}

/** How a replay went against the score it was challenged to beat. */
export function outcomeText(outcome: ChallengeOutcome, target: number): string {
  return t(`challenge.${outcome}`, { score: target });
}

/** The score a replayed run had to beat, and how it went; null for any other run. */
export function challengeResult(
  state: GameState,
): { readonly target: number; readonly outcome: ChallengeOutcome } | null {
  if (state.challenge?.status !== "accepted") return null;
  const target = state.challenge.score;
  return { target, outcome: challengeOutcome(state.streak, target) };
}

/**
 * The share text:
 *
 *   Bigger Than — Football Legends
 *   12 in a row · Starter
 *   🟨🟨🟦🟨🟪🟨🟨🟨🟦🟨
 *   🟨🟨❌
 *   Ended on: Club trophies
 *   Can you beat 12? https://biggerthangame.com/?challenge=…
 *
 * No player names, no values, no answers. Without a signed link — a run
 * banked after the connection dropped — it ends with the site's address.
 */
export function shareText(
  score: number,
  history: readonly RoundRecord[],
  end: EndReason | null,
  link: ChallengeLink | null,
  site: string,
): string {
  const title = titleText(score);
  const lines = [
    t("share.heading"),
    title === "" ? scoreText(score) : `${scoreText(score)} · ${title}`,
    shareGrid(history),
    endedText(history, end),
    link === null ? site : t("share.challenge", { score, url: challengeUrl(site, link) }),
  ];
  return lines.filter((line) => line !== "").join("\n");
}

/** A card's name and the figure the player saw for it. */
export interface SharedFigure {
  readonly name: string;
  readonly display: string;
}

/** Everything the share image shows. Drawn by share-image.ts. */
export interface ShareCard {
  readonly score: number;
  readonly caption: string;
  readonly title: string;
  readonly cells: readonly GridCell[];
  /** What ended it, e.g. "Club trophies", or a sentence when nothing did. */
  readonly ended: { readonly label: string; readonly stat: string; readonly tier: Tier } | null;
  readonly note: string;
  /** The final round's two players and their revealed figures. Absent after a dropped connection. */
  readonly players: readonly [SharedFigure, SharedFigure] | null;
  /** "Beat 12 — you did", or "" when the run wasn't a challenge. */
  readonly challenge: string;
  readonly site: string;
}

/** The share image's content, from a finished run. */
export function shareCard(state: GameState, siteLabel: string): ShareCard {
  const { round, reveal, history, streak, end } = state;
  const miss = history.find((r) => !r.correct);
  const result = challengeResult(state);
  return {
    score: streak,
    caption: streak === 1 ? t("over.caption.one") : t("over.caption.other"),
    title: titleText(streak),
    cells: gridCells(history),
    ended:
      miss === undefined
        ? null
        : { label: t("share.endedLabel"), stat: statLabel(miss.stat), tier: miss.tier },
    note: miss === undefined ? endedText(history, end) : "",
    players:
      round !== null && reveal !== null
        ? [
            { name: round.anchor.name, display: round.anchor.display },
            { name: round.challenger.name, display: reveal.display },
          ]
        : null,
    challenge: result === null ? "" : outcomeText(result.outcome, result.target),
    site: siteLabel,
  };
}
