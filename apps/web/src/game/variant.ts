/**
 * What a game page plays: Friendly, or an Endless variant (variants.ts in
 * @bt/core) — general Endless, or Instagram Endless. The rules are core's; this
 * maps them to what the page needs: the name the device's stores go under,
 * the page a challenge link opens, whether runs can be published, and whether
 * the wheel spins.
 */

import { ENDLESS_VARIANTS, hasWheel, variantOf } from "@bt/core";
import type { EndlessVariantId, NamedVariant } from "@bt/core";
import { t } from "../i18n";
import { ENDLESS_PATH, FRIENDLY_PATH, INSTAGRAM_PATH } from "../lib/paths";
import type { GameMode } from "./machine";

/** Names a page's plays: `friendly`, `endless`, `endless-instagram`. */
export type PlayId = "friendly" | EndlessVariantId;

export function playId(mode: GameMode, variant?: NamedVariant): PlayId {
  return mode === "friendly" ? "friendly" : variantOf(variant);
}

/** Each play's game page: where its challenge links point. */
export const PLAY_PATHS: Readonly<Record<PlayId, string>> = {
  friendly: FRIENDLY_PATH,
  endless: ENDLESS_PATH,
  "endless-instagram": INSTAGRAM_PATH,
};

/** Whether a finished run can be published: Endless's own boards, no other variant's. */
export function hasBoards(mode: GameMode, variant?: NamedVariant): boolean {
  return mode === "endless" && ENDLESS_VARIANTS[variantOf(variant)].boards;
}

/** Whether the wheel spins: everywhere but a variant that fixes the stat. */
export function spins(mode: GameMode, variant?: NamedVariant): boolean {
  return mode === "friendly" || hasWheel(variantOf(variant));
}

/** The start panel's line under the deck: "Friendly", "Endless", or the variant's "Instagram". */
export function modeSubtitle(mode: GameMode, variant?: NamedVariant): string {
  return variant === "endless-instagram"
    ? t("mode.instagram.subtitle")
    : t(mode === "friendly" ? "mode.friendly.name" : "mode.endless.name");
}

/** The start panel's intro, when the run isn't a challenge and has no win target. */
export function startIntro(mode: GameMode, variant?: NamedVariant): string {
  if (variant === "endless-instagram") return t("start.introInstagram");
  return t(mode === "endless" ? "start.introEndless" : "start.intro");
}
