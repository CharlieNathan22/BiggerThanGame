/**
 * Round → wire payload. The only place engine objects become response data.
 *
 * A `Round` holds `anchor` and `challenger` as full `Player` objects with every
 * stat on them. Returning one — or spreading a `Player` into a card — leaks
 * both players entirely and still typechecks. So every field here is copied by
 * name into an explicitly declared type, and nothing is spread from an engine
 * object. ARCHITECTURE.md §4, invariant 1.
 */

import { STATS, statLabel, valueOf } from "@bt/core";
import type {
  AnchorCard,
  CardImage,
  EndlessVariantId,
  Guess,
  Player,
  PlayerCard,
  PlayerImage,
  Reveal,
  Round,
  RoundPayload,
  StatKey,
} from "@bt/core";

export type ImageLookup = Readonly<Record<string, PlayerImage>>;

/**
 * `following` is the round after this one, when the run can deal it. Only its
 * challenger's photo travels, as `upcoming`, so the client can load it a round
 * early (ARCHITECTURE.md §9) — never its name, stat or value. `variant` is an
 * Endless run's, for the stat's label in it (`statLabel`).
 */
export function toRoundPayload(
  round: Round,
  now: Date,
  images: ImageLookup,
  following?: Round,
  variant?: EndlessVariantId,
): RoundPayload {
  const def = STATS[round.stat];
  const upcoming = following === undefined ? undefined : imageFor(following.challenger, images);
  const label = statLabel(round.stat, variant);
  return {
    index: round.index,
    stat: { key: def.key, label, tier: def.tier, statChanged: round.statChanged },
    anchor: toAnchorCard(round.anchor, round.stat, now, images),
    challenger: toPlayerCard(round.challenger, images),
    ...(upcoming !== undefined ? { upcoming } : {}),
  };
}

/** The challenger's figure, for after the guess. */
export function toReveal(round: Round, now: Date, correct: boolean): Reveal {
  const figure = figureFor(round.challenger, round.stat, now);
  return { round: round.index, ...figure, correct };
}

/** The server decides correctness. Ties are never dealt, so one answer is always right. */
export function isCorrect(round: Round, now: Date, guess: Guess): boolean {
  const anchor = requireValue(round.anchor, round.stat, now);
  const challenger = requireValue(round.challenger, round.stat, now);
  if (anchor === challenger) {
    throw new Error(`round ${round.index} is a tie on ${round.stat}; the engine must not deal one`);
  }
  return (challenger > anchor ? "higher" : "lower") === guess;
}

function toPlayerCard(player: Player, images: ImageLookup): PlayerCard {
  const image = imageFor(player, images);
  return {
    id: player.id,
    name: player.name,
    country: player.country,
    position: player.position,
    ...(image !== undefined ? { image } : {}),
  };
}

/** A player's photo as a card shows it, or undefined when they have none. */
function imageFor(player: Player, images: ImageLookup): CardImage | undefined {
  const image = images[player.id];
  return image === undefined ? undefined : toCardImage(image, player.imageFocus);
}

function toCardImage(image: PlayerImage, focus: string | undefined): CardImage {
  return {
    key: image.key,
    width: image.width,
    height: image.height,
    ...(focus !== undefined ? { focus } : {}),
  };
}

function toAnchorCard(player: Player, stat: StatKey, now: Date, images: ImageLookup): AnchorCard {
  return { ...toPlayerCard(player, images), ...figureFor(player, stat, now) };
}

export interface Figure {
  readonly value: number;
  readonly display: string;
  readonly qualifier?: string;
}

/** A figure as the card shows it: the value, its display and any qualifier. */
export function figureFor(player: Player, stat: StatKey, now: Date): Figure {
  const def = STATS[stat];
  const value = requireValue(player, stat, now);
  const qualifier = def.qualifier?.(player);
  return {
    value,
    display: def.format(value),
    ...(qualifier !== undefined ? { qualifier } : {}),
  };
}

function requireValue(player: Player, stat: StatKey, now: Date): number {
  const value = valueOf(player, stat, now);
  if (value === undefined) {
    throw new Error(`${player.id} has no ${stat}; the engine must not deal an ineligible player`);
  }
  return value;
}
