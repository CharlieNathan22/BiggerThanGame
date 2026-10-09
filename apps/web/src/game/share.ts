/**
 * What a player shares when a run ends (DESIGN.md §13): the Wordle-style text
 * and the content of the share image.
 *
 * The grid comes from the round history alone — `{ index, stat, tier,
 * correct }` per answered round — so it can't carry a value or an answer. The
 * image adds the final round's two players and their revealed figures, which
 * the player has just seen. Pure, so the wording and edge cases are tested.
 *
 * Everything takes the play (variant.ts): its mode, and its win target. A play
 * with a win target (`WIN_ROUNDS`: Friendly's twenty) scores out of it
 * ("7/20"), lays the grid out as every round of the challenge — two rows of
 * ten, the rounds not reached left empty — and gives a won run a trophy. "Clear
 * the squad" scores out of its squad too ("21/34 through the Barcelona
 * squad"), but its grid stops at the miss, as a squad can be 68 questions
 * long. The other modes (Endless) keep the plain streak, and name the two
 * players that ended the run — names only, never their figures.
 *
 * The share text ends with the site's address. A challenge link is its own
 * share, in a mode that has them (`CHALLENGES`: Endless): "Beat n" and the link.
 */

import { CHALLENGES, challengeOutcome, streakTitle } from "@bt/core";
import type { ChallengeLink, ChallengeOutcome, NamedVariant, Tier } from "@bt/core";
import { statLabel, t } from "../i18n";
import { challengeUrl } from "./challenge";
import type { EndReason, GameState, RoundRecord } from "./machine";
import { overCaption, scoreFigure } from "./view";
import { asPlay, playId, playPath } from "./variant";
import type { PlayLike } from "./variant";

/** One square per answered round, in its tier's colour. */
export const TIER_SQUARE: Readonly<Record<Tier, string>> = {
  basic: "🟨",
  uncommon: "🟦",
  rare: "🟪",
};

/** The round that ended the run. */
export const MISS_SQUARE = "❌";

/** A round of the challenge the run didn't reach. */
export const EMPTY_SQUARE = "⬛";

/** On the score line of a won run. */
export const TROPHY = "🏆";

/** Squares per line, so a long run doesn't become one unreadable line. */
export const GRID_COLUMNS = 10;

/** A grid square: the round's tier, the miss that ended the run, or a round not reached. */
export type GridCell =
  | { readonly kind: "hit"; readonly tier: Tier }
  | { readonly kind: "miss" }
  | { readonly kind: "empty" };

/**
 * One cell per answered round; in a mode with a win target (Friendly), padded
 * to it with empty cells. A squad's grid isn't: it can be 68 questions long.
 */
export function gridCells(history: readonly RoundRecord[], play: PlayLike): GridCell[] {
  const cells: GridCell[] = history.map((r) =>
    r.correct ? { kind: "hit", tier: r.tier } : { kind: "miss" },
  );
  const { target, theme } = asPlay(play);
  const pad = theme === undefined ? (target ?? 0) : 0;
  while (cells.length < pad) cells.push({ kind: "empty" });
  return cells;
}

/** Whether the run was won: every round of its mode's target answered. */
export function isWon(end: EndReason | null): boolean {
  return end === "won";
}

