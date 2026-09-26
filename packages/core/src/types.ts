/**
 * Shared vocabulary for the game engine.
 *
 * This module has no dependencies and no behaviour. Everything else in
 * `@bt/core` imports its types from here.
 *
 * See DESIGN.md §5 (stats), §8 (bands), §11 (data model).
 */

/** The ten stats. `age` is derived from `dob`, not stored. */
export type StatKey =
  "club_goals" | "caps" | "apps" | "ig" | "fee" | "igoals" | "ct" | "it" | "clubs" | "age";

/** Majority career position. Drives stat eligibility; never inferred at runtime. */
export type Position = "GK" | "DF" | "MF" | "FW";

/** How often a stat comes up on the wheel. Not how much it scores. */
export type Tier = "basic" | "uncommon" | "rare";

export type Mode = "ranked" | "endless" | "friendly";

/** Instagram followers, in millions. `asOf` is displayed on the card. */
export interface IgValue {
  readonly value: number;
  readonly asOf: string;
}

/** Highest transfer fee, in millions EUR. `year` is displayed on the card. */
export interface FeeValue {
  readonly value: number;
  readonly year: number;
}

/**
 * Stored stat figures. An absent key means the player is ineligible for that
 * stat — never use 0 or null to mean "don't ask about this", because zero is
 * a legitimate value for igoals, ct and it.
 */
export interface PlayerStats {
  readonly club_goals?: number;
  readonly caps?: number;
  readonly apps?: number;
  readonly igoals?: number;
  readonly ct?: number;
  readonly it?: number;
  readonly clubs?: number;
  readonly ig?: IgValue;
  readonly fee?: FeeValue;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly position: Position;
  /** ISO date, `YYYY-MM-DD`. Age is computed from this. */
  readonly dob: string;
  readonly deceased?: boolean;
  /**
   * Recognisable enough to open a run on. Round one's anchor is drawn from
   * this pool, and the first few challengers of a run prefer it — how many
   * depends on the mode (`ICONIC_ROUNDS`, DESIGN.md §10).
   */
  readonly iconic?: boolean;
  /**
   * For future themed modes; no mode reads these yet, and they never reach a
   * round payload. `era` is the decade of the player's peak (`"1990s"`).
   * `mainClubs` is the main senior clubs (`main_clubs` in YAML) — not the
   * `clubs` stat, which is a count
   * of every senior club. `leagues` is the leagues played in.
   */
  readonly era?: string;
  readonly mainClubs?: readonly string[];
  readonly leagues?: readonly string[];
  /**
   * Crop focus for the photo, `"x y"` percentages (`image.focus` in YAML).
   * Reaches the round payload as `image.focus`, only alongside a photo.
   */
  readonly imageFocus?: string;
  readonly stats: PlayerStats;
}

/**
 * Required distance between the two values, in rank distance: how far apart
 * they sit in the deck's spread for the stat, 0 to 1 (see ramp.ts). A larger
 * floor means an easier round. `ceiling: null` means uncapped.
 */
export interface Band {
  readonly floor: number;
  readonly ceiling: number | null;
  /**
   * Smallest ratio gap (`max / min - 1`) allowed on top of the rank band. Set
   * for volatile stats only — the volatility floor.
   */
  readonly minRatio?: number;
}

export type Relaxation = "none" | "iconic" | "band" | "seen";

/** One dealt question. */
export interface Round {
  /** 1-based. */
  readonly index: number;
  readonly stat: StatKey;
  readonly anchor: Player;
  readonly challenger: Player;
  /** The band actually used, after any relaxation. */
  readonly band: Band;
  /** What had to give to deal this pair. See engine.ts. */
  readonly relaxation: Relaxation;
  /** True when the stat changed from the previous round (the wheel spins). */
  readonly statChanged: boolean;
}
