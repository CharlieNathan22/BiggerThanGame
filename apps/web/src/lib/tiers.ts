import type { Tier } from "@bt/core";

/** How each tier is named on screen. Colour never carries the tier alone. */
export const TIER_LABEL: Readonly<Record<Tier, string>> = {
  basic: "Basic",
  uncommon: "Uncommon",
  rare: "Rare",
};

/** The token holding each tier's colour, for `style="--tier: …"`. */
export const TIER_COLOUR: Readonly<Record<Tier, string>> = {
  basic: "var(--t-basic)",
  uncommon: "var(--t-unc)",
  rare: "var(--t-rare)",
};
