/**
 * Twitch Mode's vote commands: what a chat message must be to count as a vote
 * (DESIGN.md §3, Twitch Mode). One config per language, so a language can add
 * its own aliases later; English only for now.
 *
 * The whole message, trimmed and case-folded, must be one of the commands.
 * Anything inside a longer message is not a vote, nor is a bare `h` or `l`.
 */

import type { Guess } from "@bt/core";

export interface VoteCommands {
  readonly higher: readonly string[];
  readonly lower: readonly string[];
  /** The short and long forms the on-screen hint names, per pick. */
  readonly hint: {
    readonly higher: readonly [string, string];
    readonly lower: readonly [string, string];
  };
}

export const VOTE_COMMANDS = {
  en: {
    higher: ["!h", "!higher", "higher"],
    lower: ["!l", "!lower", "lower"],
    hint: { higher: ["!h", "!higher"], lower: ["!l", "!lower"] },
  },
} as const satisfies Record<string, VoteCommands>;

export type CommandLanguage = keyof typeof VOTE_COMMANDS;

/** The commands in play. */
export const COMMANDS: VoteCommands = VOTE_COMMANDS.en;

/** The longest command, in characters: a longer message is never a vote. */
export const LONGEST_COMMAND = Math.max(
  ...[...COMMANDS.higher, ...COMMANDS.lower].map((command) => command.length),
);

const lookup = new Map<string, Guess>([
  ...COMMANDS.higher.map((command): [string, Guess] => [command, "higher"]),
  ...COMMANDS.lower.map((command): [string, Guess] => [command, "lower"]),
]);

/** The pick a chat message makes, or null when it isn't exactly one of the commands. */
export function parseVote(text: string, commands: VoteCommands = COMMANDS): Guess | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > LONGEST_COMMAND) return null;
  const folded = trimmed.toLowerCase();
  if (commands === COMMANDS) return lookup.get(folded) ?? null;
  if (commands.higher.includes(folded)) return "higher";
  if (commands.lower.includes(folded)) return "lower";
  return null;
}
