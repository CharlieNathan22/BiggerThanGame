/**
 * The player YAML schema.
 *
 * Every rule in ARCHITECTURE.md §6's "the build fails on" list lives here or in
 * `validate.ts`. The split is deliberate: this file catches anything decidable
 * from a single player in isolation; `validate.ts` catches anything needing the
 * whole deck (duplicate ids, pool sizes).
 *
 * YAML is snake_case to match the docs and to read naturally when hand-entered.
 * The transform to the engine's camelCase shape happens here, so nothing
 * downstream has to know the file format.
 */

import { z } from "zod";
import type { Player, PlayerStats } from "@bt/core";
import { LICENCE_RULE, isAllowedLicence } from "./licences.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date, YYYY-MM-DD")
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), "not a real date");

/**
 * A plain stat figure.
 *
 * Zero is allowed and meaningful — a player can be capped without scoring, or
 * win no trophies. Absence is expressed by omitting the key, never by a zero.
 */
const count = z.number().int("must be a whole number").nonnegative("cannot be negative");

const igValue = z.object({
  value: z.number().positive("followers must be positive"),
  as_of: isoDate,
});

const feeValue = z.object({
  value: z.number().positive("a fee must be positive"),
  year: z.number().int().min(1888).max(2100),
});

/**
 * `.strict()` is what rejects an unknown stat key. Without it a typo like
 * `club_gaols` would parse as an absent stat and the player would quietly lose
 * eligibility rather than failing the build.
 */
export const statsSchema = z
  .object({
    club_goals: count.optional(),
    caps: count.optional(),
    apps: count.optional(),
    igoals: count.optional(),
    ct: count.optional(),
    it: count.optional(),
    clubs: z.number().int().positive("must have played for at least one club").optional(),
    ig: igValue.optional(),
    fee: feeValue.optional(),
  })
  .strict();

export const imageSchema = z
  .object({
    file: z.string().min(1),
    author: z.string().min(1, "an image needs an author"),
    // Unported licences plus 2.0/2.5/3.0 jurisdiction ports. Anything else
    // fails the build. See licences.ts.
    licence: z.string().refine(isAllowedLicence, LICENCE_RULE),
    source: z.string().url("must be a source URL"),
  })
  .strict();

/** The decade of a player's peak, `1900s` to `2020s`. */
const era = z
  .string()
  .regex(/^\d{3}0s$/, 'must be a decade like "1990s"')
  .refine((s) => {
    const year = Number(s.slice(0, 4));
    return year >= 1900 && year <= 2020;
  }, "must be a decade from 1900s to 2020s");

/**
 * A list of names: at least one, none blank, no repeats. Repeats are compared
 * ignoring case and surrounding space, since `Serie A` twice is a typo however
 * it is spelled. An empty list is rejected — omit the key instead.
 */
const nameList = (what: string) =>
  z
    .array(z.string().trim().min(1, `${what} cannot be blank`))
    .min(1, `list at least one ${what}, or omit the key`)
    .refine(
      (names) => new Set(names.map((n) => n.toLowerCase())).size === names.length,
      `${what}s must not repeat`,
    );

export const playerSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, "ids are lowercase, digits and hyphens only"),
    name: z.string().min(1),
    country: z.string().min(1),
    position: z.enum(["GK", "DF", "MF", "FW"]),
    dob: isoDate,
    deceased: z.boolean().optional(),
    iconic: z.boolean().optional(),
    // For future themed modes. Carried into deck.full.json; no mode reads them
    // yet and no round payload includes them.
    era: era.optional(),
    main_clubs: nameList("club").optional(),
    leagues: nameList("league").optional(),
    stats: statsSchema,
    image: imageSchema.optional(),
  })
  .strict();

export type RawPlayer = z.infer<typeof playerSchema>;
export type RawImage = z.infer<typeof imageSchema>;

/**
 * YAML shape → engine shape. The only place the two spellings meet.
 *
 * Built with conditional spreads rather than assignment because
 * `exactOptionalPropertyTypes` forbids writing `undefined` into an optional
 * property — an absent stat must be an absent key, which is the same
 * distinction the deck itself relies on.
 */
export function toPlayer(raw: RawPlayer): Player {
  const s = raw.stats;
  const stats: PlayerStats = {
    ...(s.club_goals !== undefined ? { club_goals: s.club_goals } : {}),
    ...(s.caps !== undefined ? { caps: s.caps } : {}),
    ...(s.apps !== undefined ? { apps: s.apps } : {}),
    ...(s.igoals !== undefined ? { igoals: s.igoals } : {}),
    ...(s.ct !== undefined ? { ct: s.ct } : {}),
    ...(s.it !== undefined ? { it: s.it } : {}),
    ...(s.clubs !== undefined ? { clubs: s.clubs } : {}),
    ...(s.ig !== undefined ? { ig: { value: s.ig.value, asOf: s.ig.as_of } } : {}),
    ...(s.fee !== undefined ? { fee: { value: s.fee.value, year: s.fee.year } } : {}),
  };

  return {
    id: raw.id,
    name: raw.name,
    country: raw.country,
    position: raw.position,
    dob: raw.dob,
    ...(raw.deceased !== undefined ? { deceased: raw.deceased } : {}),
    ...(raw.iconic !== undefined ? { iconic: raw.iconic } : {}),
    ...(raw.era !== undefined ? { era: raw.era } : {}),
    ...(raw.main_clubs !== undefined ? { mainClubs: raw.main_clubs } : {}),
    ...(raw.leagues !== undefined ? { leagues: raw.leagues } : {}),
    stats,
  };
}