/** The grid as text, `GRID_COLUMNS` squares to a line. */
export function shareGrid(history: readonly RoundRecord[], play: PlayLike): string {
  const squares = gridCells(history, play).map((c) =>
    c.kind === "miss" ? MISS_SQUARE : c.kind === "empty" ? EMPTY_SQUARE : TIER_SQUARE[c.tier],
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
export function gridLabel(
  history: readonly RoundRecord[],
  play: PlayLike,
  variant?: NamedVariant,
): string {
  const counts: Record<Tier, number> = { basic: 0, uncommon: 0, rare: 0 };
  for (const r of history) if (r.correct) counts[r.tier] += 1;
  const miss = history.find((r) => !r.correct);
  const { target } = asPlay(play);
  const right = counts.basic + counts.uncommon + counts.rare;
  const parts = [
    ...(target === null ? [] : [t("grid.of", { score: right, target })]),
    t("grid.label", { ...counts, rounds: history.length }),
    ...(miss === undefined ? [] : [t("grid.miss", { stat: statLabel(miss.stat, variant) })]),
  ];
  return parts.join(" ");
}

/** The two players of the round that ended a run: the anchor's name, then the challenger's. */
export type EndingNames = readonly [string, string];

/**
 * What ended the run, as the share says it: "Ended on: Caps", or "Out of time
 * on: Caps"; with the two players' names when given ("Ended on: Caps — Zidane
 * v Henry"), never their figures.
 */
export function endedText(
  history: readonly RoundRecord[],
  end: EndReason | null,
  names: EndingNames | null = null,
  variant?: NamedVariant,
): string {
  const miss = history.find((r) => !r.correct);
  if (miss !== undefined) {
    const stat = statLabel(miss.stat, variant);
    const lead = end === "timeout" ? t("share.timedOut", { stat }) : t("share.endedOn", { stat });
    return names === null
      ? lead
      : t("share.endedPlayers", { lead, anchor: names[0], challenger: names[1] });
  }
  if (end === "deck-exhausted") return t("share.exhausted");
  return "";
}

/**
 * The names the share text carries: the round that ended the run, in a play
 * without a win target (Endless). Friendly's and a squad's text stay spoiler-free.
 */
export function endingNames(
  state: Pick<GameState, "round" | "reveal">,
  play: PlayLike,
): EndingNames | null {
  if (asPlay(play).target !== null || state.round === null || state.reveal === null) return null;
  return [state.round.anchor.name, state.round.challenger.name];
}

/**
 * "12 in a row", "1 correct, then out"; in a mode with a win target, "7/20",
 * and "🏆 20/20" for a win; through a squad, "21/34 through the Barcelona
 * squad", or "I cleared the Barcelona squad 🏆".
 */
export function scoreText(score: number, play: PlayLike, end: EndReason | null = null): string {
  const { target, theme } = asPlay(play);
  if (theme !== undefined && target !== null) {
    return isWon(end)
      ? t("share.squadCleared", { squad: theme.name })
      : t("share.squadProgress", { score, target, squad: theme.name });
  }
  if (target !== null) {
    const figure = scoreFigure(score, play);
    return isWon(end) ? `${TROPHY} ${figure}` : figure;
  }
  return score === 1 ? t("share.score.one", { score }) : t("share.score.other", { score });
}

/** The streak title's words, or "" below the first. */
export function titleText(score: number, play: PlayLike): string {
  const { mode } = asPlay(play);
  // A Twitch Mode match has no streak titles: it is scored for both sides.
  if (mode === "stream") return "";
  const title = streakTitle(score, mode);
  return title === undefined ? "" : t(`title.${title.id}`);
}

/**
 * A challenge to a won run's score can't be beaten, only matched: the score is
 * the play's win target.
 */
export function isPerfectTarget(target: number, play: PlayLike): boolean {
  return asPlay(play).target === target;
}

/** "Beat 7/20", or "Match 20/20" when the challenge is a won run. */
export function challengeHeading(target: number, play: PlayLike): string {
  const score = scoreFigure(target, play);
  return isPerfectTarget(target, play)
    ? t("challenge.headingPerfect", { score })
    : t("challenge.heading", { score });
}

/** The start panel's line under the heading, for a challenge. */
export function challengeIntro(target: number, play: PlayLike): string {
  const score = scoreFigure(target, play);
  return isPerfectTarget(target, play)
    ? t("challenge.introPerfect", { score })
    : t("challenge.intro", { score });
}

/** How a replay went against the score it was challenged to beat. */
export function outcomeText(outcome: ChallengeOutcome, target: number, play: PlayLike): string {
  const score = scoreFigure(target, play);
  if (isPerfectTarget(target, play)) {
    return outcome === "matched"
      ? t("challenge.matchedPerfect", { score })
      : t("challenge.shortPerfect", { score });
  }
  return t(`challenge.${outcome}`, { score });
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
 * The share text. In Friendly:
 *
 *   Bigger Than — Football Legends
 *   12/20 · Starter
 *   🟨🟨🟦🟨🟪🟨🟨🟨🟦🟨
 *   🟨🟨❌⬛⬛⬛⬛⬛⬛⬛
 *   Ended on: Club trophies
 *   biggerthangame.com
 *
 * A won run's score line is "🏆 20/20 · Legend", with no "Ended on". In a mode
 * without a win target (Endless) the score is "12 in a row", the grid stops at
 * the miss, and the ending names the two players ("Ended on: Caps — Zidane v
 * Henry"; "Out of time on: …" when the clock ran out). Through a squad it is
 * "21/34 through the Barcelona squad · Captain", or "I cleared the Barcelona
 * squad 🏆" with no title, and the grid stops at the miss.
 *
 * No values and no answers anywhere, and no player names in Friendly. The
 * challenge link, where the mode has one, is shared on its own
 * (`challengeText`). An Endless variant names itself in the heading
 * ("Bigger Than — Instagram Endless").
 */
export function shareText(
  score: number,
  history: readonly RoundRecord[],
  end: EndReason | null,
  site: string,
  play: PlayLike,
  names: EndingNames | null = null,
  variant?: NamedVariant,
): string {
  const cleared = asPlay(play).theme !== undefined && isWon(end);
  const title = cleared ? "" : titleText(score, play);
  const line = scoreText(score, play, end);
  const lines = [
    shareHeading(variant),
    title === "" ? line : `${line} · ${title}`,
    shareGrid(history, play),
    endedText(history, end, names, variant),
    site,
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/** The share text's first line: the deck, or Instagram Endless by name (a squad names itself below). */
export function shareHeading(variant?: NamedVariant): string {
  return variant === "endless-instagram" ? t("share.headingInstagram") : t("share.heading");
}

/**
 * The challenge to share, in a mode that has them: "Beat 12" and the link,
 * which starts the friend on a fresh run of their own against that score —
 * on the variant's own page in an Endless variant, the theme's in a squad.
 * Null in a mode without challenges, or without a signed link (a run banked
 * after the connection dropped).
 */
export function challengeText(
  link: ChallengeLink | null,
  site: string,
  play: PlayLike,
  variant?: NamedVariant,
): string | null {
  const { mode, theme } = asPlay(play);
  if (mode === "ranked" || mode === "stream" || !CHALLENGES[mode] || link === null) return null;
  return t("challenge.share", {
    heading: challengeHeading(link.score, play),
    url: challengeUrl(site, link, playPath(playId(mode, variant), theme)),
  });
}

/** A card's name and the figure the player saw for it. */
export interface SharedFigure {
  readonly name: string;
  readonly display: string;
}

/** A labelled strip of squares on the share image: a Twitch Mode match's chat or streamer. */
export interface ShareRow {
  readonly label: string;
  readonly cells: readonly GridCell[];
}

/** Everything the share image shows. Drawn by share-image.ts. */
export interface ShareCard {
  /** As the mode shows it: "12", or "7/20". */
  readonly score: string;
  /** Every round of the challenge answered: a trophy over the score. */
  readonly won: boolean;
  readonly caption: string;
  readonly title: string;
  readonly cells: readonly GridCell[];
  /** Labelled strips, drawn after `cells` (Twitch Mode: chat's, then the streamer's). */
  readonly rows?: readonly ShareRow[];
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
export function shareCard(state: GameState, siteLabel: string, play: PlayLike): ShareCard {
  const { round, reveal, history, streak, end, variant } = state;
  const miss = history.find((r) => !r.correct);
  const result = challengeResult(state);
  return {
    score: scoreFigure(streak, play),
    won: isWon(end),
    caption: overCaption(state, play),
    title: titleText(streak, play),
    cells: gridCells(history, play),
    ended:
      miss === undefined
        ? null
        : {
            label: end === "timeout" ? t("share.timedOutLabel") : t("share.endedLabel"),
            stat: statLabel(miss.stat, variant),
            tier: miss.tier,
          },
    note: miss === undefined ? endedText(history, end, null, variant) : "",
    players:
      round !== null && reveal !== null
        ? [
            { name: round.anchor.name, display: round.anchor.display },
            { name: round.challenger.name, display: reveal.display },
          ]
        : null,
    challenge: result === null ? "" : outcomeText(result.outcome, result.target, play),
    site: siteLabel,
  };
}
