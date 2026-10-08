/**
 * What a game page plays: Friendly, or an Endless variant (variants.ts in
 * @bt/core) — general Endless, Instagram Endless, or a "Clear the squad"
 * theme. The rules are core's; this maps them to what the page needs: the name
 * the device's stores go under, the page a challenge link opens, whether runs
 * can be published, whether the wheel spins, and the run's win target.
 */

import {
  DAILY_QUESTIONS,
  WIN_ROUNDS,
  hasBoards as variantHasBoards,
  hasWheel,
  isSquadCareerStat,
  squadQuestions,
  variantOf,
} from "@bt/core";
import type { EndlessVariantId, Mode, NamedVariant, SquadTheme, StatKey } from "@bt/core";
import { hasMessage, t } from "../i18n";
import type { MessageKey, Params } from "../i18n";
import {
  DAILY_PATH,
  ENDLESS_PATH,
  FRIENDLY_PATH,
  INSTAGRAM_PATH,
  themePagePath,
} from "../lib/paths";
import type { GameMode } from "./machine";

/**
 * Names a page's plays: `friendly`, `ranked` (Daily Ranked), `endless`,
 * `endless-instagram`, `squad:club-barcelona`.
 */
export type PlayId = "friendly" | "ranked" | EndlessVariantId;

export function playId(mode: GameMode, variant?: NamedVariant): PlayId {
  return mode === "friendly" || mode === "ranked" ? mode : variantOf(variant);
}

/** A "Clear the squad" theme as a page knows it: from `themes.json`, names and counts only. */
export type Theme = Pick<SquadTheme, "id" | "type" | "name" | "slug" | "players">;

/**
 * How a run scores and ends, for the words and the progress track: its mode,
 * its win target (Friendly's 20, a squad's questions; null for a run with no
 * finish line), and in "Clear the squad" its theme.
 */
export interface Play {
  readonly mode: Mode;
  readonly target: number | null;
  readonly theme?: Theme;
}

/** A mode, standing for its own play (Friendly, Endless), or a play spelled out. */
export type PlayLike = Mode | Play;

/**
 * Daily Ranked reads out of its twenty questions, like Friendly, though it has
 * no win target: a perfect twenty goes on into the bonus rounds.
 */
export function asPlay(play: PlayLike): Play {
  if (typeof play !== "string") return play;
  return { mode: play, target: play === "ranked" ? DAILY_QUESTIONS : WIN_ROUNDS[play] };
}

/** The play on a page: a squad's when it has a theme, else the mode's own. */
export function playOf(mode: GameMode, theme?: Theme): Play {
  return theme === undefined
    ? asPlay(mode)
    : { mode, target: squadQuestions(theme.players), theme };
}

/** Each play's game page: where its challenge links point. */
export function playPath(play: PlayId, theme?: Theme): string {
  if (play === "friendly") return FRIENDLY_PATH;
  if (play === "ranked") return DAILY_PATH;
  if (play === "endless") return ENDLESS_PATH;
  if (play === "endless-instagram") return INSTAGRAM_PATH;
  if (theme === undefined) throw new Error(`no theme for ${play}`);
  return themePagePath(theme);
}

/** Whether a finished run can be published: Endless's own boards, no other variant's. */
export function hasBoards(mode: GameMode, variant?: NamedVariant): boolean {
  return mode === "endless" && variantHasBoards(variantOf(variant));
}

/** Whether the wheel spins: everywhere but a variant that fixes the stat. */
export function spins(mode: GameMode, variant?: NamedVariant): boolean {
  return mode !== "endless" || hasWheel(variantOf(variant));
}

/**
 * The start panel's line under the deck: "Friendly", "Endless", the variant's
 * "Instagram", or the squad's name.
 */
export function modeSubtitle(mode: GameMode, variant?: NamedVariant, theme?: Theme): string {
  if (theme !== undefined) return theme.name;
  if (mode === "ranked") return t("daily.subtitle");
  return variant === "endless-instagram"
    ? t("mode.instagram.subtitle")
    : t(mode === "friendly" ? "mode.friendly.name" : "mode.endless.name");
}

/**
 * A theme's words: `<kind>.<theme id>` where one theme has its own (the
 * Classic Era says what it spans), else `<kind>.<type>`, else `<kind>`. The
 * theme's name and player count fill `{name}` and `{players}`.
 */
export function themeText(
  kind: "theme.players" | "squad.count" | "squad.title" | "squad.description" | "squad.note",
  theme: Theme,
  params: Params = {},
): string {
  const words = { name: theme.name, players: theme.players, ...params };
  for (const key of [`${kind}.${theme.id}`, `${kind}.${theme.type}`, kind]) {
    if (hasMessage(key)) return t(key as MessageKey, words);
  }
  throw new Error(`no message for ${kind} (${theme.id})`);
}

/**
 * The line under the plaque in a squad: what a career stat (club goals, club
 * appearances, club trophies, the highest fee) counts there ("Whole career,
 * not just Barcelona"; `squadNote` in @bt/core). Empty for any other stat.
 */
export function squadNoteText(stat: StatKey, theme: Theme): string {
  return isSquadCareerStat(stat) ? themeText("squad.note", theme) : "";
}

/** The start panel's intro, when the run isn't a challenge and has no win target. */
export function startIntro(mode: GameMode, variant?: NamedVariant): string {
  if (variant === "endless-instagram") return t("start.introInstagram");
  if (mode === "ranked") return t("daily.intro");
  return t(mode === "endless" ? "start.introEndless" : "start.intro");
}
