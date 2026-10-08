/**
 * Stored Daily round → wire payload: the only place a frozen game becomes
 * response data. Like payload.ts for a dealt round, every field is copied by
 * name into a declared type and nothing is spread from a `StoredRound`, which
 * holds both figures (ARCHITECTURE.md §4, invariant 1).
 *
 * **Photos.** Names, stats and figures stay as frozen. A photo is resolved
 * against the deck's current image manifest as it is served: the stored one if
 * it still exists, else the player's current photo, else none (the card's
 * monogram). Image keys are content-hashed, so a photo replaced or re-cropped
 * during the day changes its key, and the old one may no longer be served.
 */

import { STATS, statLabel } from "@bt/core";
import type { AnchorCard, CardImage, Player, PlayerCard, Reveal, RoundPayload } from "@bt/core";
import type { StoredPlayer, StoredRound } from "./daily-game.js";
import type { ImageLookup } from "./payload.js";

/** The deck's current photos, and its players for their current crop focus. */
export interface CurrentImages {
  readonly images: ImageLookup;
  /** Current players by id, for a fallback photo's focus. */
  readonly players: ReadonlyMap<string, Player>;
}

export function currentImages(deck: readonly Player[], images: ImageLookup): CurrentImages {
  return { images, players: new Map(deck.map((p) => [p.id, p])) };
}

/**
 * `following` is the round after this one, if the run can reach it: only its
 * challenger's photo travels, as `upcoming` (ARCHITECTURE.md §9).
 */
export function dailyRoundPayload(
  round: StoredRound,
  current: CurrentImages,
  following?: StoredRound,
): RoundPayload {
  const def = STATS[round.stat];
  const upcoming = following === undefined ? undefined : photoFor(following.challenger, current);
  return {
    index: round.index,
    stat: {
      key: def.key,
      label: statLabel(round.stat),
      tier: def.tier,
      statChanged: round.statChanged,
    },
    anchor: anchorCard(round.anchor, current),
    challenger: playerCard(round.challenger, current),
    ...(upcoming !== undefined ? { upcoming } : {}),
  };
}

/** The challenger's figure, for after the guess. */
export function dailyReveal(round: StoredRound, correct: boolean): Reveal {
  const { challenger } = round;
  return {
    round: round.index,
    value: challenger.value,
    display: challenger.display,
    ...(challenger.qualifier !== undefined ? { qualifier: challenger.qualifier } : {}),
    correct,
  };
}

/** The server decides. A stored round is never a tie: the engine never deals one. */
export function dailyIsCorrect(round: StoredRound, guess: "higher" | "lower"): boolean {
  const { anchor, challenger } = round;
  if (anchor.value === challenger.value) {
    throw new Error(`stored round ${round.index} is a tie; the engine must not deal one`);
  }
  return (challenger.value > anchor.value ? "higher" : "lower") === guess;
}

function playerCard(player: StoredPlayer, current: CurrentImages): PlayerCard {
  const image = photoFor(player, current);
  return {
    id: player.id,
    name: player.name,
    country: player.country,
    position: player.position,
    ...(image !== undefined ? { image } : {}),
  };
}

function anchorCard(player: StoredPlayer, current: CurrentImages): AnchorCard {
  return {
    ...playerCard(player, current),
    value: player.value,
    display: player.display,
    ...(player.qualifier !== undefined ? { qualifier: player.qualifier } : {}),
  };
}

/** The stored photo if it still exists, else the player's current one, else none. */
export function photoFor(player: StoredPlayer, current: CurrentImages): CardImage | undefined {
  const now = current.images[player.id];
  if (now === undefined) return undefined;
  if (player.image !== undefined && now.key === player.image.key) {
    return {
      key: player.image.key,
      width: player.image.width,
      height: player.image.height,
      ...(player.focus !== undefined ? { focus: player.focus } : {}),
    };
  }
  const focus = current.players.get(player.id)?.imageFocus;
  return {
    key: now.key,
    width: now.width,
    height: now.height,
    ...(focus !== undefined ? { focus } : {}),
  };
}
