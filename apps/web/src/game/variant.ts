/**
 * What a game page plays: Friendly, or an Endless variant (variants.ts in
 * @bt/core) — general Endless, Instagram Endless, or a "Clear the squad"
 * theme. The rules are core's; this maps them to what the page needs: the name
 * the device's stores go under, the page a challenge link opens, whether runs
 * can be published, whether the wheel spins, and the run's win target.
 */

import {
  WIN_ROUNDS,
  hasBoards as variantHasBoards,
  hasWheel,
  squadQuestions,
  variantOf,
} from "@bt/core";
import type { EndlessVariantId, Mode, NamedVariant, SquadTheme, StatKey } from "@bt/core";
import { t } from "../i18n";
import { ENDLESS_PATH, FRIENDLY_PATH, INSTAGRAM_PATH, themePagePath } from "../lib/paths";
import type { GameMode } from "./machine";

/**
 * Names a page's plays: `friendly`, `endless`, `endless-instagram`,
 * `squad:club-barcelona`.
 */
export type PlayId = "friendly" | EndlessVariantId;

export function playId(mode: GameMode, variant?: NamedVariant): PlayId {
  return mode === "friendly" ? "friendly" : variantOf(variant);
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

export function asPlay(play: PlayLike): Play {
  return typeof play === "string" ? { mode: play, target: WIN_ROUNDS[play] } : play;
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
  return mode === "friendly" || hasWheel(variantOf(variant));
}

/**
 * The start panel's line under the deck: "Friendly", "Endless", the variant's
 * "Instagram", or the squad's name.
 */
export function modeSubtitle(mode: GameMode, variant?: NamedVariant, theme?: Theme): string {
  if (theme !== undefined) return theme.name;
  return variant === "endless-instagram"
    ? t("mode.instagram.subtitle")
    : t(mode === "friendly" ? "mode.friendly.name" : "mode.endless.name");
}

/**
 * The line under the plaque in a squad: what club goals count there ("Whole
 * career, not just Barcelona"; `squadNote` in @bt/core). Empty for any other stat.
 */
export function squadNoteText(stat: StatKey, theme: Theme): string {
  return stat === "club_goals" ? t(`squad.note.${theme.type}`, { name: theme.name }) : "";
}

/** The start panel's intro, when the run isn't a challenge and has no win target. */
export function startIntro(mode: GameMode, variant?: NamedVariant): string {
  if (variant === "endless-instagram") return t("start.introInstagram");
  return t(mode === "endless" ? "start.introEndless" : "start.intro");
}
